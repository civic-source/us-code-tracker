import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { err,ok,type Result } from '@civic-source/types';

export function verifyEcfrProducer(options: {repository:string;revision:string;extractorVersion:string;extractorDigest:string}): Result<string> {
  try{
    if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(options.revision))return err(new Error('Invalid producer commit identity'));
    const show=(path:string):Buffer=>execFileSync('git',['-C',options.repository,'show',options.revision+':'+path],{maxBuffer:1024**2,stdio:['ignore','pipe','pipe']});
    const python=show('scripts/python/ecfr_bulk_extract.py');
    const bridge=show('scripts/lib/ecfr-bulk-parser.ts');
    const digest=createHash('sha256').update(options.extractorVersion).update('\0').update(python).update('\0').update(bridge).digest('hex');
    if(digest!==options.extractorDigest)return err(new Error('Recorded producer commit does not contain the exact snapshot extractor'));
    for(const path of ['scripts/lib/ecfr-bulk-projection.ts','scripts/lib/ecfr-bulk-store.ts','scripts/lib/ecfr-bulk-sync.ts','packages/types/src/ecfr-bulk.ts']){
      if(!show(path).equals(readFileSync(join(options.repository,path))))return err(new Error('Recorded producer has a different projection/rebuild contract; sync and enrich a new generation before archival'));
    }
    return ok(options.revision);
  }catch(error:unknown){return err(new Error('Cannot verify recorded producer commit: '+(error instanceof Error?error.message:String(error))));}
}
