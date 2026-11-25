import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const fixture = new URL('./fixtures/source-audit/pl-119-142-section-31-derived.xml', import.meta.url);
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const generatedAt = '2026-11-25T01:39:48.293Z';

const pinChanges: Array<[string, { archive?: Record<string, unknown>; member?: Record<string, unknown> }]> = [
    ['archive-digest', { archive: { sha256: '0'.repeat(64) } }],
    ['member-digest', { member: { sha256: '0'.repeat(64) } }],
    ['oversized-member', { member: { byteLength: 128 * 1024 ** 2 + 1 } }],
    ['unsafe-member', { member: { name: '../usc18.xml' } }],
    ['credential-url', { archive: { url: 'https://name:PRIVATE_URL_SENTINEL@uscode.house.gov/source.zip' } }],
    ['query-url', { archive: { url: 'https://uscode.house.gov/download/releasepoints/us/pl/119/142/xml_usc18@119-142.zip?token=PRIVATE_URL_SENTINEL' } }],
  ];

describe('bounded source-correction audit CLI', () => {
  let root: string;
  let repository: string;
  let archive: string;
  let inventory: string;
  let acceptedRef: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'civic-source-audit-'));
    repository = join(root, 'data');
    await mkdir(repository);
    const xml = await readFile(fixture);
    const source = join(root, 'fixture.xml');
    archive = join(root, 'fixture.zip'); inventory = join(root, 'inventory.json');
    await writeFile(source, xml);
    // A derived test envelope is intentionally not an original publisher ZIP.
    execFileSync('python3', ['-c', 'import sys,zipfile\nwith zipfile.ZipFile(sys.argv[2],"w") as z:z.write(sys.argv[1],"usc18.xml")', source, archive]);
    const zip = await readFile(archive);
    await writeFile(inventory, JSON.stringify({ schemaVersion: 'usct.retained-source-inventory/v1', title: '18',
      releaseLabel: 'PL 119-142', archive: { url: 'https://uscode.house.gov/download/releasepoints/us/pl/119/142/xml_usc18@119-142.zip',
        sha256: digest(zip), byteLength: zip.length }, member: { name: 'usc18.xml', sha256: digest(xml), byteLength: xml.length } }));
    const path = join(repository, 'statutes/title-18/chapter-2');
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'section-31.md'), await readFile(new URL('./fixtures/source-audit/accepted-section-31-7297.md', import.meta.url)));
    execFileSync('git', ['init', '--quiet', repository]);
    execFileSync('git', ['-C', repository, 'add', '.']);
    execFileSync('git', ['-C', repository, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture']);
    acceptedRef = execFileSync('git', ['-C', repository, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  function run(output: string, extra: string[] = [], environment = process.env, timeout = 30_000) {
    return spawnSync(process.execPath, ['--import', 'tsx', resolve('scripts/audit-source-correction.ts'),
      '--inventory', inventory, '--archive', archive, '--data-repo', repository, '--accepted-ref', acceptedRef,
      '--generated-at', generatedAt, '--output', join(root, output), ...(extra.includes('--all') ? [] : ['--sections', '31']), ...extra],
    { encoding: 'utf8', timeout, maxBuffer: 2 * 1024 ** 2, env: environment });
  }

  async function replaceSource(xml: string) {
    const source = join(root, 'replacement.xml'); await writeFile(source, xml);
    execFileSync('python3', ['-c', 'import sys,zipfile\nwith zipfile.ZipFile(sys.argv[2],"w") as z:z.write(sys.argv[1],"usc18.xml")', source, archive]);
    const zip = await readFile(archive);
    const value = JSON.parse(await readFile(inventory, 'utf8')) as { archive: { sha256: string; byteLength: number }; member: { sha256: string; byteLength: number } };
    value.archive.sha256 = digest(zip); value.archive.byteLength = zip.length;
    value.member.sha256 = digest(xml); value.member.byteLength = Buffer.byteLength(xml);
    await writeFile(inventory, JSON.stringify(value));
  }

  it('qualifies reconstructed section31 while retaining the stored all-lane failure and immutable Git input', async () => {
    const before = execFileSync('git', ['-C', repository, 'status', '--porcelain'], { encoding: 'utf8' });
    const process = run('audit');
    expect(process.status, process.stdout + process.stderr).toBe(0);
    const report = JSON.parse(await readFile(join(root, 'audit', 'audit-manifest.json'), 'utf8')) as {
      state: string; selectedFragmentQualified: boolean; dataAccepted: boolean;
      records: Array<{ section: string; storedPass: boolean; candidatePass: boolean; difference: string }>;
    };
    expect(report).toMatchObject({ state: 'renderer-fragment-audit', selectedFragmentQualified: true, dataAccepted: false });
    expect(report.records).toEqual([expect.objectContaining({ section: '31', storedPass: false,
      candidatePass: true, difference: 'body_changed' })]);
    expect(execFileSync('git', ['-C', repository, 'status', '--porcelain'], { encoding: 'utf8' })).toBe(before);
  }, 30_000);
  it('inventories every source record and stages more than100 sections in bounded batches', async () => {
    const xml = '<uscDoc xmlns="http://xml.house.gov/schemas/uslm/1.0"><meta><docPublicationName>Online@119-142</docPublicationName></meta><main><title identifier="/us/usc/t18"><num>18</num><chapter identifier="/us/usc/t18/ch2"><num>2</num>'
      + Array.from({ length: 101 }, (_, index) => `<section identifier="/us/usc/t18/s${index + 1}"><num>${index + 1}.</num><heading>Example</heading><content>Literal test content.</content></section>`).join('')
      + '</chapter></title></main></uscDoc>';
    await replaceSource(xml);
    const process = run('all', ['--all']);
    expect(process.status, process.stdout + process.stderr).toBe(0);
    const report = JSON.parse(await readFile(join(root, 'all/audit-manifest.json'), 'utf8')) as {
      sourceInventory: { topLevelSourceRecords: number }; records: unknown[]; batches: Array<{ sections: string[] }>;
    };
    expect(report.sourceInventory.topLevelSourceRecords).toBe(101);
    expect(report.records).toHaveLength(101);
    expect(report.batches.map(batch => batch.sections.length)).toEqual([100, 1]);
  }, 30_000);

  it('replays canonical manifests byte-for-byte while binding actual producer and oracle identities', async () => {
    const first = run('cold-one'); const second = run('cold-two');
    expect(first.status, first.stdout + first.stderr).toBe(0);
    expect(second.status, second.stdout + second.stderr).toBe(0);
    const one = await readFile(join(root, 'cold-one/audit-manifest.json'), 'utf8');
    expect(one).toBe(await readFile(join(root, 'cold-two/audit-manifest.json'), 'utf8'));
    const manifest = JSON.parse(one) as { recipe: { files: Record<string, string>; nodeVersion: string } };
    expect(manifest.recipe.nodeVersion).toBe(process.version);
    expect(manifest.recipe.files['scripts/python/uslm_fidelity.py']).toBe(digest(await readFile('scripts/python/uslm_fidelity.py')));
    expect(manifest.recipe.files['apps/web/src/lib/anchored-entry.ts']).toBe(digest(await readFile('apps/web/src/lib/anchored-entry.ts')));
  }, 30_000);

  it('resumes only pinned staging while reproducing the cold manifest and fresh source witnesses', async () => {
    expect(run('original').status).toBe(0);
    const cold = await readFile(join(root, 'original/audit-manifest.json'));
    const resumed = run('resumed', ['--resume-from', join(root, 'original'), '--resume-sha256', digest(cold)]);
    expect(resumed.status, resumed.stdout + resumed.stderr).toBe(0);
    expect(await readFile(join(root, 'resumed/audit-manifest.json'), 'utf8')).toBe(cold.toString('utf8'));
    const operation = JSON.parse(await readFile(join(root, 'resumed/audit-operation.json'), 'utf8')) as { reusedCandidates: number };
    expect(operation.reusedCandidates).toBe(1);
    const witness = JSON.parse(await readFile(join(root, 'resumed/records/31-candidate-witness.json'), 'utf8')) as { pass: boolean };
    expect(witness.pass).toBe(true);
  }, 30_000);

  it('keeps the2GiB reserve inside the existing producer worker when space changes between processes', async () => {
    const preload = join(root, 'capacity-boundary.mjs');
    await writeFile(preload, `import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.statfs;
fs.statfs = async (...args) => { const value = await original(...args); if (process.argv[1]?.endsWith('prepare-source-correction.ts')) return { ...value, bavail: (1024n ** 3n) / value.bsize }; return value; };
syncBuiltinESMExports();
`);
    const result = run('worker-reserve', [], { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` });
    expect(result.status).toBe(2);
    expect(await readFile(join(root, 'worker-reserve/batch-0000-producer.stderr.txt'), 'utf8')).toContain('2048 MiB reserve');
  }, 30_000);

  it('reports extra accepted paths and blocks claiming the whole source inventory is qualified', async () => {
    const path = 'statutes/title-18/chapter-2/section-999999.md';
    await writeFile(join(repository, path), '# Unmapped stored record.\n');
    execFileSync('git', ['-C', repository, 'add', '.']);
    execFileSync('git', ['-C', repository, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'extra fixture']);
    acceptedRef = execFileSync('git', ['-C', repository, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const result = run('extra-path', ['--all']);
    expect(result.status, result.stdout + result.stderr).toBe(1);
    const report = JSON.parse(await readFile(join(root, 'extra-path/audit-manifest.json'), 'utf8')) as {
      acceptedInventory: { extraPaths: string[] }; selectedFragmentQualified: boolean;
    };
    expect(report.acceptedInventory.extraPaths).toEqual([path]);
    expect(report.selectedFragmentQualified).toBe(false);
  }, 30_000);

  it('blocks selected repair qualification when the stored comparison is operationally inconclusive', async () => {
    await writeFile(join(repository, 'statutes/title-18/chapter-2/section-31.md'),
      '---\ncurrent_through: "PL 119-142"\n---\n' + Array.from({ length: 140 }, (_, index) => '    '.repeat(index) + '- Nested stored list.').join('\n'));
    execFileSync('git', ['-C', repository, 'add', '.']);
    execFileSync('git', ['-C', repository, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'inconclusive fixture']);
    acceptedRef = execFileSync('git', ['-C', repository, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const result = run('inconclusive');
    const report = JSON.parse(await readFile(join(root, 'inconclusive/audit-manifest.json'), 'utf8')) as {
      selectedFragmentQualified: boolean; records: Array<{ classification: string; storedWitness: { exitCode: number } }>;
    };
    expect(report.records[0]?.storedWitness.exitCode).toBe(2);
    expect(result.status, result.stdout + result.stderr).toBe(2);
    expect(report.selectedFragmentQualified).toBe(false);
    expect(report.records[0]?.classification).toBe('comparison_inconclusive');
  }, 30_000);

  it('reads committed bytes while preserving dirty statutes and untracked checkpoints', async () => {
    const dirty = join(repository, 'statutes/title-18/chapter-2/section-31.md');
    const checkpoint = join(repository, '.import-state.json');
    await writeFile(dirty, 'UNCOMMITTED_IMPORT_MUST_SURVIVE');
    await writeFile(checkpoint, '{"uncommitted":"retain"}');
    const before = execFileSync('git', ['-C', repository, 'status', '--porcelain'], { encoding: 'utf8' });
    expect(run('dirty').status).toBe(0);
    const report = JSON.parse(await readFile(join(root, 'dirty/audit-manifest.json'), 'utf8')) as { records: Array<{ storedSha256: string }> };
    expect(report.records[0]?.storedSha256).toBe(digest(await readFile(new URL('./fixtures/source-audit/accepted-section-31-7297.md', import.meta.url))));
    expect(await readFile(dirty, 'utf8')).toBe('UNCOMMITTED_IMPORT_MUST_SURVIVE');
    expect(await readFile(checkpoint, 'utf8')).toBe('{"uncommitted":"retain"}');
    expect(execFileSync('git', ['-C', repository, 'status', '--porcelain'], { encoding: 'utf8' })).toBe(before);
  }, 30_000);

  it.each(['missing', 'corrupt'])('refuses %s pinned resume transport without creating replacement outputs', async mode => {
    expect(run('original').status).toBe(0);
    const bytes = await readFile(join(root, 'original/audit-manifest.json'));
    const report = JSON.parse(bytes.toString()) as { records: Array<{ candidatePath: string }> };
    const path = join(root, 'original', report.records[0]!.candidatePath);
    if (mode === 'missing') await rm(path); else await writeFile(path, 'CORRUPT_TRANSPORT');
    const result = run('refused', ['--resume-from', join(root, 'original'), '--resume-sha256', digest(bytes)]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Resume transport');
    await expect(readFile(join(root, 'refused/audit-manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);

  it('invalidates staging when the declared fixed generation input changes', async () => {
    expect(run('original').status).toBe(0);
    const previous = await readFile(join(root, 'original/audit-manifest.json'));
    const next = '2026-11-25T02:00:00.000Z';
    const result = run('invalidated', ['--resume-from', join(root, 'original'), '--resume-sha256', digest(previous), '--generated-at', next]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const operation = JSON.parse(await readFile(join(root, 'invalidated/audit-operation.json'), 'utf8')) as { reusedCandidates: number; invalidatedCandidates: number };
    expect(operation).toEqual({ reusedCandidates: 0, invalidatedCandidates: 1 });
    const report = JSON.parse(await readFile(join(root, 'invalidated/audit-manifest.json'), 'utf8')) as { generatedAt: string };
    expect(report.generatedAt).toBe(next);
  }, 30_000);

  it('updates the accepted commit context while reusing staging for an unchanged statute blob', async () => {
    expect(run('original').status).toBe(0);
    const previous = await readFile(join(root, 'original/audit-manifest.json'));
    await writeFile(join(repository, 'annotation-only.txt'), 'Unrelated fixture metadata.');
    execFileSync('git', ['-C', repository, 'add', '.']);
    execFileSync('git', ['-C', repository, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'annotation fixture']);
    acceptedRef = execFileSync('git', ['-C', repository, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const result = run('incremental', ['--resume-from', join(root, 'original'), '--resume-sha256', digest(previous)]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const operation = JSON.parse(await readFile(join(root, 'incremental/audit-operation.json'), 'utf8')) as { reusedCandidates: number };
    expect(operation.reusedCandidates).toBe(1);
    const report = JSON.parse(await readFile(join(root, 'incremental/audit-manifest.json'), 'utf8')) as { acceptedRef: string };
    expect(report.acceptedRef).toBe(acceptedRef);
  }, 30_000);

  it.each([
    '<table><tr><td>Unsupported table.</td></tr></table>',
    '<notes><note role="footnote">Unsupported footnote.</note></notes>',
    '<unclassified>Unknown text-bearing structure.</unclassified>',
  ])('retains unqualified source structures and blocks accepting their selected fragment', async addition => {
    const xml = await readFile(fixture, 'utf8');
    const at = xml.lastIndexOf('</section>');
    await replaceSource(xml.slice(0, at) + addition + xml.slice(at));
    const result = run('unsupported');
    expect(result.status, result.stdout + result.stderr).toBe(1);
    const report = JSON.parse(await readFile(join(root, 'unsupported/audit-manifest.json'), 'utf8')) as {
      selectedFragmentQualified: boolean; records: Array<{ candidateWitness: { issues: unknown[] } }>;
    };
    expect(report.selectedFragmentQualified).toBe(false);
    expect(report.records[0]?.candidateWitness.issues.length).toBeGreaterThan(0);
  }, 30_000);

  it.each(pinChanges)('refuses invalid retained %s pins before creating any output', async (_name, change) => {
    const value = JSON.parse(await readFile(inventory, 'utf8')) as { archive: Record<string, unknown>; member: Record<string, unknown> };
    value.archive = { ...value.archive, ...change.archive }; value.member = { ...value.member, ...change.member };
    await writeFile(inventory, JSON.stringify(value));
    const result = run('invalid-pins');
    expect(result.status).toBe(2);
    expect(result.stdout + result.stderr).not.toContain('PRIVATE_URL_SENTINEL');
    await expect(readFile(join(root, 'invalid-pins/input.xml'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);

  it.each(['missing', 'duplicate'])('blocks %s canonical source identity without inventing an alias', async mode => {
    const xml = await readFile(fixture, 'utf8');
    const replacement = mode === 'missing' ? xml.replace('identifier="/us/usc/t18/s31"', 'identifier="/us/usc/t18/s999999"')
      : xml.replace('</chapter>', xml.slice(xml.indexOf('<section'), xml.lastIndexOf('</section>') + '</section>'.length) + '</chapter>');
    await replaceSource(replacement);
    const result = run('bad-identity');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('absent, grouped or ambiguous');
  }, 30_000);

  it('blocks attributing retained bytes to a different publisher edition', async () => {
    const value = JSON.parse(await readFile(inventory, 'utf8')) as { releaseLabel: string; archive: { url: string } };
    value.releaseLabel = 'PL 119-73';
    value.archive.url = 'https://uscode.house.gov/download/releasepoints/us/pl/119/73/xml_usc18@119-73.zip';
    await writeFile(inventory, JSON.stringify(value));
    expect(run('wrong-release').status).toBe(2);
    const packet = JSON.parse(await readFile(join(root, 'wrong-release/inventory.stdout.json'), 'utf8')) as { state: string; error: string };
    expect(packet.state).toBe('inconclusive');
    expect(packet.error).toContain('publisher edition');
  }, 30_000);

  it('rejects forged cached acceptance after an attacker repins internally consistent wrong staging bytes', async () => {
    expect(run('original').status).toBe(0);
    const prior = join(root, 'original/audit-manifest.json');
    const report = JSON.parse(await readFile(prior, 'utf8')) as {
      selectedFragmentQualified: boolean; records: Array<{ candidatePath: string; candidateSha256: string }>;
      batches: Array<{ name: string; candidate: { files: Array<{ path: string; sha256: string }> } }>;
      transport: Array<{ path: string; sha256: string; byteLength: number }>;
    };
    const record = report.records[0]!;
    const original = await readFile(join(root, 'original', record.candidatePath), 'utf8');
    const changed = original.replace(/^# .+$/m, '# Fabricated source heading');
    expect(changed).not.toBe(original);
    await writeFile(join(root, 'original', record.candidatePath), changed);
    record.candidateSha256 = digest(changed); report.selectedFragmentQualified = true;
    const batch = report.batches[0]!;
    batch.candidate.files[0]!.sha256 = digest(changed);
    const manifestPath = `${batch.name}-candidate-manifest.json`;
    await writeFile(join(root, 'original', manifestPath), JSON.stringify(batch.candidate, null, 2) + '\n');
    for (const path of [record.candidatePath, manifestPath]) {
      const payload = await readFile(join(root, 'original', path));
      const pin = report.transport.find(item => item.path === path)!;
      pin.sha256 = digest(payload); pin.byteLength = payload.length;
    }
    const pinned = JSON.stringify(report, null, 2) + '\n'; await writeFile(prior, pinned);
    const result = run('forged-cache', ['--resume-from', join(root, 'original'), '--resume-sha256', digest(pinned)]);
    expect(result.status).not.toBe(0);
    if (result.status === 1) {
      const current = JSON.parse(await readFile(join(root, 'forged-cache/audit-manifest.json'), 'utf8')) as {
        selectedFragmentQualified: boolean; records: Array<{ candidateWitness: { pass: boolean } }>;
      };
      expect(current.selectedFragmentQualified).toBe(false);
      expect(current.records[0]?.candidateWitness.pass).toBe(false);
    } else expect(result.status).toBe(2);
  }, 30_000);

  it('aborts rather than treating an unknown worker file size as zero quota usage', async () => {
    const preload = join(root, 'size-boundary.mjs');
    await writeFile(preload, `import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.lstat; let fired = false;
fs.lstat = async (...args) => { if (!fired && process.argv[1]?.endsWith('audit-source-correction.ts') && String(args[0]).endsWith('/section-31.md')) { fired = true; const error = new Error('Transient unknown worker metadata'); error.code = 'ENOENT'; throw error; } return original(...args); };
syncBuiltinESMExports();
`);
    const result = run('unknown-size', [], { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Transient unknown worker metadata');
  }, 30_000);

  it('refuses a FIFO archive before opening it can block the audit indefinitely', async () => {
    await rm(archive); execFileSync('mkfifo', [archive]);
    const result = run('fifo-input', [], process.env, 3_000);
    expect(result.status, result.stdout + result.stderr).toBe(2);
    await expect(readFile(join(root, 'fifo-input/audit-manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 10_000);

  it('reads the physical accepted commit rather than mutable local Git replacement views', async () => {
    const originalRef = acceptedRef;
    const original = await readFile(join(repository, 'statutes/title-18/chapter-2/section-31.md'));
    await writeFile(join(repository, 'statutes/title-18/chapter-2/section-31.md'), '---\ncurrent_through: "PL 119-142"\n---\n# Replacement view.\n');
    execFileSync('git', ['-C', repository, 'add', '.']);
    execFileSync('git', ['-C', repository, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'replacement fixture']);
    const replacement = execFileSync('git', ['-C', repository, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    execFileSync('git', ['-C', repository, 'replace', originalRef, replacement]);
    const result = run('replacement-view');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const report = JSON.parse(await readFile(join(root, 'replacement-view/audit-manifest.json'), 'utf8')) as {
      records: Array<{ storedSha256: string }>;
    };
    expect(report.records[0]?.storedSha256).toBe(digest(original));
  }, 30_000);

  it('does not lazily fetch missing accepted blobs from a promisor repository', async () => {
    const upstream = join(root, 'promisor.git');
    execFileSync('git', ['clone', '--quiet', '--local', '--no-hardlinks', '--bare', repository, upstream]);
    const blob = execFileSync('git', ['-C', repository, 'rev-parse', `${acceptedRef}:statutes/title-18/chapter-2/section-31.md`], { encoding: 'utf8' }).trim();
    execFileSync('git', ['-C', repository, 'remote', 'add', 'origin', upstream]);
    for (const [key, value] of [['core.repositoryformatversion', '1'], ['extensions.partialClone', 'origin'],
      ['remote.origin.promisor', 'true'], ['remote.origin.partialclonefilter', 'blob:none']]) execFileSync('git', ['-C', repository, 'config', key!, value!]);
    await rm(join(repository, '.git/objects', blob.slice(0, 2), blob.slice(2)));
    const result = run('missing-blob');
    expect(result.status, result.stdout + result.stderr).toBe(2);
    const remainsMissing = spawnSync('git', ['--no-lazy-fetch', '-C', repository, 'cat-file', '-e', blob]);
    expect(remainsMissing.status).not.toBe(0);
  }, 30_000);

});
