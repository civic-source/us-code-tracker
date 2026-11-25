import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { compilerDistributions } from './source-correction-candidate.js';
import { auditSha } from './source-audit-io.js';
import type { AuditSourceInventory } from './source-audit-oracle.js';

export interface AuditRecipe {
  schemaVersion: 'usct.source-audit-recipe/v1'; nodeVersion: string; pythonVersion: string; unicodeVersion: string;
  files: Record<string, string>; compilerDistributions: Record<string, string>; sha256: string;
}

/** Pin every acceptance and staging dependency rather than trusting a cached acceptance flag. */
export async function sourceAuditRecipe(inventory: AuditSourceInventory): Promise<AuditRecipe> {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const paths = ['pnpm-lock.yaml', 'scripts/audit-source-correction.ts', 'scripts/prepare-source-correction.ts',
    'scripts/lib/source-correction-candidate.ts', 'scripts/lib/olrc-archive-member.ts', 'scripts/python/olrc_archive_member.py',
    'scripts/python/uslm_fidelity.py', 'scripts/python/uslm_fidelity_batch.py', 'scripts/python/uslm_fidelity_inventory.py',
    'apps/web/src/lib/anchored-entry.ts', 'apps/web/src/lib/subsection-anchors.ts',
    ...['source-audit', 'source-audit-batch', 'source-audit-input', 'source-audit-io', 'source-audit-oracle',
      'source-audit-process', 'source-audit-record', 'source-audit-recipe', 'source-audit-resume',
      'source-audit-transport'].map(name => `scripts/lib/${name}.ts`)];
  const files: Record<string, string> = {};
  for (const path of paths.sort()) files[path] = auditSha(await readFile(join(root, path)));
  const recipe = { schemaVersion: 'usct.source-audit-recipe/v1' as const, nodeVersion: process.version,
    pythonVersion: inventory.pythonRuntimeVersion, unicodeVersion: inventory.normalizationUnicodeVersion,
    files, compilerDistributions: await compilerDistributions() };
  return { ...recipe, sha256: auditSha(JSON.stringify(recipe)) };
}
