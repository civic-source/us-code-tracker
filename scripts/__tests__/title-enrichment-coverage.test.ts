import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { annotationToYaml } from '@civic-source/annotator';
import { CollectionCoverageSchema, PrecedentAnnotationSchema, SectionRegulationsSchema } from '@civic-source/types';
import { parseAnnotationYaml } from '../lib/annotation-yaml-parser.js';
import {
  computeTitleEnrichmentCoverage,
  discoverTitleSections,
  normalizeTitleId,
  validateAnnotationRaw,
  validateEcfrRaw,
} from '../lib/title-enrichment-coverage.js';
import { runTitleEnrichmentBatch } from '../lib/title-enrichment-batch.js';
import { buildTitleCoverageRecords } from '../lib/canonical-vertical-slice.js';
import { CanonicalWorkbenchCatalog } from '../lib/workbench-catalog.js';

const FIXED_NOW = '2026-11-24T04:00:00.000Z';

async function writeStatuteFixture(dataRepoPath: string, uscTitle: string, chapter: string, section: string): Promise<void> {
  const dir = join(dataRepoPath, 'statutes', `title-${uscTitle}`, `chapter-${chapter}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `section-${section}.md`), `---\ntitle: "Section ${section}"\nusc_title: "${uscTitle}"\nusc_section: "${section}"\nchapter: ${chapter}\n---\n\nText for ${uscTitle} U.S.C. ${section}.\n`, 'utf-8');
}

async function writeValidRegSidecar(dataRepoPath: string, uscTitle: string, section: string, agency = 'Test Agency'): Promise<string> {
  const dir = join(dataRepoPath, 'regulations', `title-${uscTitle}`);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `section-${section}.json`);
  const payload = SectionRegulationsSchema.parse({
    targetSection: `${uscTitle}-${section}`, lastUpdated: FIXED_NOW,
    refreshStatus: { source: 'ecfr', scope: `${uscTitle} U.S.C. ${section}`, status: 'success-nonempty', observedAt: FIXED_NOW, lastSuccessAt: FIXED_NOW, retainedPriorSnapshot: false, isStale: false },
    regulations: [{ cfrTitle: 19, cfrPart: 162, agency, ecfrUrl: 'https://www.ecfr.gov/current/title-19/part-162', extractionState: 'candidate', editorialReview: 'unreviewed', relationshipType: 'text_match_candidate' }],
  });
  await writeFile(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  return filePath;
}

async function writeValidAnnotationSidecar(dataRepoPath: string, uscTitle: string, section: string): Promise<string> {
  const dir = join(dataRepoPath, 'annotations', `title-${uscTitle}`);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `section-${section}.yaml`);
  await writeFile(filePath, [
    `targetSection: "${uscTitle} U.S.C. ${section}"`, `lastSyncedET: "${FIXED_NOW}"`, 'cases:',
    '  - caseName: "United States v. Test"', '    citation: "522 U.S. 398"', '    court: "SCOTUS"',
    '    date: "1998-01-26"', '    holdingSummary: "Test excerpt."',
    '    sourceUrl: "https://www.courtlistener.com/opinion/118168/brogan-v-united-states/"', '    impact: "unverified_mention"',
  ].join('\n') + '\n', 'utf-8');
  return filePath;
}

describe('title-enrichment-coverage & annotation-yaml-parser', () => {
  const tempDirs: string[] = [];
  async function createTempRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'usct-title-cov-'));
    tempDirs.push(dir);
    await mkdir(join(dir, 'statutes'), { recursive: true });
    return dir;
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0, tempDirs.length)) await rm(dir, { recursive: true, force: true });
  });

  it('normalizes safe title identifiers and discovers deduplicated naturally-sorted sections', async () => {
    const repo = await createTempRepo();
    expect(normalizeTitleId('18')).toEqual({ ok: true, value: '18' });
    expect(normalizeTitleId(10)).toEqual({ ok: true, value: '10' });
    expect(normalizeTitleId('05a')).toEqual({ ok: true, value: '5a' });
    expect(normalizeTitleId('title-26')).toEqual({ ok: true, value: '26' });
    expect(normalizeTitleId('../18').ok).toBe(false);
    expect(normalizeTitleId('18/chapter-1').ok).toBe(false);
    expect(normalizeTitleId('0').ok).toBe(false);
    expect(normalizeTitleId('').ok).toBe(false);

    await writeStatuteFixture(repo, '18', '47', '1001');
    await writeStatuteFixture(repo, '18', '1', '2');
    await writeStatuteFixture(repo, '18', '7', '111');
    await writeStatuteFixture(repo, '18', '9', '175b');
    await writeStatuteFixture(repo, '18', '1', '10');
    const dupDir = join(repo, 'statutes', 'title-18', 'chapter-47', 'subchapter-a');
    await mkdir(dupDir, { recursive: true });
    await writeFile(join(dupDir, 'section-1001.md'), '# duplicate\n', 'utf-8');
    await writeStatuteFixture(repo, '26', '2', '2000e-2');
    await writeStatuteFixture(repo, '26', '2', '2000e-1');

    const t18 = await discoverTitleSections(repo, '18');
    expect(t18.ok).toBe(true);
    if (!t18.ok) return;
    expect(t18.value.map((s) => s.section)).toEqual(['2', '10', '111', '175b', '1001']);
    expect(t18.value[0]).toEqual({
      uscTitle: '18', chapter: '1', section: '2',
      statuteRelPath: 'statutes/title-18/chapter-1/section-2.md', partitionId: 'title-18/section-2',
    });

    const t26 = await discoverTitleSections(repo, '26');
    expect(t26.ok).toBe(true);
    if (t26.ok) expect(t26.value.map((s) => s.section)).toEqual(['2000e-1', '2000e-2']);
  });

  it('computes complete, partial, not_collected coverage and maintains parity with buildTitleCoverageRecords', async () => {
    const repo = await createTempRepo();
    await writeStatuteFixture(repo, '18', '1', '10');
    await writeStatuteFixture(repo, '18', '1', '2');
    await writeStatuteFixture(repo, '18', '47', '1001');
    await writeValidRegSidecar(repo, '18', '1001');
    await writeValidAnnotationSidecar(repo, '18', '2');
    await writeValidAnnotationSidecar(repo, '18', '1001');

    await writeStatuteFixture(repo, '10', '1', '101');
    await writeValidRegSidecar(repo, '10', '101');
    await writeValidAnnotationSidecar(repo, '10', '101');
    await writeStatuteFixture(repo, '26', '1', '1');

    const cov18 = await computeTitleEnrichmentCoverage({ dataRepoPath: repo, uscTitle: '18', releaseId: 'pl-119-73', observedAt: FIXED_NOW });
    const slice18 = await buildTitleCoverageRecords({ dataRepoPath: repo, uscTitle: '18', releaseId: 'pl-119-73', observedAt: FIXED_NOW });
    expect(cov18.ok && slice18.ok).toBe(true);
    if (!cov18.ok || !slice18.ok) return;
    for (const cov of cov18.value.coverages) expect(() => CollectionCoverageSchema.parse(cov)).not.toThrow();
    expect(slice18.value).toEqual(cov18.value.coverages);
    expect(new CanonicalWorkbenchCatalog().ingestBundle({ coverages: slice18.value }).ok).toBe(true);

    const by18 = new Map(cov18.value.coverages.map((c) => [c.sourceFamily, c]));
    expect(by18.get('olrc_uslm')?.coverageState).toBe('complete');
    expect(by18.get('ecfr')?.completedPartitions).toEqual(['title-18/section-1001']);
    expect(by18.get('courtlistener')?.completedPartitions).toEqual(['title-18/section-2', 'title-18/section-1001']);

    const cov10 = await computeTitleEnrichmentCoverage({ dataRepoPath: repo, uscTitle: '10', observedAt: FIXED_NOW });
    expect(cov10.ok && cov10.value.coverages.every((c) => c.coverageState === 'complete')).toBe(true);
    const cov26 = await computeTitleEnrichmentCoverage({ dataRepoPath: repo, uscTitle: '26', observedAt: FIXED_NOW });
    expect(cov26.ok).toBe(true);
    if (cov26.ok) {
      expect(cov26.value.report.sources.ecfr.coverageState).toBe('not_collected');
      expect(cov26.value.report.sources.courtlistener.coverageState).toBe('not_collected');
    }
  });

  it('rejects partial (pagination_incomplete) eCFR sidecars from completed coverage and re-selects them on --only-missing resume', async () => {
    const repo = await createTempRepo();
    await writeStatuteFixture(repo, '18', '47', '1001');
    const fetchedSections: string[] = [];

    const first = await runTitleEnrichmentBatch({
      dataRepoPath: repo, uscTitle: '18', sources: ['ecfr'], onlyMissing: true, sleepFn: async () => {},
      fetchEcfr: async ({ uscTitle, section }) => ({
        status: 'partial', source: 'ecfr', scope: `${uscTitle} U.S.C. ${section}`,
        observedAt: FIXED_NOW, retainedPriorSnapshot: false, isStale: true,
        failureKind: 'pagination_incomplete', errorMessage: 'Truncated at page 10 of 12',
        completedPages: 10, expectedPages: 12,
        data: [{ cfrTitle: 19, cfrPart: 162, agency: 'CBP', ecfrUrl: 'https://www.ecfr.gov/current/title-19/part-162', extractionState: 'candidate', editorialReview: 'unreviewed', relationshipType: 'text_match_candidate' }],
      }),
    });

    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.writtenCount).toBe(1);
    expect(first.value.failedCount).toBe(1);
    const ecfrSummary = first.value.coverageAfter.report.sources.ecfr;
    expect(ecfrSummary.coverageState).toBe('failed');
    expect(ecfrSummary.completedCount).toBe(0);
    expect(ecfrSummary.failedPartitions).toEqual([
      { partition: 'title-18/section-1001', reason: 'Truncated at page 10 of 12', failureKind: 'pagination_incomplete' },
    ]);
    const ecfrCov = first.value.coverageAfter.coverages.find((c) => c.sourceFamily === 'ecfr');
    expect(ecfrCov?.lastCompletedAt).toBeUndefined();
    expect(validateEcfrRaw(JSON.stringify({
      targetSection: '18-1001', lastUpdated: FIXED_NOW,
      refreshStatus: { source: 'ecfr', scope: '18 U.S.C. 1001', status: 'partial', observedAt: FIXED_NOW, failureKind: 'pagination_incomplete', retainedPriorSnapshot: false, isStale: true },
      regulations: [],
    })).status).toBe('failed');

    const second = await runTitleEnrichmentBatch({
      dataRepoPath: repo, uscTitle: '18', sources: ['ecfr'], onlyMissing: true, sleepFn: async () => {},
      fetchEcfr: async ({ uscTitle, section }) => {
        fetchedSections.push(section);
        return {
          status: 'success-empty', source: 'ecfr', scope: `${uscTitle} U.S.C. ${section}`,
          observedAt: FIXED_NOW, lastSuccessAt: FIXED_NOW, retainedPriorSnapshot: false, isStale: false, data: [],
        };
      },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(fetchedSections).toEqual(['1001']);
    expect(second.value.coverageAfter.report.sources.ecfr.coverageState).toBe('complete');
  });

  it('parses wrapped quoted scalars emitted by PyYAML without changing their text', () => {
    const summary = "The court stated: this provision applies to the defendant's conduct and requires proof of knowing and willful acts beyond a reasonable doubt.";
    const yaml = [
      'targetSection: 18 U.S.C. 1001', `lastSyncedET: '${FIXED_NOW}'`, 'cases:',
      '- caseName: United States v. Test', '  citation: 522 U.S. 398', '  court: SCOTUS', "  date: '1998-01-26'",
      "  holdingSummary: 'The court stated: this provision applies to the defendant''s conduct",
      "    and requires proof of knowing and willful acts beyond a reasonable doubt.'",
      '  sourceUrl: https://www.courtlistener.com/opinion/118168/brogan/', '  impact: interpretation',
    ].join('\n');
    const parsed = parseAnnotationYaml(yaml);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.cases[0]?.holdingSummary).toBe(summary);
    expect(validateAnnotationRaw(yaml).status).toBe('valid');
    const paragraphs = yaml.replace(
      / {2}holdingSummary:[\s\S]*?\n {2}sourceUrl:/,
      "  holdingSummary: 'The court stated: first paragraph\n\n    second paragraph\n\n\n    third paragraph'\n  sourceUrl:",
    );
    const multiline = parseAnnotationYaml(paragraphs);
    expect(multiline.ok).toBe(true);
    if (multiline.ok) expect(multiline.value.cases[0]?.holdingSummary).toBe('The court stated: first paragraph\nsecond paragraph\n\nthird paragraph');
    const doubleQuoted = parseAnnotationYaml(paragraphs.replace("'The court stated: first paragraph", '"The court stated: first paragraph').replace("third paragraph'", 'third paragraph"'));
    expect(doubleQuoted.ok && doubleQuoted.value.cases[0]?.holdingSummary).toBe('The court stated: first paragraph\nsecond paragraph\n\nthird paragraph');
    const escaped = yaml.replace(/ {2}holdingSummary:[\s\S]*?\n {2}sourceUrl:/,
      '  holdingSummary: "The court stated: Unicode \\L separator and \\Pparagraph, \\\n    continued \\x41 \\u0042 \\U0001F600"\n  sourceUrl:');
    const unicode = parseAnnotationYaml(escaped);
    expect(unicode.ok && unicode.value.cases[0]?.holdingSummary).toBe('The court stated: Unicode \u2028 separator and \u2029paragraph, continued A B 😀');
    expect(parseAnnotationYaml(yaml.replace("doubt.'", 'doubt.')).ok).toBe(false);
    expect(parseAnnotationYaml(yaml.replace('    and requires', '  and requires')).ok).toBe(false);
  });

  it('rejects malformed annotation YAML, preserves it on resume, and parses real annotation formats', async () => {
    expect(validateAnnotationRaw('targetSection: "18 U.S.C. 1001"\nlastSyncedET: "2026-11-24T04:00:00.000Z"\ncases: [unterminated\n')).toEqual({
      status: 'failed', reason: 'Invalid cases value "[unterminated"; expected [] or block list', failureKind: 'malformed_payload',
    });
    expect(parseAnnotationYaml('targetSection: 18 U.S.C. 1\nlastSyncedET: "bad"\ncases: []\n').ok).toBe(false);

    const sampleNonEmpty = PrecedentAnnotationSchema.parse({
      targetSection: '18 U.S.C. 1001', lastSyncedET: FIXED_NOW,
      cases: [{ caseName: 'Brogan v. "United" States', citation: '522 U.S. 398', court: 'SCOTUS', date: '1998-01-26', holdingSummary: 'Line 1\nLine 2', sourceUrl: 'https://www.courtlistener.com/opinion/118168/brogan/', impact: 'interpretation' }],
    });
    const parsedFromTs = parseAnnotationYaml(annotationToYaml(sampleNonEmpty));
    expect(parsedFromTs.ok).toBe(true);
    if (parsedFromTs.ok) expect(parsedFromTs.value.cases[0]?.holdingSummary).toBe('Line 1\nLine 2');

    const parsedEmpty = parseAnnotationYaml(annotationToYaml({ targetSection: '18 U.S.C. 2', lastSyncedET: FIXED_NOW, cases: [] }));
    expect(parsedEmpty.ok && parsedEmpty.value.cases.length === 0).toBe(true);

    const pyYamlSample = [
      'targetSection: 18 U.S.C. § 1001', "lastSyncedET: '2026-03-31T03:35:47.188097+00:00'", 'totalCases: 1',
      'refreshStatus:', '  source: courtlistener', '  scope: 18 U.S.C. § 1001', '  status: success-nonempty',
      "  observedAt: '2026-03-31T03:35:47.188097+00:00'", '  retainedPriorSnapshot: false', '  isStale: false',
      'cases:', '- caseName: Brogan v. United States', '  citation: 522 U.S. 398', '  court: SCOTUS',
      "  date: '1998-01-26'", '  holdingSummary: First line wrapped across',
      "    a second line with ('exculpatory no') text.",
      '  sourceUrl: https://www.courtlistener.com/opinion/118168/brogan/', '  impact: interpretation',
    ].join('\n') + '\n';
    const parsedPy = parseAnnotationYaml(pyYamlSample);
    expect(parsedPy.ok).toBe(true);
    if (parsedPy.ok) {
      expect(parsedPy.value.cases[0]?.holdingSummary).toBe("First line wrapped across a second line with ('exculpatory no') text.");
    }

    const repo = await createTempRepo();
    await writeStatuteFixture(repo, '18', '47', '1001');
    await mkdir(join(repo, 'annotations', 'title-18'), { recursive: true });
    const annotationPath = join(repo, 'annotations', 'title-18', 'section-1001.yaml');
    const malformed = 'targetSection: "18 U.S.C. 1001"\nlastSyncedET: "2026-11-24T04:00:00.000Z"\ncases: [unterminated\n';
    await writeFile(annotationPath, malformed, 'utf-8');

    const selectedOnResume: string[] = [];
    const attempted = await runTitleEnrichmentBatch({
      dataRepoPath: repo, uscTitle: '18', sources: ['courtlistener'], onlyMissing: true, sleepFn: async () => {},
      fetchCourtListener: async ({ uscTitle, section }) => {
        selectedOnResume.push(section);
        return {
          status: 'success-empty', source: 'courtlistener', scope: `${uscTitle} U.S.C. ${section}`,
          observedAt: FIXED_NOW, lastSuccessAt: FIXED_NOW, retainedPriorSnapshot: false, isStale: false,
          data: { targetSection: `${uscTitle} U.S.C. ${section}`, lastSyncedET: FIXED_NOW, cases: [] },
        };
      },
    });
    expect(attempted.ok).toBe(true);
    if (!attempted.ok) return;
    expect(selectedOnResume).toEqual(['1001']);
    expect(attempted.value.writtenCount).toBe(0);
    expect(attempted.value.failedCount).toBe(1);
    expect(attempted.value.coverageAfter.report.sources.courtlistener.coverageState).toBe('failed');
    expect(await readFile(annotationPath, 'utf-8')).toBe(malformed);
  });
});
