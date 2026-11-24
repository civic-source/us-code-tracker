import { canonicalJson, digestBytes } from './ecfr-bulk-store.js';
import { EcfrBulkProjectionSchema, err, ok, type EcfrBulkAuthority, type EcfrBulkIndex, type EcfrBulkProjection, type EcfrBulkSnapshot, type Result } from '@civic-source/types';

export const PROJECTION_VERSION = 'usc-authority/1';
interface Citation { title: string; first: string; last?: string; text: string }

function citations(text: string): { values: Citation[]; unresolved: number } {
  const values: Citation[] = [];
  let unresolved = 0;
  const groups = [...text.matchAll(/\b(\d+[a-z]?)\s+U\.?\s*S\.?\s*C\.?\s*(?:§{1,2}\s*)?/gi)];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (!group || group.index === undefined || !group[1]) continue;
    const remainder = text.slice(group.index + group[0].length, groups[i + 1]?.index ?? text.length).replace(/\s*([-–])\s*/g,'$1');
    const list = remainder.match(/^\s*([0-9][a-zA-Z0-9()–-]*(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+)[0-9][a-zA-Z0-9()–-]*)*)(?![a-zA-Z0-9()–/-])/);
    if (!list?.[1]) { unresolved++; continue; }
    for (const token of list[1].split(/\s*,\s*(?:and\s+)?|\s+and\s+/)) {
      const numericRange = token.trim().match(/^(\d+)\s*[-–]\s*(\d+)$/);
      const single = token.trim().match(/^(\d+[a-zA-Z]*(?:-\d+)*)$/);
      const first = numericRange?.[1] ?? single?.[1];
      if (!first) { unresolved++; continue; }
      values.push({title:group[1],first,...(numericRange?.[2] ? {last:numericRange[2]} : {}),text:group[0]+token.trim()});
    }
    if (/\bet\s+seq\b|\bthrough\b/i.test(remainder)) unresolved++;
  }
  return {values,unresolved};
}

function matches(section: string, citation: Citation): boolean {
  if (!citation.last) return section.toLowerCase() === citation.first.toLowerCase();
  if (!/^\d+$/.test(section) || !/^\d+$/.test(citation.first) || !/^\d+$/.test(citation.last)) return false;
  const first = Number(citation.first), last = Number(citation.last), target = Number(section);
  return Number.isSafeInteger(first) && Number.isSafeInteger(last) && first <= last && last - first <= 10000 && target >= first && target <= last;
}

export function projectEcfrCohort(snapshot: EcfrBulkSnapshot, index: EcfrBulkIndex, uscTitle: string, cohort: string[]): Result<EcfrBulkProjection> {
  try {
    const indexBytes = canonicalJson(index)+'\n';
    if(digestBytes(indexBytes)!==snapshot.index.sha256 || Buffer.byteLength(indexBytes)!==snapshot.index.byteLength) return err(new Error('Projection index differs from snapshot identity'));
    if (new Set(cohort).size !== cohort.length) return err(new Error('Duplicate USC cohort sections'));
    let unresolvedCitationCount = 0;
    const evidence: { authority: EcfrBulkAuthority; citation: Citation }[] = [];
    for (const title of index.titles) for (const authority of title.authorities) {
      const parsed = citations(authority.text);
      unresolvedCitationCount += parsed.unresolved;
      for (const citation of parsed.values) if (citation.title.toLowerCase() === uscTitle.toLowerCase()) evidence.push({authority,citation});
    }
    let outputBytes = 4096;
    const sizes = new Map(evidence.map(item=>[item.authority,Buffer.byteLength(JSON.stringify(item.authority))]));
    const sections: EcfrBulkProjection['sections'] = [];
    for (const section of cohort) {
      const hits: EcfrBulkProjection['sections'][number]['hits'] = [];
      for (const item of evidence) if (matches(section,item.citation)) {
        outputBytes += (sizes.get(item.authority) ?? 0) + Buffer.byteLength(item.citation.text) + 256;
        if (outputBytes > 64 * 1024**2) return err(new Error('Projection exceeds 64 MiB output limit'));
        hits.push({authority:item.authority,matchedCitation:item.citation.text,matchType:item.citation.last?'range':'single',extractionState:'candidate',editorialReview:'unreviewed'});
      }
      sections.push({section,hits});
    }
    return ok(EcfrBulkProjectionSchema.parse({schemaVersion:'usct.ecfr-bulk-projection/v1',snapshotId:snapshot.snapshotId,indexSha256:snapshot.index.sha256,projectionVersion:PROJECTION_VERSION,uscTitle,cohort,inventoryCfrTitles:snapshot.inventoryTitles,searchedCfrTitles:snapshot.selectedTitles,corpusComplete:snapshot.inventoryTitles.length===snapshot.selectedTitles.length && snapshot.inventoryTitles.every(title=>snapshot.selectedTitles.includes(title)),sections,unresolvedCitationCount}));
  } catch(error: unknown) {return err(error instanceof Error?error:new Error(String(error)));}
}
