-- Custom migration: the single exclusion constraint that prevents double-booking,
-- plus the triggers that keep the vehicle_bookings occupancy table in sync.
--
-- Approach: `vehicle_bookings` holds one row per ACTIVE reservation
-- (PENDING / CONFIRMED / PICKED_UP) and per active (not cancelled) maintenance
-- block. AFTER INSERT/UPDATE triggers on `reservations` and `maintenance_blocks`
-- upsert or delete that row inside the same transaction, so the one EXCLUDE
-- constraint below covers both sources. A conflict raises SQLSTATE 23P01 in the
-- statement that wrote the reservation / maintenance block, and the whole
-- transaction rolls back. Deletes cascade through the foreign keys.

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "vehicle_bookings"
  ADD CONSTRAINT "vehicle_bookings_period_not_empty" CHECK (NOT isempty("period"));
--> statement-breakpoint
ALTER TABLE "vehicle_bookings"
  ADD CONSTRAINT "vehicle_bookings_no_overlap"
  EXCLUDE USING gist ("vehicle_id" WITH =, "period" WITH &&);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION driveeasy_sync_reservation_booking() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('PENDING', 'CONFIRMED', 'PICKED_UP') THEN
    INSERT INTO vehicle_bookings (vehicle_id, period, reservation_id, hold_expires_at)
    VALUES (
      NEW.vehicle_id,
      NEW.period,
      NEW.id,
      CASE WHEN NEW.status = 'PENDING' THEN NEW.hold_expires_at ELSE NULL END
    )
    ON CONFLICT (reservation_id) DO UPDATE
      SET vehicle_id = EXCLUDED.vehicle_id,
          period = EXCLUDED.period,
          hold_expires_at = EXCLUDED.hold_expires_at;
  ELSE
    DELETE FROM vehicle_bookings WHERE reservation_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER reservations_sync_booking
  AFTER INSERT OR UPDATE OF status, vehicle_id, pickup_at, return_at, hold_expires_at ON reservations
  FOR EACH ROW EXECUTE FUNCTION driveeasy_sync_reservation_booking();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION driveeasy_sync_maintenance_booking() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cancelled_at IS NULL THEN
    INSERT INTO vehicle_bookings (vehicle_id, period, maintenance_block_id)
    VALUES (NEW.vehicle_id, NEW.period, NEW.id)
    ON CONFLICT (maintenance_block_id) DO UPDATE
      SET vehicle_id = EXCLUDED.vehicle_id,
          period = EXCLUDED.period;
  ELSE
    DELETE FROM vehicle_bookings WHERE maintenance_block_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER maintenance_blocks_sync_booking
  AFTER INSERT OR UPDATE OF vehicle_id, starts_at, ends_at, cancelled_at ON maintenance_blocks
  FOR EACH ROW EXECUTE FUNCTION driveeasy_sync_maintenance_booking();
