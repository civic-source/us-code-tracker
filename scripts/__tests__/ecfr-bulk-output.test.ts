import { mkdtemp, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { writeEcfrProduct } from '../lib/ecfr-bulk-output.js';
it('checks the output filesystem before creating the product',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ecfr-output-')); const path=join(directory,'result.json');
 try{
  const result=await writeEcfrProduct(path,'1234567890',{minFreeBytes:100,capacityProvider:async()=>105});
  expect(result.ok).toBe(false);await expect(access(path)).rejects.toThrow();
 }finally{await rm(directory,{recursive:true,force:true});}
});
