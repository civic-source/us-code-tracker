import { createHash } from 'node:crypto';
import { open, unlink, type FileHandle } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { err, ok, type EcfrBulkBlob, type EcfrBulkSource, type Result } from '@civic-source/types';

const ROOT = 'https://www.govinfo.gov/bulkdata/json/ECFR';
const LISTING_LIMIT = 65_536;
const SOURCE_LIMIT = 256 * 1024 * 1024;

export interface EcfrBulkSourceMetadata {
  title: number;
  url: string;
  byteLength: number;
  lastModified: string | null;
}
export interface EcfrBulkInventory {
  titles: number[];
  sources: EcfrBulkSourceMetadata[];
}
export interface EcfrBulkDownload {
  notModified: boolean;
  blob?: EcfrBulkBlob;
  lastModified: string | null;
  retrievedAt: string;
}
export interface EcfrBulkSourceClientOptions {
  fetch?: typeof fetch;
  requestIntervalMs?: number;
  maxSourceBytes?: number;
}

function failure(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected listing object');
  return value as Record<string, unknown>;
}
function validTitle(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 50;
}
function sourceUrl(title: number): string {
  return `https://www.govinfo.gov/bulkdata/ECFR/title-${title}/ECFR-title${title}.xml`;
}
function listingFiles(payload: unknown): Record<string, unknown>[] {
  const files = object(payload)['files'];
  if (!Array.isArray(files) || files.length > 100) throw new Error('Invalid listing files');
  return files.map((file: unknown) => object(file));
}
function listingDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2}$/.test(value)) throw new Error('Invalid publisher listing date');
  const date = new Date(`${value} GMT`);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid publisher listing date');
  return date.toISOString();
}
function responseDate(response: Response): string | null {
  const value = response.headers.get('Last-Modified');
  if (value === null) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid HTTP modification date');
  return date.toISOString();
}
function rootTitles(payload: unknown): number[] {
  const titles: number[] = [];
  for (const file of listingFiles(payload)) {
    const title = file['cfrTitle'];
    if (validTitle(title) && file['folder'] === true && file['name'] === `title-${title}` && file['link'] === `${ROOT}/title-${title}`) {
      if (titles.includes(title)) throw new Error('Duplicate CFR title');
      titles.push(title);
    } else if (file['name'] === 'resources' && file['folder'] === true && file['link'] === `${ROOT}/resources`) {
      continue;
    } else if (file['name'] === 'ECFR-DCTM-vs-BULKDATA' && file['folder'] === false && file['link'] === 'https://www.govinfo.gov/bulkdata/ECFR/ECFR-DCTM-vs-BULKDATA') {
      continue;
    } else throw new Error('Unexpected publisher inventory identity');
  }
  if (titles.length === 0) throw new Error('Empty CFR title inventory');
  return titles.sort((a, b) => a - b);
}
function sourceMetadata(payload: unknown, title: number, cap: number): EcfrBulkSourceMetadata {
  let source: EcfrBulkSourceMetadata | undefined;
  const names = new Set<string>();
  for (const file of listingFiles(payload)) {
    const xml = file['name'] === `ECFR-title${title}.xml`;
    const name = xml ? `ECFR-title${title}.xml` : `ECFR-title${title}-graphics.zip`;
    const url = xml ? sourceUrl(title) : `https://www.govinfo.gov/bulkdata/ECFR/title-${title}/${name}`;
    const size = file['size'];
    if (file['name'] !== name || file['justFileName'] !== name || file['folder'] !== false ||
        file['link'] !== url || file['fileExtension'] !== (xml ? 'xml' : 'zip') ||
        file['mimeType'] !== (xml ? 'application/xml' : 'application/zip') ||
        typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || names.has(name)) {
      throw new Error(`Invalid source listing for CFR title ${title}`);
    }
    names.add(name);
    const lastModified = listingDate(file['formattedLastModifiedTime']);
    if (xml) {
      if (size > cap) throw new Error(`CFR title ${title} exceeds source byte limit`);
      source = { title, url, byteLength: size, lastModified };
    }
  }
  if (!source) throw new Error(`Missing XML for CFR title ${title}`);
  return source;
}
async function cancelBody(response: Response | undefined): Promise<Result<void>> {
  try {
    if (response?.body && !response.bodyUsed && !response.body.locked) await response.body.cancel();
    return ok(undefined);
  } catch (error: unknown) {
    return err(failure(error));
  }
}
async function boundedBody(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) throw new Error('Missing HTTP response body');
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > limit) throw new Error('Listing exceeds byte limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}
function assertMetadata(metadata: EcfrBulkSourceMetadata, cap: number): void {
  if (!validTitle(metadata.title) || metadata.url !== sourceUrl(metadata.title) ||
      !Number.isSafeInteger(metadata.byteLength) || metadata.byteLength <= 0 || metadata.byteLength > cap) {
    throw new Error('Invalid or oversized source metadata');
  }
}
function validateTransport(response: Response, metadata: EcfrBulkSourceMetadata): void {
  if (response.status !== 200 || response.redirected) throw new Error(`Unexpected source HTTP status ${response.status}`);
  const mime = response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
  if (mime !== 'text/xml' && mime !== 'application/xml') throw new Error('Source response is not XML');
  const length = response.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) !== metadata.byteLength)) {
    throw new Error('Source Content-Length differs from inventory');
  }
  if (!response.body) throw new Error('Missing source body');
}
async function streamSource(response: Response, file: FileHandle, metadata: EcfrBulkSourceMetadata, cap: number): Promise<EcfrBulkBlob> {
  const hash = createHash('sha256');
  let byteLength = 0;
  let prefix = Buffer.alloc(0);
  if (!response.body) throw new Error('Missing source body');
  for await (const chunk of response.body) {
    byteLength += chunk.byteLength;
    if (byteLength > cap || byteLength > metadata.byteLength) throw new Error('Source stream exceeds byte limit');
    if (prefix.length < 4096) prefix = Buffer.concat([prefix, chunk.subarray(0, 4096 - prefix.length)]);
    hash.update(chunk);
    await file.writeFile(chunk);
  }
  if (byteLength !== metadata.byteLength) throw new Error('Source stream is incomplete');
  if (!/^\uFEFF?\s*(?:<\?xml[^?]*\?>\s*)?<DLPSTEXTCLASS(?:\s|>)/.test(prefix.toString('utf8'))) {
    throw new Error('Source body has an unexpected XML root');
  }
  await file.sync();
  return { sha256: hash.digest('hex'), byteLength };
}

