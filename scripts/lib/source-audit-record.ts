import { withSubsectionAnchors } from '../../apps/web/src/lib/anchored-entry.js';
import { auditSha, type AuditWriter } from './source-audit-io.js';

export function auditBody(bytes: Buffer): string {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const envelope = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text);
  if (!envelope) throw new Error('Statute frontmatter envelope is missing');
  const body = text.slice(envelope[0].length);
  if (Buffer.byteLength(body) > 2 * 1024 ** 2) throw new Error('Audit Markdown body exceeds 2 MiB');
  return body;
}

export function auditDifference(old: Buffer | null, current: Buffer): string {
  if (old === null) return 'missing_accepted_path';
  if (old.equals(current)) return 'exact_unchanged';
  const timestamp = (value: Buffer) => value.toString('utf8').replace(/^generated_at: .+$/m, 'generated_at: <fixed>');
  if (timestamp(old) === timestamp(current)) return 'generated_timestamp_only';
  return auditBody(old) === auditBody(current) ? 'metadata_only' : 'body_changed';
}

export async function auditRendered(writer: AuditWriter, name: string, bytes: Buffer): Promise<string> {
  const body = auditBody(bytes);
  const result = await withSubsectionAnchors({ body, rendered: { html: '' } });
  if (!result.ok) throw result.error;
  const html = result.value.rendered.html;
  if (Buffer.byteLength(html) > 16 * 1024 ** 2) throw new Error('Audit HTML exceeds 16 MiB');
  await writer.write(name, html);
  return auditSha(html);
}
