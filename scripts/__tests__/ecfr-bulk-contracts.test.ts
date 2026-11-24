import { describe, expect, it } from 'vitest';
import { EcfrBulkSnapshotSchema } from '../../packages/types/src/ecfr-bulk.js';

describe('eCFR bulk snapshot contract', () => {
  it('rejects a snapshot that claims a selected source title without retaining its bytes', () => {
    const snapshot = {
      schemaVersion: 'usct.ecfr-bulk-snapshot/v1', snapshotId: 'a'.repeat(64),
      capturedAt: '2026-11-24T15:00:00.000Z', inventoryTitles: [19, 28], selectedTitles: [19, 28],
      extractorVersion: '1', extractorDigest: 'b'.repeat(64),
      sources: [{ title: 19, url: 'https://www.govinfo.gov/bulkdata/ECFR/title-19/ECFR-title19.xml',
        blob: { sha256: 'c'.repeat(64), byteLength: 123 }, lastModified: '2026-11-23T22:33:27.000Z',
        retrievedAt: '2026-11-24T15:00:00.000Z' }],
      index: { sha256: 'd'.repeat(64), byteLength: 42 },
    };
    expect(EcfrBulkSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });
});
