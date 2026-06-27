import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { MAX_DECOMPRESSED_BYTES, MAX_DOWNLOAD_BYTES } from '../constants.js';
import { extractXmlFromZip } from '../zip.js';

/**
 * Construct a minimal single-entry ZIP buffer (local file header + data).
 * Byte offsets match the parser in zip.ts: sig@0, method@8, compressedSize@18,
 * fileNameLen@26, extraLen@28, filename@30, data@30+fileNameLen.
 */
function makeZip(fileName: string, compressionMethod: number, data: Buffer): Buffer {
  const fileNameBytes = Buffer.from(fileName, 'utf-8');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // local file header signature
  header.writeUInt16LE(compressionMethod, 8);
  header.writeUInt32LE(data.length, 18); // compressed size
  header.writeUInt32LE(data.length, 22); // uncompressed size (unused by parser)
  header.writeUInt16LE(fileNameBytes.length, 26);
  header.writeUInt16LE(0, 28); // extra field length
  return Buffer.concat([header, fileNameBytes, data]);
}

describe('extractXmlFromZip', () => {
  it('returns the contents of a stored (method 0) .xml entry', () => {
    const xml = '<uscDoc>hello</uscDoc>';
    const zip = makeZip('doc.xml', 0, Buffer.from(xml, 'utf-8'));
    expect(extractXmlFromZip(zip)).toBe(xml);
  });

  it('inflates a deflate (method 8) .xml entry', () => {
    const xml = `<uscDoc>${'a'.repeat(500)}<section>some longer content for round-tripping</section></uscDoc>`;
    const zip = makeZip('doc.xml', 8, deflateRawSync(Buffer.from(xml, 'utf-8')));
    expect(extractXmlFromZip(zip)).toBe(xml);
  });

  it('returns null when no .xml entry is present', () => {
    const zip = makeZip('readme.txt', 0, Buffer.from('not xml', 'utf-8'));
    expect(extractXmlFromZip(zip)).toBeNull();
  });

  it('returns null (does not throw) when a .xml entry has a corrupt deflate stream', () => {
    // A method-8 entry whose data is not a valid raw-deflate stream. The
    // documented contract is "returns null"; inflateRawSync would otherwise
    // throw "unexpected end of file" and break the null contract.
    const zip = makeZip('doc.xml', 8, Buffer.from('not a valid deflate stream', 'utf-8'));
    expect(extractXmlFromZip(zip)).toBeNull();
  });

  it('returns null (does not throw) for a data-descriptor entry with zero compressed size', () => {
    // General-purpose bit 3 (data descriptor) zips report compressedSize=0 in
    // the local header, so the parser slices an empty buffer; inflateRawSync on
    // empty input throws rather than yielding content.
    const zip = makeZip('doc.xml', 8, Buffer.alloc(0));
    expect(extractXmlFromZip(zip)).toBeNull();
  });

  it('returns null for a decompression bomb that inflates past the cap', () => {
    // 256 KiB of zeros compresses to a few hundred bytes (a tiny entry, well
    // under any download cap) but inflates far beyond a small decompressed cap.
    // maxOutputLength must abort the inflate and return null rather than
    // materializing the full payload.
    const bomb = deflateRawSync(Buffer.alloc(256 * 1024, 0));
    const zip = makeZip('doc.xml', 8, bomb);
    expect(extractXmlFromZip(zip, 1024)).toBeNull();
  });

  it('still inflates a normal entry that stays under the decompressed cap', () => {
    // The cap must not reject legitimate content below the limit.
    const xml = '<uscDoc>under the cap</uscDoc>';
    const zip = makeZip('doc.xml', 8, deflateRawSync(Buffer.from(xml, 'utf-8')));
    expect(extractXmlFromZip(zip, 1024)).toBe(xml);
  });

  it('defaults the decompressed cap above the compressed-download cap (#226)', () => {
    // Regression guard for #226: the inflate cap must NOT be tied to the
    // compressed-download cap. XML inflates ~10-20x, so the all-titles archive
    // (~100-150 MB compressed) can decompress past 300 MiB; collapsing these
    // two bounds back together would false-drop legitimate large titles.
    expect(MAX_DECOMPRESSED_BYTES).toBeGreaterThan(MAX_DOWNLOAD_BYTES);
  });
});
