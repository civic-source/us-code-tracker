import { inflateRawSync } from 'node:zlib';

/**
 * Extract the first `.xml` entry from a ZIP archive buffer.
 *
 * Walks ZIP local file headers (signature 0x04034b50), reading the
 * compression method, compressed size, and filename for each entry. For the
 * first entry whose filename ends with `.xml` it returns the decoded UTF-8
 * contents: stored entries (method 0) are read directly, deflated entries
 * (method 8) are inflated synchronously via `inflateRawSync`.
 *
 * The caller is responsible for decoding any base64 before passing the buffer.
 *
 * @param zip Raw ZIP archive bytes.
 * @returns The XML string, or `null` if the archive contains no `.xml` entry.
 */
export function extractXmlFromZip(zip: Buffer): string | null {
  let offset = 0;
  while (offset < zip.length - 30) {
    const sig = zip.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;

    const compressionMethod = zip.readUInt16LE(offset + 8);
    const compressedSize = zip.readUInt32LE(offset + 18);
    const fileNameLen = zip.readUInt16LE(offset + 26);
    const extraLen = zip.readUInt16LE(offset + 28);
    const fileName = zip.toString('utf-8', offset + 30, offset + 30 + fileNameLen);

    const dataStart = offset + 30 + fileNameLen + extraLen;

    if (fileName.endsWith('.xml')) {
      if (compressionMethod === 0) {
        return zip.toString('utf-8', dataStart, dataStart + compressedSize);
      } else if (compressionMethod === 8) {
        // Honor the documented null contract: a corrupt/truncated deflate
        // stream (or a zero-length data-descriptor entry, bit 3, whose
        // compressedSize is 0 in the local header) makes inflateRawSync throw.
        // Treat that as "no usable XML" rather than propagating the throw.
        try {
          return inflateRawSync(
            zip.subarray(dataStart, dataStart + compressedSize)
          ).toString('utf-8');
        } catch {
          return null;
        }
      }
    }

    offset = dataStart + compressedSize;
  }
  return null;
}
