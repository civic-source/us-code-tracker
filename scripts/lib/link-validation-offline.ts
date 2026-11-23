import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  DEPRECATED_URL_RULES,
  buildCornellSectionUrl,
  buildCourtListenerSearchUrl,
  buildEcfrAuthoritySearchUrl,
  buildEcfrPartUrl,
  buildFederalRegisterSearchUrl,
  buildGovInfoPublicLawUrl,
  buildGovInfoSearchUrl,
  buildGovInfoSectionUrl,
  buildGovInfoStatuteUrl,
  buildOlrcSectionUrl,
  buildOlrcTitleZipUrl,
  isSafeHttpsUrl,
} from '@civic-source/shared';

export interface LinkValidationIssue {
  readonly source: string;
  readonly url: string;
  readonly reason: string;
}

export interface OfflineValidationResult {
  readonly ok: boolean;
  readonly filesScanned: number;
  readonly urlsChecked: number;
  readonly builderChecks: number;
  readonly issues: readonly LinkValidationIssue[];
}

export const UNSAFE_SCHEME_PREFIXES: readonly string[] = [
  'java' + 'script:',
  'vb' + 'script:',
  'data:text/' + 'html',
];

const URL_TOKEN_PATTERN = new RegExp(
  `(?:https?://|${UNSAFE_SCHEME_PREFIXES.join('|')})[^\\s'"\`<>\\)\\]}]+`,
  'gi'
);

const ALLOWED_CLEARTEXT_HTTP_PREFIXES: readonly string[] = [
  'http://xml.house.gov/schemas/',
  'http://www.w3.org/',
  'http://sitemaps.org/',
  'http://purl.org/',
];

const LOCAL_OR_EXAMPLE_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  'example.com',
  'example.invalid',
  'evil.example',
]);

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.astro',
  '.turbo',
  'diffs',
  'pagefind',
  '__tests__',
]);

function stripTrailingPunctuation(raw: string): string {
  return raw.replace(/[.,;:!?]+$/, '');
}

/** Validate a single extracted URL string against safety and deprecation policies. */
export function validateExtractedUrl(rawUrl: string, source: string): LinkValidationIssue | null {
  const lower = rawUrl.toLowerCase();
  if (UNSAFE_SCHEME_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return { source, url: rawUrl, reason: 'Disallowed active/unsafe URI scheme' };
  }

  for (const rule of DEPRECATED_URL_RULES) {
    if (rule.pattern.test(rawUrl)) {
      return {
        source,
        url: rawUrl,
        reason: `${rule.id}: ${rule.reason} (use ${rule.replacement})`,
      };
    }
  }

  if (lower.startsWith('http://')) {
    if (ALLOWED_CLEARTEXT_HTTP_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
      return null;
    }
    try {
      const host = new URL(rawUrl).hostname.toLowerCase();
      if (LOCAL_OR_EXAMPLE_HOSTS.has(host)) return null;
    } catch {
      return { source, url: rawUrl, reason: 'Malformed URL syntax' };
    }
    return { source, url: rawUrl, reason: 'Cleartext HTTP URL must use HTTPS' };
  }

  // Skip template literals (${...} / {...}) after checking deprecation & cleartext rules above
  if (rawUrl.includes('${') || rawUrl.includes('{')) {
    return null;
  }

  if (!isSafeHttpsUrl(rawUrl)) {
    return { source, url: rawUrl, reason: 'Invalid HTTPS URL or contains embedded credentials' };
  }
  return null;
}

/** Collect literal URLs from structured JSON strings. */
function collectUrlsFromJsonValue(value: unknown, urls: Set<string>): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();
    if (
      lower.startsWith('http://') ||
      lower.startsWith('https://') ||
      UNSAFE_SCHEME_PREFIXES.some((prefix) => lower.startsWith(prefix))
    ) {
      urls.add(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectUrlsFromJsonValue(item, urls);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) {
      collectUrlsFromJsonValue(entry, urls);
    }
  }
}

