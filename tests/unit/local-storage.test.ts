import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFileStorage } from "@/server/storage/local";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "uploads-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("LocalFileStorage", () => {
  it("stores, reads and deletes files", async () => {
    const storage = new LocalFileStorage(dir);
    await storage.put("licences/user1/front.jpg", Buffer.from("img"), "image/jpeg");
    expect(await storage.exists("licences/user1/front.jpg")).toBe(true);
    const file = await storage.get("licences/user1/front.jpg");
    expect(file).toMatchObject({ contentType: "image/jpeg", size: 3 });
    expect(file?.body.toString()).toBe("img");
    await storage.delete("licences/user1/front.jpg");
    expect(await storage.get("licences/user1/front.jpg")).toBeNull();
  });

  it("rejects keys that escape the folder", async () => {
    const storage = new LocalFileStorage(dir);
    for (const key of ["../x", "a/../../x", "/abs", "..\\x", "a/b.meta.json"]) {
      await expect(storage.put(key, Buffer.from(""), "text/plain")).rejects.toThrow("Invalid storage key");
    }
  });

  it("refuses a folder inside public/", () => {
    expect(() => new LocalFileStorage("public/uploads")).toThrow("must not be inside");
  });
});
