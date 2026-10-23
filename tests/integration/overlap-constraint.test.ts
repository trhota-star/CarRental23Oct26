// QA-2 / QA-3 (database level): the single exclusion constraint on
// vehicle_bookings, fed by triggers on reservations and maintenance_blocks.
// These tests write rows directly, so they exercise the constraint itself,
// independent of createReservationHold (covered in reservations.test.ts).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addDays,
  addMinutes,
  createFleet,
  createUser,
  futureAt,
  insertMaintenanceRow,
  insertReservationRow,
  newPool,
  sqlState,
} from "./helpers/db";

const pool = newPool(4);
let userId: string;
afterAll(() => pool.end());
beforeAll(async () => {
  userId = (await createUser(pool)).id;
});

async function fleet() {
  const f = await createFleet(pool);
  return { vehicleId: f.vehicle.id, branchId: f.branch.id };
}

describe("vehicle_bookings exclusion constraint", () => {
  it("allows back-to-back reservations (one ends exactly when the next begins)", async () => {
    const f = await fleet();
    const start = futureAt(30);
    await insertReservationRow(pool, { userId, ...f, pickupAt: start, returnAt: addDays(start, 2) });
    await expect(
      insertReservationRow(pool, { userId, ...f, pickupAt: addDays(start, 2), returnAt: addDays(start, 4) }),
    ).resolves.toBeTypeOf("string");
    // and the one immediately before
    await expect(
      insertReservationRow(pool, { userId, ...f, pickupAt: addDays(start, -1), returnAt: start }),
    ).resolves.toBeTypeOf("string");
  });

  it("rejects a 1-minute overlap with SQLSTATE 23P01", async () => {
    const f = await fleet();
    const start = futureAt(30);
    await insertReservationRow(pool, { userId, ...f, pickupAt: start, returnAt: addDays(start, 2) });
    const err = await insertReservationRow(pool, {
      userId,
      ...f,
      pickupAt: addMinutes(addDays(start, 2), -1),
      returnAt: addDays(start, 3),
    }).catch((e) => e);
    expect(sqlState(err)).toBe("23P01");
  });

  it("allows the same period on a different vehicle", async () => {
    const a = await fleet();
    const b = await fleet();
    const start = futureAt(31);
    await insertReservationRow(pool, { userId, ...a, pickupAt: start, returnAt: addDays(start, 2) });
    await expect(insertReservationRow(pool, { userId, ...b, pickupAt: start, returnAt: addDays(start, 2) })).resolves.toBeTruthy();
  });

  it("blocks reservations that overlap a maintenance block, and vice versa", async () => {
    const f = await fleet();
    const start = futureAt(40);
    await insertMaintenanceRow(pool, f.vehicleId, start, addDays(start, 1));
    const err = await insertReservationRow(pool, { userId, ...f, pickupAt: addMinutes(start, 60), returnAt: addDays(start, 2) }).catch(
      (e) => e,
    );
    expect(sqlState(err)).toBe("23P01");

    // Reservation first, then maintenance over it.
    const start2 = futureAt(50);
    await insertReservationRow(pool, { userId, ...f, pickupAt: start2, returnAt: addDays(start2, 2) });
    const err2 = await insertMaintenanceRow(pool, f.vehicleId, addDays(start2, 1), addDays(start2, 3)).catch((e) => e);
    expect(sqlState(err2)).toBe("23P01");

    // Maintenance back-to-back with a reservation is fine.
    await expect(insertMaintenanceRow(pool, f.vehicleId, addDays(start2, 2), addDays(start2, 3))).resolves.toBeTruthy();
  });

  it("frees the slot when a reservation is cancelled / expired / returned, or maintenance cancelled", async () => {
    for (const status of ["CANCELLED", "EXPIRED", "RETURNED", "REFUNDED"]) {
      const f = await fleet();
      const start = futureAt(60);
      const id = await insertReservationRow(pool, { userId, ...f, pickupAt: start, returnAt: addDays(start, 2) });
      await pool.query(`update reservations set status = $2 where id = $1`, [id, status]);
      await expect(
        insertReservationRow(pool, { userId, ...f, pickupAt: start, returnAt: addDays(start, 2) }),
        status,
      ).resolves.toBeTruthy();
    }
    const f = await fleet();
    const start = futureAt(61);
    const m = await insertMaintenanceRow(pool, f.vehicleId, start, addDays(start, 1));
    await pool.query(`update maintenance_blocks set cancelled_at = now() where id = $1`, [m]);
    await expect(insertReservationRow(pool, { userId, ...f, pickupAt: start, returnAt: addDays(start, 1) })).resolves.toBeTruthy();
  });

  it("re-checks overlap when an active reservation's dates are moved", async () => {
    const f = await fleet();
    const start = futureAt(70);
    await insertReservationRow(pool, { userId, ...f, pickupAt: start, returnAt: addDays(start, 2) });
    const second = await insertReservationRow(pool, { userId, ...f, pickupAt: addDays(start, 3), returnAt: addDays(start, 5) });
    const err = await pool
      .query(`update reservations set pickup_at = $2 where id = $1`, [second, addDays(start, 1)])
      .catch((e) => e);
    expect(sqlState(err)).toBe("23P01");
  });

  it("rejects an empty or inverted period", async () => {
    const f = await fleet();
    const start = futureAt(80);
    const err = await insertReservationRow(pool, { userId, ...f, pickupAt: start, returnAt: start }).catch((e) => e);
    expect(sqlState(err)).toBe("23514");
  });

  it("concurrent inserts from two separate sessions: exactly one wins (25 runs)", async () => {
    const poolA = newPool(1);
    const poolB = newPool(1);
    try {
      for (let run = 0; run < 25; run++) {
        const f = await fleet();
        const start = futureAt(90 + run);
        const results = await Promise.allSettled([
          insertReservationRow(poolA, { userId, ...f, pickupAt: start, returnAt: addDays(start, 3) }),
          insertReservationRow(poolB, { userId, ...f, pickupAt: addDays(start, 1), returnAt: addDays(start, 4) }),
        ]);
        const ok = results.filter((r) => r.status === "fulfilled");
        const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
        expect(ok, `run ${run}`).toHaveLength(1);
        expect(sqlState(failed[0].reason), `run ${run}`).toBe("23P01");
        const { rows } = await pool.query(`select count(*)::int as n from vehicle_bookings where vehicle_id = $1`, [f.vehicleId]);
        expect(rows[0].n).toBe(1);
      }
    } finally {
      await Promise.all([poolA.end(), poolB.end()]);
    }
  });
});
