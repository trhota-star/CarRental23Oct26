// Vercel Blob implementation of FileStorage. Written and unit-tested with a mocked
// client; NOT connected (used only when STORAGE_PROVIDER=vercel-blob).
// Every blob is stored with access "private": there is never a public URL. Files are
// streamed to users only through an authorised route handler (authorizeFileAccess).

import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";
import type { FileStorage, StoredFile } from "./types";

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_\-./]*$/;

/** The subset of @vercel/blob this adapter uses (lets tests pass a mock). */
export type BlobClient = {
  put: typeof put;
  get: typeof get;
  head: typeof head;
  del: typeof del;
};

export type VercelBlobOptions = {
  /** BLOB_READ_WRITE_TOKEN. */
  token: string;
  /** Optional folder prefix inside the store, e.g. "driveeasy". */
  prefix?: string;
  client?: BlobClient;
};

function isNotFound(error: unknown): boolean {
  return error instanceof BlobNotFoundError || (error as { name?: string })?.name === "BlobNotFoundError";
}

export class VercelBlobStorage implements FileStorage {
  readonly name = "vercel-blob";
  private readonly client: BlobClient;

  constructor(private readonly options: VercelBlobOptions) {
    this.client = options.client ?? { put, get, head, del };
  }

  private path(key: string): string {
    if (!KEY_PATTERN.test(key) || key.split("/").includes("..")) throw new Error(`Invalid storage key: ${key}`);
    return this.options.prefix ? `${this.options.prefix.replace(/\/+$/, "")}/${key}` : key;
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<StoredFile> {
    await this.client.put(this.path(key), Buffer.from(body), {
      access: "private",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
      token: this.options.token,
    });
    return { key, contentType, size: body.byteLength };
  }

  async get(key: string): Promise<(StoredFile & { body: Buffer }) | null> {
    const result = await this.client.get(this.path(key), { access: "private", token: this.options.token, useCache: false });
    if (!result || result.statusCode !== 200) return null;
    const body = Buffer.from(await new Response(result.stream).arrayBuffer());
    return { key, contentType: result.blob.contentType, size: result.blob.size, body };
  }

  async delete(key: string): Promise<void> {
    await this.client.del(this.path(key), { token: this.options.token });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.head(this.path(key), { token: this.options.token });
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }
}
