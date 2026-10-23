// Provider-neutral private file storage. The concrete store is chosen by the
// STORAGE_PROVIDER setting. Files are never publicly served; the app must
// check access and stream them itself (or use signed URLs in the cloud).

export type StoredFile = {
  key: string;
  contentType: string;
  size: number;
};

export interface FileStorage {
  readonly name: string;
  put(key: string, body: Uint8Array, contentType: string): Promise<StoredFile>;
  get(key: string): Promise<(StoredFile & { body: Buffer }) | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
