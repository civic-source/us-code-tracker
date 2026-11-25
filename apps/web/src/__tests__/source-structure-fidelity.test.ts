import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { XmlToMarkdownAdapter } from '../../../../packages/transformer/src/index.js';
import witnesses from '../../../../packages/transformer/src/__tests__/fixtures/pl-119-142-structural-witnesses.json' with { type: 'json' };
import { withSubsectionAnchors } from '../lib/anchored-entry.js';

describe('verbatim official structural and inline boundaries', () => {
  for (const witness of witnesses.sections) {
    it(`preserves section ${witness.section} text, semantic lanes and continuation parents`, async () => {
      const xml = fileURLToPath(new URL(
        `../../../../packages/transformer/src/__tests__/fixtures/${witness.fixture}`, import.meta.url,
      ));
      const transformed = new XmlToMarkdownAdapter('PL 119-142').transform(readFileSync(xml, 'utf8'));
      if (!transformed.ok) throw transformed.error;
      const body = transformed.value.split('---').slice(2).join('---');
      const rendered = await withSubsectionAnchors({ body, rendered: { html: '' } });
      if (!rendered.ok) throw rendered.error;
      const temporary = mkdtempSync(join(tmpdir(), 'civic-structure-'));
      try {
        const html = join(temporary, 'page.html');
        writeFileSync(html, rendered.value.rendered.html);
        const script = fileURLToPath(new URL('../../../../scripts/python/uslm_fidelity.py', import.meta.url));
        const result = spawnSync('python3', [script, '--xml', xml, '--html', html,
          '--section', `/us/usc/t18/s${witness.section}`, '--expected-source-sha256', witness.fixtureSha256,
          '--fragment'], { encoding: 'utf8', timeout: 30_000, maxBuffer: 65_536 });
        expect(result.status, result.stderr || result.stdout).toBe(0);
        expect(JSON.parse(result.stdout) as unknown).toMatchObject({ accepted: true, html_kind: 'renderer_fragment' });
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    });
  }
});
