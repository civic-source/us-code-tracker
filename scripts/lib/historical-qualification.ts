import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ProvisionVersionSchema, type ProvisionVersion, SnapshotMembershipSchema } from '@civic-source/types';
import original from '../../data/olrc-history-pilot/materializations.json' with { type: 'json' };
import type { CatalogStateSnapshot } from './workbench-catalog.js';
import { historicalSourcePins, type HistoricalSourcePin } from './olrc-historical-sources.js';

interface Collection { releaseId: string; manifestDigest: string; publisherReleaseId: string }
interface Generation { recipeSha256: string; versions: ProvisionVersion[]; collections: Collection[] }
interface Registry { generations: Generation[]; active: Record<string, string> }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const originalHistoricalRecipe = original.records[0]!.version.sourceQualification.recipeSha256;
const originalRecipe = originalHistoricalRecipe;
const publishers = ['pl-119-73', 'pl-119-142'];

export function historicalRecordDigest(version: ProvisionVersion): string {
  return hash(JSON.stringify(ProvisionVersionSchema.parse(version)));
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Historical registry requires an object');
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).sort().join('|') !== keys.sort().join('|')) throw new Error('Unknown or missing historical registry fields');
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Historical registry requires an exact digest');
  return value;
}
function records(raw: string, schema: string): unknown[] {
  if (Buffer.byteLength(raw) > 8 * 1024 ** 2) throw new Error('Historical generation exceeds byte limit');
  const value = object(JSON.parse(raw));
  exactKeys(value, ['schemaVersion', 'records']);
  if (value.schemaVersion !== schema || !Array.isArray(value.records) || value.records.length !== 6) {
    throw new Error('Historical generation requires six reviewed records');
  }
  return value.records;
}

function versionFrom(record: unknown, recipe: string): ProvisionVersion {
  const row = object(record); exactKeys(row, ['version', 'recordSha256']);
  const version = ProvisionVersionSchema.parse(row.version);
  const proof = version.sourceQualification;
  const source = historicalSourcePins.find(item => item.releaseId === proof?.releaseId);
  if (!proof || !source || proof.recipeSha256 !== recipe || version.legacyDerived || version.uscTitle !== '18') {
    throw new Error('Historical generation source or recipe mismatch');
  }
  validateSource(version, source);
  if (historicalRecordDigest(version) !== row.recordSha256) throw new Error('Historical generation record digest mismatch');
  return version;
}

function validateSource(version: ProvisionVersion, source: HistoricalSourcePin): void {
  const proof = version.sourceQualification!;
  if (!['1001', '111', '1114'].includes(version.uscSection) || proof.sectionIdentifier !== `/us/usc/t18/s${version.uscSection}` ||
    proof.archiveSha256 !== source.archive.sha256 || proof.memberSha256 !== source.member.sha256 || proof.memberName !== 'usc18.xml') {
    throw new Error('Historical generation publisher or member identity mismatch');
  }
  if (proof.markdownSha256 !== hash(version.bodyMarkdown) || proof.htmlSha256 !== hash(version.renderedHtml ?? '') ||
    version.provisionVersionId !== `pv-olrc-pilot-${hash(JSON.stringify(proof))}`) {
    throw new Error('Historical generation body or version identity mismatch');
  }
}

function qualify(version: ProvisionVersion, rows: unknown[], witness: string): void {
  const matches = rows.filter(row => object(row).provisionVersionId === version.provisionVersionId);
  const row = object(matches[0]); exactKeys(row, ['provisionVersionId', 'recordSha256', 'sourceQualification']);
  const proof = version.sourceQualification!;
  const result = object(JSON.parse(witness));
  if (matches.length !== 1 || row.recordSha256 !== historicalRecordDigest(version) ||
    JSON.stringify(row.sourceQualification) !== JSON.stringify(proof) || hash(witness) !== proof.witnessSha256 ||
    result.accepted !== true || result.source_xml_sha256 !== proof.memberSha256 || result.html_sha256 !== proof.htmlSha256) {
    throw new Error('Historical source materialization has no exact reviewed witness');
  }
}

function collection(versions: ProvisionVersion[], publisherReleaseId: string): Collection {
  const selected = versions.filter(version => version.sourceQualification!.releaseId === publisherReleaseId);
  const sections = selected.map(version => version.uscSection).sort();
  if (sections.join('|') !== '1001|111|1114') throw new Error('Historical collection lacks its exact reviewed cohort');
  const manifestDigest = hash(selected.map(version => version.provisionVersionId).sort().join('\n'));
  return { releaseId: `olrc-pilot-${manifestDigest}`, manifestDigest, publisherReleaseId };
}

function generation(value: unknown, read: (path: string) => string): Generation {
  const descriptor = object(value); exactKeys(descriptor, ['recipeSha256', 'materializationsSha256', 'qualificationSha256']);
  const recipeSha256 = digest(descriptor.recipeSha256);
  const directory = recipeSha256 === originalRecipe ? '' : `generations/${recipeSha256}/`;
  const raw = read(`${directory}materializations.json`); const reviewed = read(`${directory}qualification.json`);
  if (hash(raw) !== digest(descriptor.materializationsSha256) || hash(reviewed) !== digest(descriptor.qualificationSha256)) {
    throw new Error('Historical generation transport digest mismatch');
  }
  const versions = records(raw, 'usct.historical-materializations/v1').map(row => versionFrom(row, recipeSha256));
  if (new Set(versions.map(version => version.provisionVersionId)).size !== 6) throw new Error('Duplicate historical version');
  const approved = records(reviewed, 'usct.reviewed-history-materializations/v1');
  for (const version of versions) qualify(version, approved,
    read(`${directory}witnesses/${version.sourceQualification!.releaseId}-${version.uscSection}-witness.json`));
  return { recipeSha256, versions, collections: publishers.map(publisher => collection(versions, publisher)) };
}

