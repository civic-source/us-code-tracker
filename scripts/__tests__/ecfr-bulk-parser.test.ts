import { createHash } from 'node:crypto';
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractTitle, extractorIdentity } from '../lib/ecfr-bulk-parser.js';

const roots: string[] = [];
const xml = (body: string, title = '28') => `<?xml version="1.0"?><DLPSTEXTCLASS><HEADER><FILEDESC><PUBLICATIONSTMT><IDNO TYPE="title">${title}</IDNO></PUBLICATIONSTMT></FILEDESC></HEADER><TEXT><BODY><ECFRBRWS><AMDDATE>Oct. 27, 2026(fm)</AMDDATE>${body}</ECFRBRWS></BODY></TEXT></DLPSTEXTCLASS>`;
async function parse(text: string, digest?: string) {
  const root = await mkdtemp(join(tmpdir(), 'ecfr-parser-'));
  roots.push(root);
  const filePath = join(root, 'title.xml');
  await writeFile(filePath, text);
  return extractTitle({ filePath, cfrTitle: 28, sourceSha256: digest ?? createHash('sha256').update(text).digest('hex') });
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('streaming eCFR authority extraction', () => {
  it('retains mixed text order, part zero and exact hierarchy without leaking sibling scope', async () => {
    const result = await parse(xml(`<DIV1 N="1" NODE="28:1" TYPE="TITLE"><HEAD>Title 28</HEAD><DIV3 N="I" NODE="28:1.0.1" TYPE="CHAPTER"><HEAD>CHAPTER I—DEPARTMENT OF JUSTICE</HEAD><DIV5 N="0" NODE="28:1.0.1.1.1" TYPE="PART"><HEAD>PART 0—Organization</HEAD><AUTH><HED>Authority:</HED><PSPACE> 18 <E>U.S.C.</E> 1, 2; 28 U.S.C. 509.\n</PSPACE></AUTH><DIV8 N="§ 0.1" NODE="28:1.0.1.1.1.1" TYPE="SECTION"><HEAD>§ 0.1 Units</HEAD><SECAUTH>Section <E>18 U.S.C.</E> 3.</SECAUTH></DIV8></DIV5><DIV5 N="1" NODE="28:1.0.1.1.2" TYPE="PART"><HEAD>PART 1—Other</HEAD><PARAUTH>28 U.S.C. 510.</PARAUTH></DIV5></DIV3></DIV1>`));
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    const [part, section, next] = result.value.authorities;
    expect(result.value.amendmentDateText).toBe('Oct. 27, 2026(fm)');
    expect(part).toMatchObject({ part: '0', section: null, scope: 'PART', heading: 'PART 0—Organization', agency: 'CHAPTER I—DEPARTMENT OF JUSTICE', rawText: 'Authority: 18 U.S.C. 1, 2; 28 U.S.C. 509.\n', text: 'Authority: 18 U.S.C. 1, 2; 28 U.S.C. 509.', ordinal: 1 });
    expect(part?.nodePath).toContain('DIV5[1]/AUTH[1]');
    expect(section).toMatchObject({ part: '0', section: '0.1', scope: 'SECTION', tag: 'SECAUTH', ordinal: 2 });
    expect(next).toMatchObject({ part: '1', section: null, scope: 'PART', tag: 'PARAUTH', ordinal: 3 });
  });
  it('has a stable code-derived identity and deterministic output', async () => {
    const source = xml('<DIV1 TYPE="TITLE" N="1"><AUTH>18 U.S.C. 1.</AUTH></DIV1>');
    expect(await parse(source)).toEqual(await parse(source));
    const identity = await extractorIdentity();
    expect(identity.ok).toBe(true);
    if (!identity.ok) throw identity.error;
    expect(identity.value).toMatchObject({ version: 'ecfr-authority/1', digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(await extractorIdentity()).toEqual(identity);
  });

  it.each([
    ['truncated XML', xml('<DIV1 TYPE="TITLE"><AUTH>18 U.S.C. 1.</AUTH></DIV1>').slice(0, -10), 'unclosed token'],
    ['wrong title', xml('', '19'), 'identity mismatch'],
    ['missing title', '<DLPSTEXTCLASS><TEXT><IDNO TYPE="title">28</IDNO></TEXT></DLPSTEXTCLASS>', 'Missing source'],
    ['unscoped authority', xml('<AUTH>18 U.S.C. 1.</AUTH>'), 'hierarchy scope'],
    ['DOCTYPE', '<!DOCTYPE DLPSTEXTCLASS>' + xml(''), 'DTD and entity'],
    ['external entity', '<!DOCTYPE DLPSTEXTCLASS [<!ENTITY stolen SYSTEM "file:///etc/passwd">]>' + xml('<AUTH>&stolen;</AUTH>'), 'DTD and entity'],
    ['deep XML', xml('<X>'.repeat(260) + '</X>'.repeat(260)), 'nesting exceeds'],
    ['oversized note', xml('<DIV1 TYPE="TITLE"><AUTH>' + 'a'.repeat(131073) + '</AUTH></DIV1>'), '128 KiB'],
  ])('fails closed on %s', async (_name, source, expected) => {
    const result = await parse(source.replace('<?xml version="1.0"?>', ''));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected rejection');
    expect(result.error.message).toContain(expected);
  });

  it('rejects changed retained bytes rather than returning an index for a different hash', async () => {
    const result = await parse(xml(''), '0'.repeat(64));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('SHA-256 mismatch');
  });

  it('rejects an oversized source before attempting extraction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecfr-parser-large-'));
    roots.push(root);
    const filePath = join(root, 'large.xml');
    await writeFile(filePath, '');
    await truncate(filePath, 256 * 1024 * 1024 + 1);
    const result = await extractTitle({ filePath, cfrTitle: 28, sourceSha256: '0'.repeat(64) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('256 MiB');
  });

  it('retains distinct amendment dates for sibling eCFR volumes in source order', async () => {
    const source = xml('<DIV1 TYPE="TITLE"><AUTH>18 U.S.C. 1.</AUTH></DIV1>')
      .replace('</ECFRBRWS>', '</ECFRBRWS><ECFRBRWS><AMDDATE>Nov. 6, 2026</AMDDATE><DIV1 TYPE="TITLE"><AUTH>18 U.S.C. 2.</AUTH></DIV1></ECFRBRWS>');
    const result = await parse(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.amendmentDateText).toBe('Oct. 27, 2026(fm)\nNov. 6, 2026');
    expect(result.value.authorities.map((entry) => entry.text)).toEqual(['18 U.S.C. 1.', '18 U.S.C. 2.']);
  });

});
