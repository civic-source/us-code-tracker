import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { extractArchiveMember } from './olrc-archive-member.js';
import { err, ok, type Result } from '@civic-source/types';
import pins from '../../data/olrc-history-pilot/source-pins.json' with { type: 'json' };
import { readSourceBlob } from './olrc-source-cache.js';

export const historicalSourcePins = pins.sources;
export type HistoricalSourcePin = typeof pins.sources[number];
export interface PinnedOlrcEdition { source: HistoricalSourcePin; xml: string; archivePath: string }

/** Publisher bytes must match the independently acquired archive and member pins. */
export async function readPinnedOlrcEdition(options: {
  cacheDir: string; releaseId: string;
}): Promise<Result<PinnedOlrcEdition>> {
  const source = historicalSourcePins.find((item) => item.releaseId === options.releaseId);
  if (!source) return err(new Error('This historical edition has no independently retained source pin'));
  const archive = await readSourceBlob({ cacheDir: options.cacheDir, pin: source.archive });
  if (!archive.ok) return archive;
  const extracted = await extractArchiveMember({ archivePath: join(options.cacheDir, source.archive.sha256),
    archivePin: source.archive, memberPin: source.member });
  if (!extracted.ok) return extracted;
  const xml = extracted.value.toString('utf8');
  if (xml === null || Buffer.byteLength(xml) !== source.member.byteLength ||
    createHash('sha256').update(xml).digest('hex') !== source.member.sha256) {
    return err(new Error('Historical source member digest or size mismatch'));
  }
  if (!xml.includes(`xmlns="${source.namespace}"`) ||
    !xml.includes(`<docPublicationName>${source.publisherEdition}</docPublicationName>`)) {
    return err(new Error('Historical source namespace or publisher edition identity mismatch'));
  }
  return ok({ source, xml, archivePath: join(options.cacheDir, source.archive.sha256) });
}
