import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { verifyEcfrProducer } from '../lib/ecfr-bulk-producer.js';
it('verifies recorded extractor bytes in an older producer commit and rejects a false pin',async()=>{
 const repository=await mkdtemp(join(tmpdir(),'ecfr-producer-'));
 const git=(args:string[])=>execFileSync('git',['-C',repository,...args],{encoding:'utf8'}).trim();
 try{
  git(['init','-q']);await mkdir(join(repository,'scripts/python'),{recursive:true});await mkdir(join(repository,'scripts/lib'),{recursive:true});
  await writeFile(join(repository,'scripts/python/ecfr_bulk_extract.py'),'python');await writeFile(join(repository,'scripts/lib/ecfr-bulk-parser.ts'),'bridge');
  await mkdir(join(repository,'packages/types/src'),{recursive:true});
  for(const path of ['scripts/lib/ecfr-bulk-projection.ts','scripts/lib/ecfr-bulk-store.ts','scripts/lib/ecfr-bulk-sync.ts','packages/types/src/ecfr-bulk.ts'])await writeFile(join(repository,path),'recipe');git(['add','.']);
  git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture']);
  const revision=git(['rev-parse','HEAD']);const extractorVersion='v1';
  const extractorDigest=createHash('sha256').update('v1\0python\0bridge').digest('hex');
  expect(verifyEcfrProducer({repository,revision,extractorVersion,extractorDigest})).toEqual({ok:true,value:revision});
  expect(verifyEcfrProducer({repository,revision,extractorVersion,extractorDigest:'a'.repeat(64)}).ok).toBe(false);
  expect(verifyEcfrProducer({repository,revision:'0'.repeat(40),extractorVersion,extractorDigest}).ok).toBe(false);
  await writeFile(join(repository,'scripts/lib/ecfr-bulk-projection.ts'),'changed recipe');
  expect(verifyEcfrProducer({repository,revision,extractorVersion,extractorDigest}).ok).toBe(false);
 }finally{await rm(repository,{recursive:true,force:true});}
});
