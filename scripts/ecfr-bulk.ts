#!/usr/bin/env node
import { recordEcfrRun } from './lib/ecfr-bulk-receipt.js';
import { writeEcfrProduct } from './lib/ecfr-bulk-output.js';
import { parseArgs } from 'node:util';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EcfrBulkStore, canonicalJson } from './lib/ecfr-bulk-store.js';
import { planEcfrCapture, readEcfrIndex, rebuildEcfrSnapshot, syncEcfrSnapshot } from './lib/ecfr-bulk-sync.js';
import { projectEcfrCohort } from './lib/ecfr-bulk-projection.js';
import { err, ok, type Result } from '@civic-source/types';

const options = {action:{type:'string'},cache:{type:'string'},titles:{type:'string'},since:{type:'string'},snapshot:{type:'string'},'usc-title':{type:'string'},sections:{type:'string'},'data-repo':{type:'string'},limit:{type:'string'},output:{type:'string'},input:{type:'string'},repository:{type:'string'},tag:{type:'string'},'max-cache-gib':{type:'string'},'min-free-gib':{type:'string'},help:{type:'boolean'}} as const;
type Flags = ReturnType<typeof flags>;
function flags(args: string[]) {return parseArgs({args,options,strict:true}).values;}
function positive(value: string | undefined, fallback: number): number {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error('Resource limits must be nonnegative numbers');
  return result;
}
function selectedTitles(value: string | undefined): number[] | undefined {
  if (!value || value==='all') return undefined;
  const values = value.split(',').map(Number);
  if(values.some(title=>!Number.isInteger(title)||title<1||title>50)||new Set(values).size!==values.length)throw new Error('Invalid --titles list');
  return values.sort((a,b)=>a-b);
}
function revision(requireClean = false): string {
  const root=fileURLToPath(new URL('../',import.meta.url));
  if(requireClean && execFileSync('git',['-C',root,'status','--porcelain','--untracked-files=all','--','scripts/ecfr-bulk.ts','scripts/lib/ecfr-bulk-*.ts','scripts/python/ecfr_bulk_*.py','packages/types/src','pnpm-lock.yaml'],{encoding:'utf8'}).trim())throw new Error('Commit the producer code before GitHub archival so the release tag can retain the exact extractor');
  return execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
}
async function cohort(values: Flags): Promise<string[]> {
  if(values.sections)return values.sections.split(',');
  if(!values['data-repo'] || !values['usc-title'])throw new Error('Provide --sections or --data-repo with --usc-title');
  const directory=resolve(values['data-repo'],'statutes','title-'+values['usc-title']);
  const names=await readdir(directory,{recursive:true});
  const sections=names.filter(name=>/(?:^|\/)section-[^/]+\.md$/.test(name)).map(name=>name.split('/').pop()!.replace(/^section-/,'').replace(/\.md$/,''));
  sections.sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));
  const limit=positive(values.limit,sections.length);
  if(!Number.isInteger(limit)||limit<1)throw new Error('--limit must be a positive integer');
  return sections.slice(0,limit);
}
async function enrich(store: EcfrBulkStore, values: Flags): Promise<Result<unknown>> {
  const snapshot=await store.loadSnapshot(values.snapshot);
  if(!snapshot.ok)return snapshot;
  const index=await readEcfrIndex(store,snapshot.value);
  if(!index.ok)return index;
  const projected=projectEcfrCohort(snapshot.value,index.value,values['usc-title'] ?? '18',await cohort(values));
  if(!projected.ok)return projected;
  const bytes=canonicalJson(projected.value)+'\n';
  const product=await store.putBlob(bytes);
  if(!product.ok)return product;
  const registered=await store.registerProduct(snapshot.value.snapshotId,product.value);
  if(!registered.ok)return registered;
  if(values.output){const output=await writeEcfrProduct(values.output,bytes,{minFreeBytes:positive(values['min-free-gib'],2)*1024**3});if(!output.ok)return output;}
  return ok({snapshotId:snapshot.value.snapshotId,product:product.value,sections:projected.value.sections.length,matchedSections:projected.value.sections.filter(section=>section.hits.length>0).length,hits:projected.value.sections.reduce((sum,section)=>sum+section.hits.length,0),corpusComplete:projected.value.corpusComplete,unresolvedCitationCount:projected.value.unresolvedCitationCount});
}
async function archiveAction(store: EcfrBulkStore, values: Flags): Promise<Result<unknown>> {
  const archive=await import('./lib/ecfr-bulk-archive.js');
  const snapshot=await store.loadSnapshot(values.snapshot);
  if(values.action==='import') {
    if(!values.input)return err(new Error('--input is required'));
    return archive.importSnapshot(store,resolve(values.input));
  }
  if(!snapshot.ok)return snapshot;
  if(!values.output)return err(new Error('--output is required'));
  return archive.exportSnapshot(store,snapshot.value.snapshotId,resolve(values.output));
}
async function githubAction(store: EcfrBulkStore, values: Flags): Promise<Result<unknown>> {
  const github=await import('./lib/ecfr-bulk-archive-github.js');
  const repository=values.repository ?? 'civic-source/us-code-tracker';
  if(values.action==='restore') {
    if(!values.tag)return err(new Error('--tag is required'));
    return github.restoreFromGithub({store,repository,tag:values.tag});
  }
  const snapshot=await store.loadSnapshot(values.snapshot);
  if(!snapshot.ok)return snapshot;
  return github.archiveToGithub({store,snapshotId:snapshot.value.snapshotId,repository,producerRevision:revision(true)});
}
async function run(values: Flags): Promise<Result<unknown>> {
  const store=new EcfrBulkStore(resolve(values.cache ?? '.workbench/ecfr-bulk'),{maxCacheBytes:positive(values['max-cache-gib'],16)*1024**3,minFreeBytes:positive(values['min-free-gib'],2)*1024**3});
  const initialized=await store.init();if(!initialized.ok)return initialized;
  const titles=selectedTitles(values.titles);
  const execute=async():Promise<Result<unknown>>=>{
  switch(values.action){
    case 'plan':return planEcfrCapture({store,...(titles?{titles}:{})});
    case 'sync':return syncEcfrSnapshot({store,...(titles?{titles}:{}),...(values.since?{since:values.since}:{}),producerRevision:revision(),onProgress:message=>process.stderr.write(message+'\n')});
    case 'rebuild':return store.withLock(()=>rebuildEcfrSnapshot(store,values.snapshot));
    case 'verify':case 'status': {
      const snapshot=await store.loadSnapshot(values.snapshot);
      if(!snapshot.ok)return snapshot;
      const products=await store.listProducts(snapshot.value.snapshotId);if(!products.ok)return products;
      const capacity=await store.ensureCapacity(0);if(!capacity.ok)return capacity;
      const disk=await store.inspectCapacity();if(!disk.ok)return disk;
      return ok({cacheDir:store.cacheDir,capacity:disk.value,snapshot:snapshot.value,products:products.value});
    }
    case 'enrich':return store.withLock(()=>enrich(store,values));
    case 'export':case 'import':return store.withLock(()=>archiveAction(store,values));
    case 'archive':case 'restore':return store.withLock(()=>githubAction(store,values));
    default:return err(new Error('Use --action plan|sync|rebuild|verify|status|enrich|export|import|archive|restore'));
  }
  };
  if(values.action==='plan'||values.action==='status'||values.action==='verify')return execute();
  return recordEcfrRun(store,{action:values.action ?? 'unknown',...(titles?{titles}:{}),...(values.since?{since:values.since}:{})},execute);
}
export async function main(args: string[]): Promise<number> {
  try {
    const values=flags(args);
    if(values.help){process.stdout.write('eCFR bulk: --action plan|sync|rebuild|verify|status|enrich|export|import|archive|restore --cache PATH --titles 19,28|all\nRefresh: --since YYYY-MM-DD; enrichment: --usc-title 18 --data-repo PATH --limit 100 or --sections 1,2\nArchive: --output PATH; import: --input PATH; GitHub: --repository OWNER/REPO --tag TAG (restore)\nCapacity: --max-cache-gib 16 --min-free-gib 2; defaults protect the cache filesystem.\n');return 0;}
    const result=await run(values);
    if(!result.ok){process.stderr.write(result.error.message+'\n');return 1;}
    process.stdout.write(JSON.stringify(result.value,null,2)+'\n');return 0;
  }catch(error:unknown){process.stderr.write((error instanceof Error?error.message:String(error))+'\n');return 1;}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=await main(process.argv.slice(2));
