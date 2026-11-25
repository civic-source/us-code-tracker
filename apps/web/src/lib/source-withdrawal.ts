import { createHash } from 'node:crypto';

const withdrawnBodies: Readonly<Record<string, string>> = {
  '19': 'cf04aa1fc998cdc29a9c104cdf8ed6c4a8a8060168e725960fb76a78791aee8c',
  '111': 'd4389429bc09fe0de204a8593059176e6b25073cb6a6c24be2280b4e01efff37',
  '1001': '761c9c6ba676a4b5dd95855ef46cbf3caefa70733fef724aad9aa351d2065898',
};

/** Withhold reproduced faulty bodies even after metadata-only publications; see ADR0002. */
export function requiresCurrentSourceFallback(options: {
  dataCommit: string; title: string; section: string; body: string;
}): boolean {
  const withdrawnDigest = withdrawnBodies[options.section];
  if (options.title !== '18' || !withdrawnDigest) return false;
  if (options.dataCommit === '7297bf86fe00c0f850e1da9df5af5a03383fea70') return true;
  const body = options.body.replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '').trim();
  return createHash('sha256').update(body).digest('hex') === withdrawnDigest;
}
