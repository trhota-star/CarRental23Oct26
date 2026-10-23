// Local stand-in for cloud object storage: a private folder outside public/.

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileStorage, StoredFile } from "./types";

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_\-./]*$/;

export class LocalFileStorage implements FileStorage {
  readonly name = "local";
  readonly root: string;

  constructor(root: string, publicDir = path.resolve("public")) {
    this.root = path.resolve(root);
    const rel = path.relative(publicDir, this.root);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      throw new Error(`Uploads folder must not be inside ${publicDir}`);
    }
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<StoredFile> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
    const meta: StoredFile = { key, contentType, size: body.byteLength };
    await writeFile(`${file}.meta.json`, JSON.stringify(meta));
    return meta;
  }

  async get(key: string): Promise<(StoredFile & { body: Buffer }) | null> {
    const file = this.resolve(key);
    try {
      const [body, meta] = await Promise.all([readFile(file), readFile(`${file}.meta.json`, "utf8")]);
      return { ...(JSON.parse(meta) as StoredFile), body };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const file = this.resolve(key);
    await Promise.all([rm(file, { force: true }), rm(`${file}.meta.json`, { force: true })]);
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.resolve(key))).isFile();
    } catch {
      return false;
    }
  }

  private resolve(key: string): string {
    if (!KEY_PATTERN.test(key) || key.split("/").includes("..") || key.endsWith(".meta.json")) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    const file = path.resolve(this.root, key);
    if (!file.startsWith(this.root + path.sep)) throw new Error(`Invalid storage key: ${key}`);
    return file;
  }
}
