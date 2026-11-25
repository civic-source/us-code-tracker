import { extractArchiveMember } from './olrc-archive-member.js';
import { auditCommand } from './source-audit-process.js';
import { readAuditInput, auditSha } from './source-audit-io.js';
import { normalizeUscTitle } from '@civic-source/shared';

export interface AuditInventory {
  schemaVersion: 'usct.retained-source-inventory/v1'; title: string; releaseLabel: string;
  archive: { url: string; sha256: string; byteLength: number };
  member: { name: string; sha256: string; byteLength: number };
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function pin(value: unknown): value is Record<string, unknown> & { sha256: string; byteLength: number } {
  return object(value) && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256)
    && typeof value.byteLength === 'number' && Number.isSafeInteger(value.byteLength)
    && value.byteLength > 0 && value.byteLength <= 128 * 1024 ** 2;
}

function coordinates(value: Record<string, unknown>): { title: string; releaseLabel: string } {
  if (value.schemaVersion !== 'usct.retained-source-inventory/v1' || typeof value.title !== 'string'
    || normalizeUscTitle(value.title) !== value.title || typeof value.releaseLabel !== 'string'
    || !/^PL \d+-\d+(?:not\d+)*$/.test(value.releaseLabel)) throw new Error('Invalid retained source title or publisher release');
  return { title: value.title, releaseLabel: value.releaseLabel };
}

function archivePin(value: unknown, identity: { title: string; releaseLabel: string; memberName: string }): AuditInventory['archive'] {
  if (!pin(value) || typeof value.url !== 'string') throw new Error('Invalid archive byte pin or provenance URL');
  const edition = /^PL (\d+)-(\d+(?:not\d+)*)$/.exec(identity.releaseLabel)!;
  const expected = `https://uscode.house.gov/download/releasepoints/us/pl/${edition[1]}/${edition[2]}/xml_${identity.memberName.slice(0, -4)}@${edition[1]}-${edition[2]}.zip`;
  if (value.url !== expected) throw new Error('Archive provenance requires the canonical credential-free OLRC release URL');
  return { url: value.url, sha256: value.sha256, byteLength: value.byteLength };
}

function memberPin(value: unknown, title: string): AuditInventory['member'] {
  if (!pin(value) || typeof value.name !== 'string') throw new Error('Invalid retained member name or byte bounds');
  const member = /^usc(\d+[A-Za-z]?)\.xml$/.exec(value.name);
  if (!member || normalizeUscTitle(member[1]!) !== title) throw new Error('Retained member differs from declared title');
  return { name: value.name, sha256: value.sha256, byteLength: value.byteLength };
}

export async function auditInventory(path: string): Promise<AuditInventory> {
  const value: unknown = JSON.parse((await readAuditInput(path, 64 * 1024)).toString('utf8'));
  if (!object(value)) throw new Error('Invalid retained source inventory');
  const identity = coordinates(value);
  const member = memberPin(value.member, identity.title);
  return { schemaVersion: 'usct.retained-source-inventory/v1', ...identity,
    archive: archivePin(value.archive, { ...identity, memberName: member.name }), member };
}

export async function auditSource(archive: string, inventory: AuditInventory): Promise<Buffer> {
  const bytes = await readAuditInput(archive, 128 * 1024 ** 2);
  if (bytes.length !== inventory.archive.byteLength || auditSha(bytes) !== inventory.archive.sha256) throw new Error('Pinned archive identity mismatch');
  const result = await extractArchiveMember({ archivePath: archive, archivePin: inventory.archive, memberPin: inventory.member });
  if (!result.ok) throw result.error;
  return result.value;
}

export async function requireAuditCommit(repository: string, ref: string): Promise<void> {
  if (!/^[a-f0-9]{40}$/.test(ref)) throw new Error('Accepted ref must be a full immutable commit SHA');
  const result = await auditCommand('git', ['-C', repository, 'cat-file', '-t', ref]);
  if (result.code !== 0 || result.stdout.toString().trim() !== 'commit') throw new Error('Accepted ref is not an available immutable commit');
}

export async function acceptedAuditBytes(repository: string, ref: string, path: string): Promise<Buffer | null> {
  if (!/^statutes\/title-\d+[a-z]?\/chapter-[A-Za-z0-9-]+\/section-[A-Za-z0-9-]+\.md$/.test(path)) throw new Error('Unsafe accepted statute path');
  const listed = await auditCommand('git', ['-C', repository, 'ls-tree', '-z', ref, '--', path]);
  if (listed.code !== 0) throw new Error('Could not inspect immutable accepted path');
  if (!listed.stdout.length) return null;
  if (!/^100(?:644|755) blob [a-f0-9]{40}\t/.test(listed.stdout.toString())) throw new Error('Accepted statute is not a regular Git blob');
  const result = await auditCommand('git', ['-C', repository, 'show', `${ref}:${path}`]);
  if (result.code !== 0) throw new Error('Could not read bounded immutable accepted bytes');
  return result.stdout;
}

export async function acceptedAuditInventory(repository: string, ref: string, title: string, sourcePaths: string[]) {
  const listed = await auditCommand('git', ['-C', repository, 'ls-tree', '-r', '-z', '--name-only', ref, '--', `statutes/title-${title}`]);
  if (listed.code !== 0) throw new Error('Could not enumerate immutable accepted statute paths');
  const paths = new TextDecoder('utf-8', { fatal: true }).decode(listed.stdout).split('\0').filter(Boolean).sort();
  const pattern = new RegExp(`^statutes/title-${title}/chapter-[A-Za-z0-9-]+/section-[A-Za-z0-9-]+\\.md$`);
  if (paths.some(path => !pattern.test(path)) || new Set(paths).size !== paths.length) throw new Error('Accepted inventory contains unsafe or duplicate paths');
  return { paths, extraPaths: paths.filter(path => !sourcePaths.includes(path)),
    missingPaths: sourcePaths.filter(path => !paths.includes(path)).sort() };
}
