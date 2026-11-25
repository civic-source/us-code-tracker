import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProvisionSchema, ProvisionVersionSchema, SnapshotMembershipSchema,
  CitationAssignmentSchema, SourceReleaseSchema, CollectionCoverageSchema } from '@civic-source/types';
import { CanonicalWorkbenchCatalog, sha256Hex, type CatalogStateSnapshot } from './workbench-catalog.js';

const execute = promisify(execFile);
export const COHORT_LEGACY_PATHS = [
  'statutes/title-18/chapter-1/section-2.md',
  'statutes/title-18/chapter-19/section-371.md',
  'statutes/title-18/chapter-63/section-1341.md',
  'statutes/title-18/chapter-63/section-1343.md',
  'statutes/title-18/chapter-95/section-1951.md',
  'statutes/title-18/chapter-96/section-1962.md',
];

async function appendLegacySection(options: {
  snapshot: CatalogStateSnapshot; dataRepoPath: string; releaseId: string; path: string;
}): Promise<boolean> {
  let markdown: string;
  try { markdown = (await execute('git', ['show', `${options.releaseId}:${options.path}`],
    { cwd: options.dataRepoPath, timeout: 30_000, maxBuffer: 2 * 1024 ** 2 })).stdout; }
  catch { return false; }
  const match = /^statutes\/title-(\d+)\/chapter-([^/]+)\/section-([^.]+)\.md$/.exec(options.path);
  if (!match) throw new Error('Invalid fixed legacy cohort path');
  const [, title, chapter, section] = match;
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
  const provisionId = `prov-${title}-${section}`;
  const versionId = `pv-${title}-${section}-${options.releaseId}`;
  const { snapshot } = options;
  if (!snapshot.provisions.some(item => item.provisionId === provisionId)) snapshot.provisions.push(ProvisionSchema.parse({
    provisionId, documentKind: 'usc_section', creationBasis: `legacy_markdown_git_blob:${options.path}` }));
  snapshot.provisionVersions.push(ProvisionVersionSchema.parse({ provisionVersionId: versionId, provisionId,
    normalizedContentHash: sha256Hex(body), normalizationVersion: '1.0.0-legacy-md', uscTitle: title,
    uscChapter: chapter, uscSection: section, heading: /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? `§ ${section}`,
    status: 'active', bodyMarkdown: body, legacyDerived: true }));
  snapshot.memberships.push(SnapshotMembershipSchema.parse({ membershipId: `mem-${options.releaseId}-${provisionId}`,
    sourceReleaseId: options.releaseId, provisionVersionId: versionId, provisionId,
    sourceOrder: 10 + COHORT_LEGACY_PATHS.indexOf(options.path) + (options.releaseId === 'pl-119-73' ? 6 : 0), hierarchyPath: `title-${title}/chapter-${chapter}/section-${section}`,
    sourceLocator: `git:${options.releaseId}:${options.path}` }));
  const prior = snapshot.citationAssignments.find(item => item.provisionId === provisionId);
  if (prior) prior.releaseIds.push(options.releaseId);
  else snapshot.citationAssignments.push(CitationAssignmentSchema.parse({ assignmentId: `ca-${provisionId}`, provisionId,
    normalizedCitation: `${title} U.S.C. ${section}`, legacySlug: `title-${title}/chapter-${chapter}/section-${section}`,
    releaseIds: [options.releaseId], editorialReview: 'accepted' }));
  return true;
}

/** Git-addressable legacy text is retained without asserting an independently verified publisher edition. */
export async function buildLegacyHistoryCohort(options: {
  dataRepoPath: string; observedAt: string;
}): Promise<CatalogStateSnapshot> {
  const snapshot = new CanonicalWorkbenchCatalog().getSnapshot();
  for (const releaseId of ['pl-116-220', 'pl-119-73']) {
    for (const path of COHORT_LEGACY_PATHS) await appendLegacySection({ snapshot, ...options, releaseId, path });
    const members = snapshot.memberships.filter(item => item.sourceReleaseId === releaseId);
    const [congress, law] = releaseId.slice(3).split('-');
    snapshot.releases.push(SourceReleaseSchema.parse({ releaseId, publisherReleaseLabel: `${releaseId} (legacy-derived Git cohort; source incomplete)`,
      releaseSegment: 'Partial legacy-derived Git cohort; constructed historical sources withdrawn.',
      congress: Number(congress), lawIdentifier: law, snapshotIds: [], coverageId: `cov-${releaseId}`,
      manifestDigest: sha256Hex(members.map(item => `${item.hierarchyPath}:${item.provisionVersionId}`).sort().join('\n')),
      gitTag: releaseId, supersedesReleaseId: releaseId === 'pl-119-73' ? 'pl-116-220' : undefined,
      observedAt: options.observedAt, legacyDerived: true }));
    snapshot.coverages.push(CollectionCoverageSchema.parse({ coverageId: `cov-${releaseId}`, releaseId,
      sourceScope: `olrc:${releaseId}:legacy-git-cohort`, sourceFamily: 'olrc_uslm',
      expectedPartitions: [...COHORT_LEGACY_PATHS.map(partition), 'title-18/section-1001', 'title-18/section-111'],
      completedPartitions: members.map(item => `title-18/section-${snapshot.provisionVersions.find(version => version.provisionVersionId === item.provisionVersionId)!.uscSection}`),
      coverageState: 'partial', lastAttemptedAt: options.observedAt }));
  }
  return snapshot;
}

function partition(path: string): string {
  const match = /title-(\d+)\/.*section-([^.]+)\.md$/.exec(path);
  if (!match) throw new Error('Invalid legacy partition path');
  return `title-${match[1]}/section-${match[2]}`;
}
