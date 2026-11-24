import { randomUUID } from 'node:crypto';
import { lstat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { EcfrBulkIndexSchema, EcfrBulkProjectionSchema, err, ok, type EcfrBulkIndex, type EcfrBulkSnapshot, type EcfrBulkSource, type Result } from '@civic-source/types';
import type { StoreCapacity } from './ecfr-bulk-capacity.js';
import { EcfrBulkStore, canonicalJson, snapshotIdFor } from './ecfr-bulk-store.js';
import { EcfrBulkSourceClient, type EcfrBulkInventory, type EcfrBulkSourceMetadata } from './ecfr-bulk-source.js';
import { recoverAcquisition, recordAcquisition } from './ecfr-bulk-acquisition.js';
import { projectEcfrCohort } from './ecfr-bulk-projection.js';
import { extractTitle, extractorIdentity } from './ecfr-bulk-parser.js';

interface SyncOptions {
  store: EcfrBulkStore;
  titles?: number[];
  since?: string;
  producerRevision?: string;
  client?: EcfrBulkSourceClient;
  onProgress?: (message: string) => void;
}
const INDEX_ALLOWANCE = 64 * 1024 ** 2;
const failure = (error: unknown): Error => error instanceof Error ? error : new Error(String(error));

export function sinceTimestamp(value: string): Result<number> {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(value)) return err(new Error('--since must be a UTC date or timestamp'));
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0,10) !== value.slice(0,10)) return err(new Error('Invalid --since date'));
  return ok(time);
}

async function baselineFor(store: EcfrBulkStore): Promise<Result<EcfrBulkSnapshot | undefined>> {
  try { await lstat(join(store.cacheDir,'current.json')); }
  catch(error: unknown) {
    if(error instanceof Error && 'code' in error && error.code === 'ENOENT') return ok(undefined);
    return err(failure(error));
  }
  return store.loadSnapshot();
}

export async function planEcfrCapture(options: Pick<SyncOptions,'store'|'titles'|'client'>): Promise<Result<EcfrBulkInventory & {requiredAdditionalBytes:number;capacity:StoreCapacity}>> {
  const inventory = await (options.client ?? new EcfrBulkSourceClient()).inventory(options.titles);
  if (!inventory.ok) return inventory;
  const bytes = inventory.value.sources.reduce((sum,source)=>sum+source.byteLength,0);
  const requiredAdditionalBytes = bytes + Math.max(...inventory.value.sources.map(source=>source.byteLength)) + INDEX_ALLOWANCE * 2;
  const capacity = await options.store.ensureCapacity(requiredAdditionalBytes);
  if(!capacity.ok)return capacity;
  const status=await options.store.inspectCapacity();
  return status.ok ? ok({...inventory.value,requiredAdditionalBytes,capacity:status.value}) : status;
}

function unchangedMetadata(metadata: EcfrBulkSourceMetadata, previous: EcfrBulkSource): boolean {
  return metadata.lastModified !== null && previous.lastModified !== null &&
    Math.floor(Date.parse(metadata.lastModified)/60000) === Math.floor(Date.parse(previous.lastModified)/60000) &&
    metadata.byteLength === previous.blob.byteLength;
}

async function acquireSource(options: SyncOptions, metadata: EcfrBulkSourceMetadata, previous: EcfrBulkSource | undefined, cutoff: number | undefined): Promise<Result<EcfrBulkSource>> {
  if(!previous){const recovered=await recoverAcquisition(options.store,metadata);if(!recovered.ok)return recovered;previous=recovered.value;}
  const temp = join(options.store.stagingDir,randomUUID()+'.xml');
  try {
    const downloaded = await (options.client ?? new EcfrBulkSourceClient()).download(metadata,temp,previous && unchangedMetadata(metadata,previous) && (cutoff === undefined || (metadata.lastModified !== null && Date.parse(metadata.lastModified) < cutoff)) ? previous : undefined);
    if (!downloaded.ok) return downloaded;
    if (downloaded.value.notModified) return previous ? ok(previous) : err(new Error('Source returned 304 without baseline'));
    const blob = downloaded.value.blob;
    if (!blob) return err(new Error('Source download omitted bytes'));
    const adopted = await options.store.adoptBlob(temp,blob);
    if (!adopted.ok) return adopted;
    if (previous?.blob.sha256 === blob.sha256 && previous.blob.byteLength === blob.byteLength && previous.lastModified === downloaded.value.lastModified) return ok(previous);
    const source: EcfrBulkSource={title:metadata.title,url:metadata.url,blob,lastModified:downloaded.value.lastModified,retrievedAt:downloaded.value.retrievedAt,amendmentDateText:null};
    const recorded=await recordAcquisition(options.store,source);
    return recorded.ok ? ok(source) : recorded;
  } catch(error: unknown) {return err(failure(error));}
  finally { await unlink(temp).catch((error: unknown)=>{if (!(error instanceof Error && 'code' in error && error.code==='ENOENT')) throw error;}); }
}

export async function buildEcfrIndex(store: EcfrBulkStore, sources: EcfrBulkSource[]): Promise<Result<EcfrBulkIndex>> {
  const identity = await extractorIdentity();
  if (!identity.ok) return identity;
  const titles: EcfrBulkIndex['titles'] = [];
  for (const source of [...sources].sort((a,b)=>a.title-b.title)) {
    const verified = await store.verifyBlob(source.blob);
    if (!verified.ok) return verified;
    const extracted = await extractTitle({filePath:store.blobPath(source.blob),cfrTitle:source.title,sourceSha256:source.blob.sha256});
    if (!extracted.ok) return extracted;
    titles.push(extracted.value);
  }
  return ok({schemaVersion:'usct.ecfr-bulk-index/v1',extractorVersion:identity.value.version,extractorDigest:identity.value.digest,titles});
}

