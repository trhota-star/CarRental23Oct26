// VercelBlobStorage with a mocked @vercel/blob client. No network calls.

import { BlobNotFoundError } from "@vercel/blob";
import { describe, expect, it, vi } from "vitest";
import { VercelBlobStorage, type BlobClient } from "./vercel-blob";

function mockClient() {
  const files = new Map<string, { body: Buffer; contentType: string }>();
  const client = {
    put: vi.fn(async (pathname: string, body: Buffer, opts: { contentType: string }) => {
      files.set(pathname, { body, contentType: opts.contentType });
      return { pathname, url: `https://blob.example/${pathname}` };
    }),
    get: vi.fn(async (pathname: string) => {
      const f = files.get(pathname);
      if (!f) return null;
      return {
        statusCode: 200,
        stream: new Blob([new Uint8Array(f.body)]).stream(),
        headers: new Headers(),
        blob: { contentType: f.contentType, size: f.body.byteLength, pathname },
      };
    }),
    head: vi.fn(async (pathname: string) => {
      if (!files.has(pathname)) throw new BlobNotFoundError();
      return { pathname };
    }),
    del: vi.fn(async (pathname: string) => void files.delete(pathname)),
  };
  return { client, files };
}

describe("VercelBlobStorage", () => {
  it("stores privately, reads back, checks existence and deletes", async () => {
    const { client } = mockClient();
    const store = new VercelBlobStorage({ token: "tok", prefix: "driveeasy", client: client as unknown as BlobClient });
    const body = new TextEncoder().encode("hello");
    await store.put("licences/u1/a.png", body, "image/png");
    expect(client.put).toHaveBeenCalledWith(
      "driveeasy/licences/u1/a.png",
      expect.any(Buffer),
      expect.objectContaining({ access: "private", addRandomSuffix: false, token: "tok", contentType: "image/png" }),
    );
    const file = await store.get("licences/u1/a.png");
    expect(file?.body.toString()).toBe("hello");
    expect(file?.contentType).toBe("image/png");
    expect(await store.exists("licences/u1/a.png")).toBe(true);
    await store.delete("licences/u1/a.png");
    expect(await store.exists("licences/u1/a.png")).toBe(false);
    expect(await store.get("licences/u1/a.png")).toBeNull();
  });

  it("rejects path traversal keys", async () => {
    const { client } = mockClient();
    const store = new VercelBlobStorage({ token: "tok", client: client as unknown as BlobClient });
    await expect(store.put("../etc/passwd", new Uint8Array([1]), "text/plain")).rejects.toThrow(/Invalid storage key/);
    await expect(store.get("a/../../b")).rejects.toThrow(/Invalid storage key/);
  });
});
