import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { err } from '@civic-source/types';
import { EcfrBulkStore } from '../lib/ecfr-bulk-store.js';
import { recordEcfrRun } from '../lib/ecfr-bulk-receipt.js';
it('retains failed attempt diagnostics separately from the accepted pointer',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ecfr-receipt-'));
 try{
  const store=new EcfrBulkStore(directory,{minFreeBytes:0});await store.init();
  const result=await recordEcfrRun(store,{action:'sync',titles:[28]},async()=>err(new Error('Source interrupted')));
  expect(result.ok).toBe(false);
  const names=await readdir(join(directory,'runs'));expect(names).toHaveLength(1);
  expect(JSON.parse(await readFile(join(directory,'runs',names[0]!),'utf8'))).toMatchObject({state:'failed',error:'Source interrupted',action:'sync'});
 }finally{await rm(directory,{recursive:true,force:true});}
});
