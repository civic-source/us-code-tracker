import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

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
});
