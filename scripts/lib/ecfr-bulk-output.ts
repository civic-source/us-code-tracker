import { randomUUID } from 'node:crypto';
import { link, mkdir, open, statfs, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { err, ok, type Result } from '@civic-source/types';
import { storeError } from './ecfr-bulk-capacity.js';

export async function writeEcfrProduct(path: string, content: string, options: {minFreeBytes?:number;capacityProvider?:()=>Promise<number>} = {}): Promise<Result<void>> {
  const directory=dirname(resolve(path));
  const temp=join(directory,'.ecfr-'+randomUUID());
  try {
    const bytes=Buffer.from(content);
    if(bytes.length>64*1024**2)return err(new Error('Product exceeds 64 MiB output limit'));
    await mkdir(directory,{recursive:true});
    const fs=await statfs(directory,{bigint:true});
    const free=options.capacityProvider ? await options.capacityProvider() : Number(fs.bavail*fs.bsize);
    if(free<bytes.length+(options.minFreeBytes ?? 2*1024**3))return err(new Error('Insufficient space on product output filesystem'));
    const file=await open(temp,'wx',0o600);
    try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
    await link(temp,resolve(path));
    await unlink(temp);
    const parent=await open(directory,'r');try{await parent.sync();}finally{await parent.close();}
    return ok(undefined);
  }catch(error:unknown){return err(storeError(error));}
  finally{await unlink(temp).catch((error:unknown)=>{if(!(error instanceof Error && 'code' in error && error.code==='ENOENT'))throw error;});}
}
