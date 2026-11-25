import { describe, expect, it } from 'vitest';
import { CanonicalWorkbenchCatalog } from '../lib/workbench-catalog.js';
import materializations from '../../data/olrc-history-pilot/materializations.json' with { type: 'json' };
import { historicalRecordDigest, requireHistoricalQualification } from '../lib/historical-qualification.js';
import { ProvisionVersionSchema } from '@civic-source/types';

describe('genuine historical source admission', () => {
  it('admits only the exact six reviewed full-source materializations and rejects altered content or metadata', () => {
    expect(materializations.records).toHaveLength(6);
    for (const item of materializations.records) {
      const version = ProvisionVersionSchema.parse(item.version);
      expect(historicalRecordDigest(version)).toBe(item.recordSha256);
      expect(() => requireHistoricalQualification(version)).not.toThrow();
      for (const altered of [ { ...version, bodyMarkdown: version.bodyMarkdown + ' invented' },
        { ...version, renderedHtml: '<p>altered</p>' }, { ...version, heading: 'Invented heading' },
        { ...version, uscChapter: '99' }, { ...version, sourceQualification: undefined } ]) {
        expect(() => requireHistoricalQualification(altered)).toThrow(/reviewed/);
      }
    }
  });
  it('refuses a self-asserted source qualification before catalog selection', () => {
    const hash = 'a'.repeat(64);
    const version = ProvisionVersionSchema.parse({
      provisionVersionId: 'pv-olrc-pilot-forged', provisionId: 'prov-18-1001',
      normalizedContentHash: hash, normalizationVersion: 'source-pilot-v1',
      uscTitle: '18', uscChapter: '47', uscSection: '1001', heading: 'Invented',
      status: 'active', bodyMarkdown: 'Invented official text', renderedHtml: '<p>Invented official text</p>',
      sourceQualification: { schemaVersion: 'usct.historical-source-qualification/v1',
        releaseId: 'pl-119-73', archiveSha256: hash, memberName: 'usc18.xml', memberSha256: hash,
        sectionIdentifier: '/us/usc/t18/s1001', recipeSha256: hash, markdownSha256: hash,
        htmlSha256: hash, witnessSha256: hash, scope: 'text-lanes-and-list-placement-v1' },
    });
    const catalog = new CanonicalWorkbenchCatalog();
    const result = catalog.ingestBundle({ provisionVersions: [version] });
    expect(result.ok).toBe(false);
    expect(catalog.getSnapshot().provisionVersions).toEqual([]);
  });
});
