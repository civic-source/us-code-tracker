import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractArchiveMember } from '../lib/olrc-archive-member.js';
const exec = promisify(execFile); const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });
const pin = (value: Buffer) => ({ sha256: createHash('sha256').update(value).digest('hex'), byteLength: value.length });

it('extracts an exact pinned member from a streaming ZIP data-descriptor entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'olrc-member-')); roots.push(root); const archive = join(root, 'source.zip');
  await exec('python3', ['-c', `import io,sys,zipfile
class Streaming(io.BytesIO):
 def seekable(self): return False
 def seek(self,*a): raise io.UnsupportedOperation()
b=Streaming()
with zipfile.ZipFile(b,'w',compression=zipfile.ZIP_DEFLATED) as z:z.writestr('usc18.xml',b'<uscDoc/>')
open(sys.argv[1],'wb').write(b.getvalue())`, archive]);
  const bytes = await readFile(archive);
  expect(bytes.readUInt16LE(6) & 8).toBe(8);
  const result = await extractArchiveMember({ archivePath: archive, archivePin: pin(bytes),
    memberPin: { name: 'usc18.xml', ...pin(Buffer.from('<uscDoc/>')) } });
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  expect(result.value.toString()).toBe('<uscDoc/>');
});
