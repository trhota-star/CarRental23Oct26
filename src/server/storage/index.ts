import { LocalFileStorage } from "./local";
import type { FileStorage } from "./types";

export * from "./types";

let storage: FileStorage | undefined;

/** Returns the store named by STORAGE_PROVIDER (default "local"). */
export function getFileStorage(): FileStorage {
  if (storage) return storage;
  const name = process.env.STORAGE_PROVIDER ?? "local";
  switch (name) {
    case "local":
      storage = new LocalFileStorage(process.env.LOCAL_UPLOADS_DIR ?? "storage/uploads");
      return storage;
    // case "s3": add an S3FileStorage implementing FileStorage.
    default:
      throw new Error(`STORAGE_PROVIDER "${name}" is not implemented yet`);
  }
}