async function capture(options: SyncOptions, baseline: EcfrBulkSnapshot | undefined, cutoff: number | undefined): Promise<Result<EcfrBulkSnapshot>> {
  const planned = await planEcfrCapture(options);
  if (!planned.ok) return planned;
  const sources: EcfrBulkSource[] = [];
  for (const metadata of planned.value.sources) {
    options.onProgress?.(`Acquiring CFR title ${metadata.title}`);
    const source = await acquireSource(options,metadata,baseline?.sources.find(item=>item.title===metadata.title),cutoff);
    if (!source.ok) return source;
    sources.push(source.value);
  }
  options.onProgress?.('Building local authority index');
  const index = await buildEcfrIndex(options.store,sources);
  if (!index.ok) return index;
  const stored = await options.store.putBlob(canonicalJson(index.value)+'\n');
  if (!stored.ok) return stored;
  const selectedTitles = sources.map(source=>source.title).sort((a,b)=>a-b);
  if (baseline && (!options.producerRevision || baseline.producerRevision===options.producerRevision) && baseline.index.sha256===stored.value.sha256 && canonicalJson(baseline.selectedTitles)===canonicalJson(selectedTitles) && canonicalJson(baseline.inventoryTitles)===canonicalJson(planned.value.titles) && canonicalJson(baseline.sources)===canonicalJson(sources)) return ok(baseline);
  const payload: Omit<EcfrBulkSnapshot,'snapshotId'> = {schemaVersion:'usct.ecfr-bulk-snapshot/v1',capturedAt:new Date().toISOString(),inventoryTitles:planned.value.titles,selectedTitles,sources:sources.map(source=>({...source,amendmentDateText:index.value.titles.find(title=>title.cfrTitle===source.title)?.amendmentDateText ?? null})),extractorVersion:index.value.extractorVersion,extractorDigest:index.value.extractorDigest,index:stored.value,...(options.producerRevision ? {producerRevision:options.producerRevision} : {})};
  const snapshot = {...payload,snapshotId:snapshotIdFor(payload)};
  const accepted = await options.store.acceptSnapshot(snapshot);
  return accepted.ok ? ok(snapshot) : accepted;
}

export async function syncEcfrSnapshot(options: SyncOptions): Promise<Result<EcfrBulkSnapshot>> {
  try {
    const initialized = await options.store.init();
    if (!initialized.ok) return initialized;
    return await options.store.withLock(async()=>{
      const baseline = await baselineFor(options.store);
      if (!baseline.ok) return baseline;
      const cutoff = options.since === undefined ? ok(undefined) : sinceTimestamp(options.since);
      if (!cutoff.ok) return cutoff;
      if (options.since && !baseline.value) return err(new Error('--since requires a verified local baseline'));
      return capture({...options,client:options.client ?? new EcfrBulkSourceClient()},baseline.value,cutoff.value);
    });
  } catch(error: unknown) {return err(failure(error));}
}

export async function rebuildEcfrSnapshot(store: EcfrBulkStore, snapshotId?: string): Promise<Result<EcfrBulkSnapshot>> {
  const snapshot = await store.loadSnapshot(snapshotId);
  if (!snapshot.ok) return snapshot;
  const capacity = await store.ensureCapacity(INDEX_ALLOWANCE);
  if (!capacity.ok) return capacity;
  const index = await buildEcfrIndex(store,snapshot.value.sources);
  if (!index.ok) return index;
  const original = await store.readBlob(snapshot.value.index);
  if (!original.ok) return original;
  if (canonicalJson(index.value)+'\n' !== original.value.toString('utf8')) return err(new Error('Offline replay differs; use the archived producer revision/extractor, or explicitly sync a new generation'));
  const products=await replayProducts(store,snapshot.value,index.value);
  return products.ok ? ok(snapshot.value) : products;
}

export async function readEcfrIndex(store: EcfrBulkStore, snapshot: EcfrBulkSnapshot): Promise<Result<EcfrBulkIndex>> {
  const bytes = await store.readBlob(snapshot.index);
  if(!bytes.ok)return bytes;
  try {return ok(EcfrBulkIndexSchema.parse(JSON.parse(bytes.value.toString('utf8'))));}
  catch(error:unknown){return err(failure(error));}
}

async function replayProducts(store: EcfrBulkStore, snapshot: EcfrBulkSnapshot, index: EcfrBulkIndex): Promise<Result<void>> {
  const products=await store.listProducts(snapshot.snapshotId);if(!products.ok)return products;
  try{
    for(const ref of products.value){
      const bytes=await store.readBlob(ref);if(!bytes.ok)return bytes;
      const product=EcfrBulkProjectionSchema.parse(JSON.parse(bytes.value.toString('utf8')));
      const rebuilt=projectEcfrCohort(snapshot,index,product.uscTitle,product.cohort);if(!rebuilt.ok)return rebuilt;
      if(canonicalJson(rebuilt.value)+'\n'!==bytes.value.toString('utf8'))return err(new Error('Offline projection replay differs; use the archived producer revision/projection contract'));
    }
    return ok(undefined);
  }catch(error:unknown){return err(new Error('Cannot replay archived product: '+failure(error).message));}
}
