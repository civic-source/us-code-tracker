import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { HASH_STORE_DIR, HASH_STORE_FILE } from './constants.js';

type HashRecord = Record<string, string>;

/**
 * File-based SHA-256 hash storage for idempotency checking.
 * Stores hashes in `.openlaw-git/hashes.json`.
 */
export class HashStore {
  private readonly dirPath: string;
  private readonly filePath: string;

  constructor(basePath: string = process.cwd()) {
    this.dirPath = join(basePath, HASH_STORE_DIR);
    this.filePath = join(this.dirPath, HASH_STORE_FILE);
  }

  /** Retrieve the stored hash for a key, or undefined if not found */
  async getHash(key: string): Promise<string | undefined> {
    const data = await this.load();
    return data[key];
  }

  /** Store a hash for a key, persisting to disk */
  async setHash(key: string, hash: string): Promise<void> {
    const data = await this.load();
    data[key] = hash;
    await this.save(data);
  }

  /** Check whether a new hash differs from the stored one */
  async hasChanged(key: string, newHash: string): Promise<boolean> {
    const stored = await this.getHash(key);
    return stored !== newHash;
  }

  private async load(): Promise<HashRecord> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as HashRecord;
    } catch {
      return {};
    }
  }

  private async save(data: HashRecord): Promise<void> {
    await mkdir(this.dirPath, { recursive: true });
    await writeFile(this.filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }
}