/** Scan a single file for invalid, cleartext, or deprecated URLs. */
export async function scanFileForUrls(
  absPath: string,
  relPath: string
): Promise<{ urlsChecked: number; issues: LinkValidationIssue[]; externalUrls: string[] }> {
  const content = await readFile(absPath, 'utf-8');
  const extracted = new Set<string>();
  const issues: LinkValidationIssue[] = [];

  if (absPath.endsWith('.json')) {
    try {
      const parsed: unknown = JSON.parse(content);
      collectUrlsFromJsonValue(parsed, extracted);
    } catch (error: unknown) {
      issues.push({
        source: relPath,
        url: relPath,
        reason: `Malformed JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  } else {
    URL_TOKEN_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = URL_TOKEN_PATTERN.exec(content)) !== null) {
      extracted.add(stripTrailingPunctuation(match[0]));
    }
  }

  const externalUrls: string[] = [];
  for (const url of extracted) {
    const issue = validateExtractedUrl(url, relPath);
    if (issue) {
      issues.push(issue);
    } else if (!url.includes('${') && !url.includes('{') && url.startsWith('https://')) {
      externalUrls.push(url);
    }
  }

  return { urlsChecked: extracted.size, issues, externalUrls };
}

/** Recursively gather target files under `dirPath` matching `extensions`. */
export async function collectFilesRecursive(
  dirPath: string,
  extensions: readonly string[],
  out: string[],
  ignoreNames: ReadonlySet<string> = new Set()
): Promise<void> {
  if (!existsSync(dirPath)) return;
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name) || ignoreNames.has(entry.name)) continue;
    const full = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await collectFilesRecursive(full, extensions, out, ignoreNames);
    } else if (
      entry.isFile() &&
      extensions.some((ext) => entry.name.endsWith(ext)) &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.spec.ts')
    ) {
      out.push(full);
    }
  }
}

/** Verify canonical URL builders produce safe, allowlisted URLs for representative citations. */
function verifyBuilderContracts(): { checks: number; issues: LinkValidationIssue[] } {
  const cases: Array<{ label: string; url: string; hosts: readonly string[] }> = [];
  const citations: Array<[string | number, string]> = [
    [10, '135'],
    [18, '1001'],
    [18, '175b'],
    [31, '3720B'],
    [16, '470hh'],
    [16, '460bbbb'],
    ['5a', '101'],
    ['18', '100\u20131'],
  ];

  for (const [title, section] of citations) {
    cases.push(
      { label: `olrc:${title}/${section}`, url: buildOlrcSectionUrl(title, section), hosts: ['uscode.house.gov'] },
      { label: `govinfo:${title}/${section}`, url: buildGovInfoSectionUrl(title, section), hosts: ['www.govinfo.gov'] },
      { label: `govinfo-search:${title}/${section}`, url: buildGovInfoSearchUrl(title, section), hosts: ['www.govinfo.gov'] },
      { label: `cornell:${title}/${section}`, url: buildCornellSectionUrl(title, section), hosts: ['www.law.cornell.edu'] },
      { label: `ecfr-search:${title}/${section}`, url: buildEcfrAuthoritySearchUrl(title, section), hosts: ['www.ecfr.gov'] },
      { label: `fr-search:${title}/${section}`, url: buildFederalRegisterSearchUrl(title, section), hosts: ['www.federalregister.gov'] },
      { label: `cl-search:${title}/${section}`, url: buildCourtListenerSearchUrl(title, section), hosts: ['www.courtlistener.com'] }
    );
  }

  cases.push(
    { label: 'olrc-zip:119/142/18', url: buildOlrcTitleZipUrl(119, '142', 18), hosts: ['uscode.house.gov'] },
    { label: 'olrc-zip:119/73not60/5a', url: buildOlrcTitleZipUrl('119', '73not60', '5a'), hosts: ['uscode.house.gov'] },
    { label: 'govinfo-statute:62/749', url: buildGovInfoStatuteUrl(62, 749), hosts: ['www.govinfo.gov'] },
    { label: 'govinfo-plaw:104/292', url: buildGovInfoPublicLawUrl(104, 292), hosts: ['www.govinfo.gov'] },
    { label: 'ecfr-current:19/162', url: buildEcfrPartUrl(19, 162), hosts: ['www.ecfr.gov'] },
    { label: 'ecfr-historical:32/584', url: buildEcfrPartUrl(32, 584, '2019-11-11'), hosts: ['www.ecfr.gov'] }
  );

  const issues: LinkValidationIssue[] = [];
  for (const c of cases) {
    if (!isSafeHttpsUrl(c.url, c.hosts)) {
      issues.push({ source: c.label, url: c.url, reason: 'Builder failed HTTPS allowlist check' });
    }
    const policyIssue = validateExtractedUrl(c.url, c.label);
    if (policyIssue) issues.push(policyIssue);
  }
  return { checks: cases.length, issues };
}

/** Check internal `/us-code-tracker/statute/.../` paths inside curated topics resolve to content files. */
async function verifyTopicInternalPaths(rootDir: string): Promise<LinkValidationIssue[]> {
  const statutesDir = join(rootDir, 'apps/web/content-data/statutes');
  const topicsDir = join(rootDir, 'apps/web/public/topics');
  if (!existsSync(statutesDir) || !existsSync(topicsDir)) return [];

  const topicFiles: string[] = [];
  await collectFilesRecursive(topicsDir, ['.json'], topicFiles);
  const issues: LinkValidationIssue[] = [];

  for (const tf of topicFiles) {
    if (tf.endsWith('index.json')) continue;
    const raw = JSON.parse(await readFile(tf, 'utf-8')) as {
      memberProvisions?: Array<{ url?: string }>;
    };
    for (const member of raw.memberProvisions ?? []) {
      const url = member.url;
      if (!url) continue;
      if (!url.startsWith('/us-code-tracker/statute/')) {
        issues.push({
          source: relative(rootDir, tf),
          url,
          reason: 'Internal topic statute URL must start with /us-code-tracker/statute/',
        });
        continue;
      }
      const stripped = url.replace(/^\/us-code-tracker\/statute\//, '').replace(/\/$/, '');
      if (!stripped || stripped.includes('..')) {
        issues.push({
          source: relative(rootDir, tf),
          url,
          reason: 'Invalid internal topic statute path traversal segment',
        });
        continue;
      }
      const mdPath = join(statutesDir, `${stripped}.md`);
      if (!existsSync(mdPath)) {
        issues.push({
          source: relative(rootDir, tf),
          url,
          reason: `Internal topic statute target not found: statutes/${stripped}.md`,
        });
      }
    }
  }
  return issues;
}

/** Collect all repository files inspected by offline link validation. */
async function gatherOfflineTargetFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  await collectFilesRecursive(join(rootDir, 'apps/web/public/context'), ['.json'], files);
  await collectFilesRecursive(join(rootDir, 'apps/web/public/topics'), ['.json'], files);
  await collectFilesRecursive(join(rootDir, 'apps/web/public/neighborhoods'), ['.json'], files);
  await collectFilesRecursive(join(rootDir, 'apps/web/src'), ['.astro', '.svelte', '.ts'], files);
  await collectFilesRecursive(
    join(rootDir, 'packages'),
    ['.ts'],
    files,
    new Set(['external-links.ts'])
  );
  await collectFilesRecursive(join(rootDir, 'scripts'), ['.ts'], files);

  for (const sub of ['annotations', 'regulations', 'legislative']) {
    await collectFilesRecursive(
      join(rootDir, 'apps/web/content-data', sub),
      ['.json', '.yaml', '.yml'],
      files
    );
  }

  for (const docPath of [
    'README.md',
    'docs/plan/docs/SOURCE-RECONCILIATION.md',
    'docs/plan/USCT-001-RECONCILIATION.md',
  ]) {
    const abs = join(rootDir, docPath);
    if (existsSync(abs)) files.push(abs);
  }

  return Array.from(new Set(files)).sort();
}

/** Run deterministic offline validation over builders, source files, static JSON, and sidecars. */
export async function runOfflineLinkValidation(rootDir: string): Promise<OfflineValidationResult> {
  const builderResult = verifyBuilderContracts();
  const issues: LinkValidationIssue[] = [...builderResult.issues];
  const files = await gatherOfflineTargetFiles(rootDir);

  let urlsChecked = 0;
  for (const absPath of files) {
    const res = await scanFileForUrls(absPath, relative(rootDir, absPath));
    urlsChecked += res.urlsChecked;
    issues.push(...res.issues);
  }

  issues.push(...(await verifyTopicInternalPaths(rootDir)));

  return {
    ok: issues.length === 0,
    filesScanned: files.length,
    urlsChecked,
    builderChecks: builderResult.checks,
    issues,
  };
}
