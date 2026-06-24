import { describe, expect, it } from 'vitest';

import { titleXmlUrl } from '../constants.js';

describe('titleXmlUrl', () => {
  it('zero-pads a single-digit numeric title', () => {
    expect(titleXmlUrl('119', '99', '1')).toContain('xml_usc01@119-99.zip');
  });

  it('leaves a two-digit numeric title unchanged', () => {
    expect(titleXmlUrl('119', '99', '18')).toContain('xml_usc18@119-99.zip');
  });

  it('zero-pads the numeric run of a single-digit letter-suffixed title', () => {
    // OLRC serves the suffixed appendix title as xml_usc05a (padded numeric
    // run), not xml_usc5a. padStart(2) on "5a" is a no-op, so the numeric run
    // must be padded explicitly.
    expect(titleXmlUrl('118', '200', '5a')).toContain('xml_usc05a@118-200.zip');
  });

  it('leaves an already-padded letter-suffixed title unchanged', () => {
    expect(titleXmlUrl('118', '200', '05a')).toContain('xml_usc05a@118-200.zip');
  });
});