/** Reviewed descriptors bind every retained product; active aliases never change collection identity. */
export function parseHistoricalGenerations(value: unknown, read: (path: string) => string): Registry {
  const registry = object(value); exactKeys(registry, ['schemaVersion', 'generations', 'active']);
  if (registry.schemaVersion !== 'usct.historical-generations/v1' || !Array.isArray(registry.generations) ||
    !registry.generations.length || registry.generations.length > 8) throw new Error('Invalid historical generation registry');
  const generations = registry.generations.map(item => generation(item, read));
  const recipes = generations.map(item => item.recipeSha256);
  if (new Set(recipes).size !== recipes.length || !recipes.includes(originalRecipe)) throw new Error('Duplicate or missing retained generation');
  const active = object(registry.active); exactKeys(active, [...publishers]);
  const aliases: Record<string, string> = {};
  for (const publisher of publishers) {
    const recipe = digest(active[publisher]);
    if (!recipes.includes(recipe)) throw new Error('Unknown active historical generation');
    aliases[publisher] = recipe;
  }
  return { generations, active: aliases };
}

export function readHistoricalGenerations(): Registry {
  const root = [process.cwd(), resolve(process.cwd(), '../..')].find(path => existsSync(join(path, 'pnpm-lock.yaml')));
  if (!root) throw new Error('Historical registry requires the source checkout');
  const directory = join(root, 'data/olrc-history-pilot');
  const read = (relative: string) => {
    const path = join(directory, relative); const info = lstatSync(path);
    if (!info.isFile() || info.nlink !== 1 || info.size > 8 * 1024 ** 2 || realpathSync(path) !== resolve(path)) {
      throw new Error('Invalid historical generation file');
    }
    return readFileSync(path, 'utf8');
  };
  return parseHistoricalGenerations(JSON.parse(read('generations.json')), read);
}

export function reviewedHistoricalVersions(): ProvisionVersion[] {
  return readHistoricalGenerations().generations.flatMap(item => item.versions);
}

/** Source claims require a reviewed materialization, not caller-controlled verification flags. */
export function requireHistoricalQualification(version: ProvisionVersion): void {
  if (!version.sourceQualification && !version.provisionVersionId.startsWith('pv-olrc-pilot-')) return;
  const approved = reviewedHistoricalVersions().find(item => item.provisionVersionId === version.provisionVersionId);
  if (!approved || historicalRecordDigest(version) !== historicalRecordDigest(approved)) {
    throw new Error('Historical source materialization has no matching reviewed source/body/rendering identity');
  }
}

export function historicalCollectionIdentity(publisher: string, recipe?: string): Collection {
  const registry = readHistoricalGenerations();
  const selected = registry.generations.find(item => item.recipeSha256 === (recipe ?? registry.active[publisher]));
  const result = selected?.collections.find(item => item.publisherReleaseId === publisher);
  if (!result) throw new Error('Unknown historical generation or publisher');
  return result;
}

export function historicalMembership(version: ProvisionVersion) {
  const proof = version.sourceQualification!;
  return SnapshotMembershipSchema.parse({ membershipId: `mem-${version.provisionVersionId}`,
    sourceReleaseId: historicalCollectionIdentity(proof.releaseId, proof.recipeSha256).releaseId,
    provisionVersionId: version.provisionVersionId, provisionId: version.provisionId,
    sourceOrder: Number(version.uscSection), hierarchyPath: `title-18/chapter-${version.uscChapter}/section-${version.uscSection}`,
    sourceLocator: `zip:sha256:${proof.archiveSha256}!/usc18.xml#${proof.sectionIdentifier}` });
}

/** Qualified membership cannot reassign an approved body to another collection or hierarchy. */
export function requireHistoricalCollections(snapshot: CatalogStateSnapshot): void {
  for (const member of snapshot.memberships) requireQualifiedMember(snapshot, member);
  const known = readHistoricalGenerations().generations.flatMap(item => item.collections);
  for (const release of snapshot.releases.filter(item => item.releaseId.startsWith('olrc-pilot-'))) {
    const expected = known.find(item => item.releaseId === release.releaseId);
    const members = snapshot.memberships.filter(item => item.sourceReleaseId === release.releaseId);
    const actual = hash(members.map(item => item.provisionVersionId).sort().join('\n'));
    if (!expected || release.publisherReleaseId !== expected.publisherReleaseId || release.manifestDigest !== expected.manifestDigest ||
      release.legacyDerived || members.length !== 3 || actual !== expected.manifestDigest) throw new Error('Historical source collection identity or closure mismatch');
  }
}

function requireQualifiedMember(snapshot: CatalogStateSnapshot, member: CatalogStateSnapshot['memberships'][number]): void {
  const version = snapshot.provisionVersions.find(item => item.provisionVersionId === member.provisionVersionId);
  if (!version?.sourceQualification) {
    if (member.sourceReleaseId.startsWith('olrc-pilot-')) throw new Error('Historical source collection member is missing its qualified version');
    return;
  }
  const release = snapshot.releases.find(item => item.releaseId === member.sourceReleaseId);
  if (!release || release.publisherReleaseId !== version.sourceQualification.releaseId ||
    JSON.stringify(member) !== JSON.stringify(historicalMembership(version))) {
    throw new Error('Qualified historical membership differs from its reviewed source collection');
  }
}
