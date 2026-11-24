import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  EcfrBulkBlobSchema, EcfrBulkIndexSchema, EcfrBulkSnapshotSchema,
  err, ok, type EcfrBulkBlob, type EcfrBulkSnapshot, type Result,
} from '@civic-source/types';
import { checkStoreCapacity, inspectStoreCapacity, storeError, type StoreCapacity, type EcfrBulkStoreOptions } from './ecfr-bulk-capacity.js';
export type { EcfrBulkStoreOptions } from './ecfr-bulk-capacity.js';

/** Stable JSON bytes preserve array order while sorting object keys. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).filter((key) => record[key] !== undefined).sort()
      .map((key) => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
  }
  throw new Error('Value is not canonical JSON');
}

export function digestBytes(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function snapshotIdFor(snapshot: Omit<EcfrBulkSnapshot, 'snapshotId'>): string {
  const payload = Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== 'snapshotId'));
  return digestBytes(canonicalJson(payload));
}

function validId(id: string): string {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid eCFR content identity');
  return id;
}

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function inspectBytes(path: string): Promise<EcfrBulkBlob> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1) throw new Error('Artifact is not a regular unlinked file');
    const hash = createHash('sha256');
    let byteLength = 0;
    const buffer = Buffer.alloc(64 * 1024);
    for (;;) {
      const read = await file.read(buffer, 0, buffer.length, null);
      if (read.bytesRead === 0) break;
      byteLength += read.bytesRead;
      hash.update(buffer.subarray(0, read.bytesRead));
    }
    return { sha256: hash.digest('hex'), byteLength };
  } finally { await file.close(); }
}

async function checkedStagingPath(cacheDir: string, stagingDir: string, path: string): Promise<string> {
  const rel = relative(stagingDir, resolve(path));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Artifact staging file must be inside cache staging');
  const actualRoot = await realpath(cacheDir);
  const actualStaging = await realpath(stagingDir);
  if (!(await lstat(stagingDir)).isDirectory() || actualStaging !== join(actualRoot, 'staging')) {
    throw new Error('Artifact staging directory cannot be a symbolic link');
  }
  let parent = stagingDir;
  for (const part of rel.split(sep).slice(0, -1)) {
    parent = join(parent, part);
    if (!(await lstat(parent)).isDirectory()) throw new Error('Artifact staging ancestors cannot be symbolic links');
  }
  const actualParent = await realpath(dirname(resolve(path)));
  const parentRelative = relative(actualStaging, actualParent);
  if (parentRelative.startsWith('..') || isAbsolute(parentRelative)) throw new Error('Artifact staging ancestor escapes cache staging');
  return resolve(path);
}

function sameBlob(left: EcfrBulkBlob, right: EcfrBulkBlob): boolean {
  return left.sha256 === right.sha256 && left.byteLength === right.byteLength;
}

export class EcfrBulkStore {
  readonly cacheDir: string;
  readonly stagingDir: string;
  private readonly options: EcfrBulkStoreOptions;

  constructor(cacheDir: string, options: EcfrBulkStoreOptions = {}) {
    this.cacheDir = resolve(cacheDir);
    this.stagingDir = join(this.cacheDir, 'staging');
    this.options = options;
  }

  async init(): Promise<Result<void>> {
    try {
      for (const directory of ['objects', 'manifests', 'products', 'staging']) {
        await mkdir(join(this.cacheDir, directory), { recursive: true });
      }
      return ok(undefined);
    } catch (error: unknown) { return err(storeError(error)); }
  }

  blobPath(ref: EcfrBulkBlob): string {
    return join(this.cacheDir, 'objects', validId(ref.sha256));
  }

  inspectCapacity(): Promise<Result<StoreCapacity>> { return inspectStoreCapacity(this.cacheDir,this.options); }

  ensureCapacity(additionalBytes: number): Promise<Result<void>> {
    return checkStoreCapacity(this.cacheDir, additionalBytes, this.options);
  }

  async verifyBlob(ref: EcfrBulkBlob): Promise<Result<void>> {
    try {
      EcfrBulkBlobSchema.parse(ref);
      if (!sameBlob(await inspectBytes(this.blobPath(ref)), ref)) throw new Error('Artifact hash or byte length mismatch');
      return ok(undefined);
    } catch (error: unknown) { return err(storeError(error)); }
  }

  async readBlob(ref: EcfrBulkBlob, maxBytes = 64 * 1024 ** 2): Promise<Result<Buffer>> {
    try {
      EcfrBulkBlobSchema.parse(ref);
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || ref.byteLength > maxBytes) {
        return err(new Error('Artifact exceeds read byte limit'));
      }
      const verified = await this.verifyBlob(ref);
      if (!verified.ok) return verified;
      const bytes = await readFile(this.blobPath(ref));
      if (bytes.length > maxBytes || !sameBlob({ sha256: digestBytes(bytes), byteLength: bytes.length }, ref)) {
        return err(new Error('Artifact changed during read'));
      }
      return ok(bytes);
    } catch (error: unknown) { return err(storeError(error)); }
  }

  async putBlob(value: Uint8Array | string): Promise<Result<EcfrBulkBlob>> {
    const bytes = typeof value === 'string' ? Buffer.from(value) : value;
    const ref = { sha256: digestBytes(bytes), byteLength: bytes.byteLength };
    const temp = join(this.stagingDir, randomUUID());
    return this.cleanupAfter(temp, async () => {
      if (await this.exists(this.blobPath(ref))) {
        const verified = await this.verifyBlob(ref);
        return verified.ok ? ok(ref) : verified;
      }
      const capacity = await this.ensureCapacity(bytes.byteLength);
      if (!capacity.ok) return capacity;
      await this.writeFileSynced(temp, bytes);
      return await this.adoptBlob(temp, ref);
    });
  }

  async adoptBlob(tempFile: string, expected: EcfrBulkBlob): Promise<Result<EcfrBulkBlob>> {
    try {
      EcfrBulkBlobSchema.parse(expected);
      tempFile = await checkedStagingPath(this.cacheDir, this.stagingDir, tempFile);
      if (!sameBlob(await inspectBytes(tempFile), expected)) throw new Error('Staged artifact hash or byte length mismatch');
      const target = this.blobPath(expected);
      if (await this.exists(target)) {
        const verified = await this.verifyBlob(expected);
        if (!verified.ok) return verified;
      } else {
        const capacity = await this.ensureCapacity(0);
        if (!capacity.ok) return capacity;
        const staged = await open(tempFile, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { await staged.sync(); } finally { await staged.close(); }
        await link(tempFile, target);
      }
      await checkedStagingPath(this.cacheDir, this.stagingDir, tempFile);
      await unlink(tempFile);
      await this.syncDirectory(join(this.cacheDir, 'objects'));
      await this.syncDirectory(this.stagingDir);
      return ok(expected);
    } catch (error: unknown) { return err(storeError(error)); }
  }

  async loadSnapshot(id?: string): Promise<Result<EcfrBulkSnapshot>> {
    try {
      const selected: unknown = id ?? (JSON.parse(await readFile(join(this.cacheDir, 'current.json'), 'utf8')) as { snapshotId: unknown }).snapshotId;
      if (typeof selected !== 'string') throw new Error('Invalid current snapshot pointer');
      const parsed = EcfrBulkSnapshotSchema.parse(JSON.parse(await readFile(this.manifestPath(selected), 'utf8')));
      if (parsed.snapshotId !== selected) throw new Error('Snapshot manifest identity mismatch');
      const valid = await this.validateSnapshot(parsed);
      return valid.ok ? ok(parsed) : valid;
    } catch (error: unknown) { return err(storeError(error)); }
  }

  async acceptSnapshot(snapshot: EcfrBulkSnapshot, products?: readonly EcfrBulkBlob[]): Promise<Result<void>> {
    try {
      const parsed = EcfrBulkSnapshotSchema.parse(snapshot);
      const valid = await this.validateSnapshot(parsed);
      if (!valid.ok) return valid;
      if (products) {
        const prepared = await this.prepareProducts(parsed.snapshotId, products);
        if (!prepared.ok) return prepared;
      }
      const path = this.manifestPath(parsed.snapshotId);
      const content = canonicalJson(parsed) + '\n';
      if (await this.exists(path)) {
        if (await readFile(path, 'utf8') !== content) throw new Error('Refusing immutable snapshot replacement');
      } else {
        const written = await this.atomicJson(path, content, true);
        if (!written.ok) return written;
      }
      return await this.atomicJson(join(this.cacheDir, 'current.json'), canonicalJson({ snapshotId: parsed.snapshotId }) + '\n');
    } catch (error: unknown) { return err(storeError(error)); }
  }

  async registerProduct(snapshotId: string, blob: EcfrBulkBlob): Promise<Result<void>> {
    try {
      const snapshot = await this.loadSnapshot(snapshotId);
      if (!snapshot.ok) return snapshot;
      const verified = await this.verifyBlob(blob);
      if (!verified.ok) return verified;
      const prior = await this.listProducts(snapshotId);
      if (!prior.ok) return prior;
      if (prior.value.some((ref) => sameBlob(ref, blob))) return ok(undefined);
      const refs = [...prior.value, blob].sort((a, b) => a.sha256.localeCompare(b.sha256));
      return await this.atomicJson(this.productsPath(snapshotId), canonicalJson(refs) + '\n');
    } catch (error: unknown) { return err(storeError(error)); }
  }

  async listProducts(snapshotId: string): Promise<Result<EcfrBulkBlob[]>> {
    try {
      const path = this.productsPath(snapshotId);
      if (!await this.exists(path)) return ok([]);
      const refs = EcfrBulkBlobSchema.array().parse(JSON.parse(await readFile(path, 'utf8')));
      for (const ref of refs) {
        const verified = await this.verifyBlob(ref);
        if (!verified.ok) return verified;
      }
      return ok(refs);
    } catch (error: unknown) { return err(storeError(error)); }
  }

  async withLock<T>(work: () => Promise<Result<T>>): Promise<Result<T>> {
    const lockPath = join(this.cacheDir, 'writer.lock');
    try {
      const lock = await open(lockPath, 'wx', 0o600);
      await lock.close();
    } catch (error: unknown) { return err(storeError(error)); }
    return this.cleanupAfter(lockPath, work);
  }

  private async cleanupAfter<T>(path: string, work: () => Promise<Result<T>>): Promise<Result<T>> {
    let result: Result<T>;
    try { result = await work(); }
    catch (error: unknown) { result = err(storeError(error)); }
    try { await unlink(path); }
    catch (error: unknown) { if (!missing(error)) return err(storeError(error)); }
    return result;
  }

  private async prepareProducts(snapshotId: string, products: readonly EcfrBulkBlob[]): Promise<Result<void>> {
    const prior = await this.listProducts(snapshotId);
    if (!prior.ok) return prior;
    const refs = new Map(prior.value.map((ref) => [ref.sha256, ref]));
    for (const ref of products) {
      const verified = await this.verifyBlob(ref);
      if (!verified.ok) return verified;
      const previous = refs.get(ref.sha256);
      if (previous && !sameBlob(previous, ref)) return err(new Error('Conflicting product identity'));
      refs.set(ref.sha256, ref);
    }
    const values = [...refs.values()].sort((a, b) => a.sha256.localeCompare(b.sha256));
    return this.atomicJson(this.productsPath(snapshotId), canonicalJson(values) + '\n');
  }

  private manifestPath(id: string): string { return join(this.cacheDir, 'manifests', validId(id) + '.json'); }
  private productsPath(id: string): string { return join(this.cacheDir, 'products', validId(id) + '.json'); }

  private async exists(path: string): Promise<boolean> {
    try { await lstat(path); return true; }
    catch (error: unknown) { if (missing(error)) return false; throw error; }
  }

  private async validateSnapshot(snapshot: EcfrBulkSnapshot): Promise<Result<void>> {
    if (snapshotIdFor(snapshot) !== snapshot.snapshotId) return err(new Error('Snapshot digest mismatch'));
    for (const source of snapshot.sources) {
      const verified = await this.verifyBlob(source.blob);
      if (!verified.ok) return verified;
    }
    const bytes = await this.readBlob(snapshot.index);
    if (!bytes.ok) return bytes;
    const index = EcfrBulkIndexSchema.parse(JSON.parse(bytes.value.toString('utf8')));
    if (index.extractorVersion !== snapshot.extractorVersion || index.extractorDigest !== snapshot.extractorDigest ||
        index.titles.length !== snapshot.selectedTitles.length || new Set(index.titles.map((item) => item.cfrTitle)).size !== index.titles.length) {
      return err(new Error('Index extractor or title inventory mismatch'));
    }
    for (const title of index.titles) {
      const source = snapshot.sources.find((item) => item.title === title.cfrTitle);
      if (!source || title.sourceSha256 !== source.blob.sha256 || title.authorities.some((item) =>
        item.cfrTitle !== source.title || item.sourceSha256 !== source.blob.sha256)) {
        return err(new Error('Index source identity mismatch'));
      }
    }
    return ok(undefined);
  }

  private async writeFileSynced(path: string, bytes: Uint8Array): Promise<void> {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); }
    finally { await file.close(); }
  }

  private async syncDirectory(path: string): Promise<void> {
    const directory = await open(path, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }

  private async atomicJson(path: string, content: string, immutable = false): Promise<Result<void>> {
    const bytes = Buffer.from(content);
    const capacity = await this.ensureCapacity(bytes.length);
    if (!capacity.ok) return capacity;
    const temp = join(this.stagingDir, randomUUID());
    return this.cleanupAfter(temp, async () => {
      await this.writeFileSynced(temp, bytes);
      if (immutable) { await link(temp, path); await unlink(temp); }
      else await rename(temp, path);
      await this.syncDirectory(join(path, '..'));
      await this.syncDirectory(this.stagingDir);
      return ok(undefined);
    });
  }
}