export class EcfrBulkSourceClient {
  private readonly transport: typeof fetch;
  private readonly interval: number;
  private readonly cap: number;
  private lastStart = -Infinity;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: EcfrBulkSourceClientOptions = {}) {
    this.transport = options.fetch ?? fetch;
    this.interval = options.requestIntervalMs ?? 1100;
    this.cap = options.maxSourceBytes ?? SOURCE_LIMIT;
    if (!Number.isSafeInteger(this.interval) || this.interval < 0 || !Number.isSafeInteger(this.cap) || this.cap <= 0) {
      throw new Error('Invalid bulk source client limits');
    }
  }

  private request(url: string, headers: Record<string, string>): Promise<Response> {
    const request = this.queue.then(async () => {
      while (performance.now() - this.lastStart < this.interval) {
        await delay(Math.ceil(this.interval - (performance.now() - this.lastStart)));
      }
      try { return this.transport(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(120_000) }); }
      finally { this.lastStart = performance.now(); }
    });
    this.queue = request.then(() => undefined, () => undefined);
    return request;
  }

  private async listing(url: string): Promise<unknown> {
    const response = await this.request(url, { Accept: 'application/json' });
    try {
      if (response.status !== 200 || response.redirected || response.headers.get('Content-Type')?.split(';')[0]?.trim() !== 'application/json') {
        throw new Error('Publisher listing response is not successful JSON');
      }
      const data = await boundedBody(response, LISTING_LIMIT);
      const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
      const cleanup = await cancelBody(response);
      if (!cleanup.ok) throw cleanup.error;
      return payload;
    } catch (error: unknown) {
      const cleanup = await cancelBody(response);
      throw cleanup.ok ? error : new AggregateError([error, cleanup.error], 'Listing and cleanup failed', { cause: error });
    }
  }

  async inventory(selectedTitles?: number[]): Promise<Result<EcfrBulkInventory>> {
    try {
      const titles = rootTitles(await this.listing(ROOT));
      const selected = selectedTitles ?? titles;
      if (selected.length === 0 || new Set(selected).size !== selected.length || selected.some((title) => !titles.includes(title))) {
        throw new Error('Requested titles are absent or repeated in the current inventory');
      }
      const sources: EcfrBulkSourceMetadata[] = [];
      for (const title of [...selected].sort((a, b) => a - b)) {
        sources.push(sourceMetadata(await this.listing(`${ROOT}/title-${title}`), title, this.cap));
      }
      return ok({ titles, sources });
    } catch (error: unknown) {
      return err(failure(error));
    }
  }

  private async persist(response: Response, metadata: EcfrBulkSourceMetadata, destinationPath: string): Promise<EcfrBulkBlob> {
    const file = await open(destinationPath, 'wx', 0o600);
    try {
      const blob = await streamSource(response, file, metadata, this.cap);
      await file.close();
      return blob;
    } catch (error: unknown) {
      const cleanup = await Promise.allSettled([file.close(), unlink(destinationPath)]);
      const errors = cleanup.flatMap((result) => result.status === 'rejected' ? [result.reason as unknown] : []);
      if (errors.length) throw new AggregateError([error, ...errors], 'Source and staging cleanup failed', { cause: error });
      throw error;
    }
  }

  async download(metadata: EcfrBulkSourceMetadata, destinationPath: string, previous?: EcfrBulkSource): Promise<Result<EcfrBulkDownload>> {
    let response: Response | undefined;
    try {
      assertMetadata(metadata, this.cap);
      if (previous && (previous.title !== metadata.title || previous.url !== metadata.url)) throw new Error('Conditional source identity mismatch');
      const canValidate = previous?.lastModified && metadata.lastModified !== null &&
        Number.isFinite(Date.parse(previous.lastModified)) && Number.isFinite(Date.parse(metadata.lastModified)) &&
        Math.floor(Date.parse(previous.lastModified) / 60_000) === Math.floor(Date.parse(metadata.lastModified) / 60_000) &&
        previous.blob.byteLength === metadata.byteLength;
      const validator = canValidate ? previous.lastModified : undefined;
      const headers: Record<string, string> = { Accept: 'application/xml', 'Accept-Encoding': 'identity' };
      if (validator) headers['If-Modified-Since'] = new Date(validator).toUTCString();
      response = await this.request(metadata.url, headers);
      const lastModified = responseDate(response);
      const retrievedAt = new Date().toISOString();
      let value: EcfrBulkDownload;
      if (response.status === 304) {
        if (!validator || !Number.isFinite(Date.parse(validator)) || previous?.blob.byteLength !== metadata.byteLength ||
            (lastModified !== null && Date.parse(lastModified) > Date.parse(validator))) throw new Error('Unexpected or inconsistent conditional response');
        value = { notModified: true, lastModified: lastModified ?? validator, retrievedAt };
      } else {
        validateTransport(response, metadata);
        const blob = await this.persist(response, metadata, destinationPath);
        value = { notModified: false, blob, lastModified, retrievedAt };
      }
      const cleanup = await cancelBody(response);
      if (!cleanup.ok) return err(cleanup.error);
      return ok(value);
    } catch (error: unknown) {
      const cleanup = await cancelBody(response);
      return err(cleanup.ok ? failure(error) : new AggregateError([error, cleanup.error], 'Source and response cleanup failed'));
    }
  }
}
