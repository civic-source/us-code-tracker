import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { err, type Result } from '@civic-source/types';
import { canonicalJson, type EcfrBulkStore } from './ecfr-bulk-store.js';
import { storeError } from './ecfr-bulk-capacity.js';

async function writeReceipt(store: EcfrBulkStore, id: string, value: unknown): Promise<void> {
  const directory=join(store.cacheDir,'runs');await mkdir(directory,{recursive:true});
  const temp=join(store.stagingDir,randomUUID());
  try{
    const file=await open(temp,'wx',0o600);
    try{await file.writeFile(canonicalJson(value)+'\n');await file.sync();}finally{await file.close();}
    await rename(temp,join(directory,id+'.json'));
    const parent=await open(directory,'r');try{await parent.sync();}finally{await parent.close();}
  }finally{await unlink(temp).catch((error:unknown)=>{if(!(error instanceof Error && 'code' in error && error.code==='ENOENT'))throw error;});}
}
export async function recordEcfrRun<T>(store: EcfrBulkStore, details: {action:string;titles?:number[];since?:string}, work:()=>Promise<Result<T>>): Promise<Result<T>> {
  const runId=randomUUID(),startedAt=new Date().toISOString();
  const base={schemaVersion:'usct.ecfr-bulk-run/v1',runId,startedAt,...details};
  try{
    const capacity=await store.ensureCapacity(32768);if(!capacity.ok)return capacity;
    await writeReceipt(store,runId,{...base,state:'running'});
    let result: Result<T>;
    try{result=await work();}catch(error:unknown){result=err(storeError(error));}
    const value: unknown=result.ok ? result.value : undefined;
    const snapshotId=value && typeof value==='object' && 'snapshotId' in value && typeof value.snapshotId==='string' ? value.snapshotId : undefined;
    await writeReceipt(store,runId,{...base,finishedAt:new Date().toISOString(),state:result.ok?'succeeded':'failed',...(snapshotId?{snapshotId}:{}),...(!result.ok?{error:result.error.message.slice(0,8192)}:{})});
    return result;
  }catch(error:unknown){return err(new Error('Cannot persist eCFR run receipt; inspect the accepted snapshot before retrying: '+storeError(error).message));}
}
