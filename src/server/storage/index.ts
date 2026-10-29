import { requireEnv } from "../config";
import { LocalFileStorage } from "./local";
import { VercelBlobStorage } from "./vercel-blob";
import type { FileStorage } from "./types";

export * from "./types";

let storage: FileStorage | undefined;

/** Test hook: forget the cached store (e.g. after changing env). */
export function resetFileStorageForTests(): void {
  storage = undefined;
}

/** Returns the store named by STORAGE_PROVIDER (default "local"). */
export function getFileStorage(): FileStorage {
  if (storage) return storage;
  const name = process.env.STORAGE_PROVIDER ?? "local";
  switch (name) {
    case "local":
      storage = new LocalFileStorage(process.env.LOCAL_UPLOADS_DIR ?? "storage/uploads");
      return storage;
    case "vercel-blob":
      storage = new VercelBlobStorage({
        token: requireEnv("BLOB_READ_WRITE_TOKEN"),
        prefix: process.env.BLOB_PREFIX || undefined,
      });
      return storage;
    default:
      throw new Error(`STORAGE_PROVIDER "${name}" is not implemented yet`);
  }
}
