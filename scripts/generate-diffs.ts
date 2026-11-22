#!/usr/bin/env npx tsx
/**
 * Pre-compute version diffs from the us-code git repo.
 * Only generates diffs for sections with meaningful BODY changes
 * (excludes frontmatter-only changes like current_through, generated_at).
 *
 * Supports incremental mode: skips pairs already in existing manifest.
 *
 * Usage:
 *   npx tsx scripts/generate-diffs.ts --repo /path/to/us-code --output apps/web/public/diffs/
 *   npx tsx scripts/generate-diffs.ts --repo /path/to/us-code --output apps/web/public/diffs/ --full
 */

import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { parsePlTag, sortPlTags } from './lib/pl-tags.js';

interface DiffLine {
  type: 'add' | 'del' | 'context';
  content: string;
}

interface SectionDiff {
  from: string;
  to: string;
  lines: DiffLine[];
}

interface DiffManifestPair {
  from: string;
  to: string;
  changedSections: number;
  /** True when one or more incomplete/failed releases sit between `from` and `to` (USCT-005) */
  spansIncompleteGap?: boolean;
  /** Missing/incomplete release keys between `from` and `to` (USCT-005) */
  missingReleasesBetween?: string[];
}

interface DiffManifest {
  pairs: DiffManifestPair[];
  incompleteReleases?: string[];
  generatedAt: string;
}

/** Frontmatter fields that change on every regeneration — not meaningful diffs */
const FRONTMATTER_NOISE = ['current_through', 'generated_at', 'classification'];

function getTags(repo: string): string[] {
  // execFileSync (no shell) + sortPlTags (anchored validation) ensure a tag
  // name carrying shell metacharacters can neither be executed nor flow into a
  // diff range (#235).
  const out = execFileSync('git', ['tag'], { cwd: repo, encoding: 'utf8' });
  const raw = out.trim() ? out.trim().split('\n') : [];
  return sortPlTags(raw);
}

function getRawDiff(repo: string, from: string, to: string): string {
  try {
    // No shell: arguments are passed directly to git, so `from`/`to` cannot be
    // interpreted as shell syntax (#235). They are already constrained to
    // `pl-<digits>-<digits>` by getTags/sortPlTags.
    return execFileSync('git', ['diff', '--unified=3', `${from}..${to}`, '--', 'statutes/'], {
      cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    });
  } catch (e) {
    console.warn(`  Warning: git diff failed for ${from}..${to}: ${e instanceof Error ? e.message : 'unknown'}`);
    return '';
  }
}

/** Check if a diff line is a frontmatter noise change */
function isFrontmatterNoise(content: string): boolean {
  return FRONTMATTER_NOISE.some((field) => content.trimStart().startsWith(`${field}:`));
}

/** Check if a diff has meaningful body changes (not just frontmatter) */
function hasMeaningfulChanges(lines: DiffLine[]): boolean {
  return lines.some(
    (line) => (line.type === 'add' || line.type === 'del') && !isFrontmatterNoise(line.content)
  );
}

/** Filter diff to only body-relevant lines (strip frontmatter noise) */
function filterToBodyChanges(lines: DiffLine[]): DiffLine[] {
  return lines.filter(
    (line) => line.type === 'context' || !isFrontmatterNoise(line.content)
  );
}

function parseDiff(raw: string, from: string, to: string): Map<string, SectionDiff> {
  const result = new Map<string, SectionDiff>();
  if (!raw.trim()) return result;

  let currentPath = '';
  let currentLines: DiffLine[] = [];

  for (const line of raw.split('\n')) {
    const fileHeader = /^diff --git a\/(.+) b\/.+$/.exec(line);
    if (fileHeader) {
      if (currentPath && currentLines.length > 0) {
        if (hasMeaningfulChanges(currentLines)) {
          result.set(currentPath, { from, to, lines: filterToBodyChanges(currentLines) });
        }
      }
      currentPath = fileHeader[1] ?? '';
      currentLines = [];
      continue;
    }
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('index ') || line.startsWith('@@') || !currentPath) continue;
    if (line.startsWith('+')) currentLines.push({ type: 'add', content: line.slice(1) });
    else if (line.startsWith('-')) currentLines.push({ type: 'del', content: line.slice(1) });
    else currentLines.push({ type: 'context', content: line.slice(1) });
  }
  if (currentPath && currentLines.length > 0 && hasMeaningfulChanges(currentLines)) {
    result.set(currentPath, { from, to, lines: filterToBodyChanges(currentLines) });
  }
  return result;
}

function pathToOutputParts(filePath: string): { title: string; section: string } | null {
  const m = /statutes\/(title-[^/]+)\/[^/]+\/(section-[^/]+)\.md$/.exec(filePath);
  return m ? { title: m[1] ?? '', section: m[2] ?? '' } : null;
}

/** Load existing manifest for incremental mode */
async function loadExistingManifest(outputDir: string): Promise<DiffManifest | null> {
  try {
    const raw = await readFile(join(outputDir, 'manifest.json'), 'utf8');
    return JSON.parse(raw) as DiffManifest;
  } catch {
    return null;
  }
}

