/**
 * Regression guard for the XML entity-expansion cap (#239).
 *
 * `createUslmParser` configures fast-xml-parser with
 * `processEntities: { maxEntityCount: 128 }` to bound DTD internal entities
 * ("billion laughs" / entity-expansion DoS) on untrusted upstream XML. In
 * fast-xml-parser, `maxEntityCount` limits the number of `<!ENTITY>`
 * *definitions* permitted in the DOCTYPE; the parser throws once the limit is
 * exceeded (the object-form option also keeps the default `maxEntitySize` and
 * `maxExpandedLength` bounds on expansion size).
 *
 * The control previously had no test, so a future refactor of the parser
 * options could silently raise or remove it. This test defines more entities
 * than the cap and asserts the parse is rejected. The payload is tiny (130
 * short definitions), so if the cap were ever removed the document would parse
 * successfully under fast-xml-parser's larger default (1000) and this test
 * would fail — catching the regression with no risk of OOM.
 */
import { describe, it, expect } from 'vitest';

import { parseUslmXml } from '../parser.js';

describe('entity-expansion cap (#239)', () => {
  it('rejects a DOCTYPE that defines more entities than maxEntityCount (128)', () => {
    const entities = Array.from({ length: 130 }, (_, i) => `  <!ENTITY e${i} "x">`).join('\n');
    const bomb = `<?xml version="1.0"?>
<!DOCTYPE uscDoc [
${entities}
]>
<uscDoc>&e0;</uscDoc>`;

    const result = parseUslmXml(bomb);
    expect(result.ok).toBe(false);
  });

  it('still parses a normal USLM document (cap must not reject ordinary input)', () => {
    const normal = `<?xml version="1.0"?>
<uscDoc><title identifier="/us/usc/t1">Title 1</title></uscDoc>`;

    const result = parseUslmXml(normal);
    expect(result.ok).toBe(true);
  });
});
