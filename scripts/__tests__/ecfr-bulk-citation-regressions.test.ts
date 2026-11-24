import { describe, expect, it } from 'vitest';
import type { EcfrBulkAuthority, EcfrBulkIndex, EcfrBulkSnapshot } from '@civic-source/types';
import { projectEcfrCohort } from '../lib/ecfr-bulk-projection.js';
import { canonicalJson, digestBytes, snapshotIdFor } from '../lib/ecfr-bulk-store.js';

function project(text: string, sections: string[]) {
  const sourceHash = 'a'.repeat(64);
  const authority: EcfrBulkAuthority = {
    cfrTitle: 28, sourceSha256: sourceHash, ordinal: 1,
    nodePath: '/DIV1[1]/DIV5[1]/AUTH[1]', scope: 'PART', part: '0', section: null,
    heading: 'PART 0', agency: 'Department of Justice', tag: 'AUTH',
    rawText: text, text, sourceLine: 1,
  };
  const index: EcfrBulkIndex = {
    schemaVersion: 'usct.ecfr-bulk-index/v1', extractorVersion: 'ecfr-authority/1', extractorDigest: sourceHash,
    titles: [{ schemaVersion: 'usct.ecfr-bulk-title/v1', cfrTitle: 28, sourceSha256: sourceHash, amendmentDateText: null, authorities: [authority] }],
  };
  const indexBytes = canonicalJson(index) + '\n';
  const payload: Omit<EcfrBulkSnapshot, 'snapshotId'> = {
    schemaVersion: 'usct.ecfr-bulk-snapshot/v1', capturedAt: '2026-11-24T00:00:00.000Z',
    inventoryTitles: [19, 28], selectedTitles: [28],
    sources: [{ title: 28, url: 'https://www.govinfo.gov/bulkdata/ECFR/title-28/ECFR-title28.xml', blob: { sha256: sourceHash, byteLength: 1 }, lastModified: null, retrievedAt: '2026-11-24T00:00:00.000Z', amendmentDateText: null }],
    extractorVersion: index.extractorVersion, extractorDigest: index.extractorDigest,
    index: { sha256: digestBytes(indexBytes), byteLength: Buffer.byteLength(indexBytes) },
  };
  const snapshot = { ...payload, snapshotId: snapshotIdFor(payload) };
  const result = projectEcfrCohort(snapshot, index, '42', sections);
  if (!result.ok) throw result.error;
  return result.value;
}

describe('eCFR authority citation boundaries', () => {
  it('retains the complete multi-letter hyphenated section and rejects its shorter prefix', () => {
    const result = project('Authority: 42 U.S.C. 2000bb-1.', ['2000b', '2000bb', '2000bb-1']);
    expect(result.sections.map(section => section.hits.length)).toEqual([0, 0, 1]);
    expect(result.sections[2]?.hits[0]?.matchedCitation).toContain('2000bb-1');
    expect(result.unresolvedCitationCount).toBe(0);
  });

  it('counts an unsupported alphanumeric range as unresolved instead of reporting clean absence', () => {
    const result = project('Authority: 42 U.S.C. 7401-7671q.', ['7401', '7500', '7671q']);
    expect(result.sections.every(section => section.hits.length === 0)).toBe(true);
    expect(result.unresolvedCitationCount).toBeGreaterThan(0);
  });

  it('retains unresolved nested subsections without inventing a whole-section match', () => {
    const result = project('Authority: 42 U.S.C. 2000bb-1(a)(1), 2000cc.', ['2000b', '2000bb-1', '2000cc']);
    expect(result.sections.map(section => section.hits.length)).toEqual([0, 0, 1]);
    expect(result.unresolvedCitationCount).toBeGreaterThan(0);
  });
});