/** Read incompleteReleases from the repo's .import-state.json so diffs spanning a gap declare it (USCT-005) */
export async function loadRepoIncompleteReleases(repoDir: string): Promise<string[]> {
  try {
    const raw = await readFile(join(repoDir, '.import-state.json'), 'utf8');
    const state = JSON.parse(raw) as { incompleteReleases?: string[] };
    return Array.isArray(state.incompleteReleases) ? state.incompleteReleases : [];
  } catch {
    return [];
  }
}

/** Return any incomplete release keys chronologically between `fromTag` and `toTag` (USCT-005) */
export function findGapsBetweenTags(
  fromTag: string,
  toTag: string,
  incompleteReleases: readonly string[]
): string[] {
  const [fc, fl] = parsePlTag(fromTag);
  const [tc, tl] = parsePlTag(toTag);
  if (fc === 0 || tc === 0) return [];

  return incompleteReleases.filter((key) => {
    const [kc, kl] = parsePlTag(`pl-${key}`);
    if (kc === 0) return false;
    const afterFrom = kc > fc || (kc === fc && kl > fl);
    const beforeTo = kc < tc || (kc === tc && kl < tl);
    return afterFrom && beforeTo;
  });
}

// --- Main ---

async function runCli() {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string' },
      output: { type: 'string' },
      full: { type: 'boolean', default: false },
    },
  });
  const { repo, output, full } = values;

  if (!repo || !output) {
    console.error('Usage: npx tsx scripts/generate-diffs.ts --repo <path> --output <path> [--full]');
    process.exit(1);
  }

  const tags = getTags(repo);
  const incompleteReleases = await loadRepoIncompleteReleases(repo);
  console.log(`Found ${tags.length} pl-* tags: ${tags[0]} \u2026 ${tags[tags.length - 1]}`);
  if (tags.length < 2) { console.error('Need at least 2 tags to generate diffs.'); process.exit(1); }

  const existingManifest = full ? null : await loadExistingManifest(output);
  const existingPairs = new Set(
    existingManifest?.pairs.map(p => `${p.from}_${p.to}`) ?? []
  );

  const manifest: DiffManifest = {
    pairs: existingManifest?.pairs ?? [],
    ...(incompleteReleases.length > 0 ? { incompleteReleases } : {}),
    generatedAt: new Date().toISOString(),
  };

  let skipped = 0;
  let computed = 0;

  for (let i = 0; i < tags.length - 1; i++) {
    const from = tags[i] as string;
    const to = tags[i + 1] as string;
    const key = `${from}_${to}`;
    const gaps = findGapsBetweenTags(from, to, incompleteReleases);

    if (existingPairs.has(key)) {
      skipped++;
      continue;
    }

    console.log(`  Diffing ${from} \u2192 ${to}\u2026`);

    const diffs = parseDiff(getRawDiff(repo, from, to), from, to);
    let changedSections = 0;
    const dir = join(output, key);

    for (const [filePath, diff] of diffs) {
      const parts = pathToOutputParts(filePath);
      if (!parts) continue;
      const sectionDir = join(dir, parts.title);
      await mkdir(sectionDir, { recursive: true });
      await writeFile(join(sectionDir, `${parts.section}.json`), JSON.stringify(diff));
      changedSections++;
    }

    manifest.pairs.push({
      from,
      to,
      changedSections,
      ...(gaps.length > 0 ? { spansIncompleteGap: true, missingReleasesBetween: gaps } : {}),
    });
    computed++;
    console.log(`    ${changedSections} sections with body changes (excluded frontmatter-only)`);
  }

  manifest.pairs.sort((a, b) => {
    const [ac, al] = parsePlTag(a.from);
    const [bc, bl] = parsePlTag(b.from);
    return ac !== bc ? ac - bc : al - bl;
  });

  const sectionChanges: Record<string, string[]> = {};
  for (const pair of manifest.pairs) {
    const pairDir = join(output, `${pair.from}_${pair.to}`);
    try {
      const titles = await readdir(pairDir).catch(() => [] as string[]);
      for (const titleDir of titles) {
        const sections = await readdir(join(pairDir, titleDir)).catch(() => [] as string[]);
        for (const sectionFile of sections) {
          const key = `${titleDir}/${sectionFile.replace('.json', '')}`;
          if (!sectionChanges[key]) sectionChanges[key] = [];
          sectionChanges[key].push(pair.to);
        }
      }
    } catch {
      // Pair dir may not exist for cached entries from previous runs
    }
  }

  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(output, 'changed-sections.json'), JSON.stringify(sectionChanges));
  console.log(`Done. ${computed} new pairs computed, ${skipped} skipped (already cached). ${Object.keys(sectionChanges).length} sections with changes tracked. Manifest: ${output}/manifest.json`);
}

if (process.argv[1]?.endsWith('generate-diffs.ts')) {
  runCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
