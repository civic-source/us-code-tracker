import { describe, expect, it } from 'vitest';
import type { EcfrBulkAuthority, EcfrBulkIndex, EcfrBulkSnapshot } from '@civic-source/types';
import { canonicalJson, digestBytes } from '../lib/ecfr-bulk-store.js';
import { projectEcfrCohort } from '../lib/ecfr-bulk-projection.js';
const hash = 'a'.repeat(64);
const authority: EcfrBulkAuthority = {cfrTitle:28,sourceSha256:hash,ordinal:1,nodePath:'/DIV[1]/AUTH[1]',scope:'PART',part:'0',section:null,heading:'Organization',agency:'Justice',tag:'AUTH',rawText:'5 U.S.C. 301; 28 U.S.C. 509, 510, 515-519.',text:'5 U.S.C. 301; 28 U.S.C. 509, 510, 515-519.',sourceLine:5};
const index: EcfrBulkIndex = {schemaVersion:'usct.ecfr-bulk-index/v1',extractorVersion:'1',extractorDigest:hash,titles:[{schemaVersion:'usct.ecfr-bulk-title/v1',cfrTitle:28,sourceSha256:hash,amendmentDateText:null,authorities:[authority]}]};
const bind = (value: EcfrBulkIndex): EcfrBulkSnapshot => ({snapshotId:hash,index:{sha256:digestBytes(canonicalJson(value)+'\n'),byteLength:Buffer.byteLength(canonicalJson(value)+'\n')},inventoryTitles:[19,28],selectedTitles:[28]} as EcfrBulkSnapshot);
const snapshot = bind(index);
describe('local eCFR cohort projection',()=>{
 it('matches grouped sections and bounded ranges without claiming unsearched coverage',()=>{
  const result=projectEcfrCohort(snapshot,index,'28',['509','510','516','520']);
  expect(result.ok).toBe(true); if(!result.ok) return;
  expect(result.value.sections.map(s=>s.hits.length)).toEqual([1,1,1,0]);
  expect(result.value.corpusComplete).toBe(false);
  expect(result.value.sections[2]?.hits[0]).toMatchObject({matchType:'range',editorialReview:'unreviewed',authority:{part:'0'}});
 });
 it('does not carry section lists across another authority or infer subsection equivalence',()=>{
  const result=projectEcfrCohort(snapshot,index,'5',['301','510']);
  expect(result.ok).toBe(true);if(!result.ok)return;
  expect(result.value.sections.map(s=>s.hits.length)).toEqual([1,0]);
 });
});
it('bounds expanded projection bytes before allocating an oversized result',()=>{
 const large={...authority,text:'28 U.S.C. 1-10000.',rawText:'x'.repeat(131072)};
 const huge={...index,titles:[{...index.titles[0]!,authorities:[large]}]};
 const result=projectEcfrCohort(bind(huge),huge,'28',Array.from({length:600},(_,i)=>String(i+1)));
 expect(result.ok).toBe(false);
});

it('rejects an unrelated index before reporting corpus coverage',()=>{
 const result=projectEcfrCohort(snapshot,{...index,titles:[]},'28',['510']);
 expect(result.ok).toBe(false);
});
