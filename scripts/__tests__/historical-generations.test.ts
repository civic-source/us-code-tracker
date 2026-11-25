import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import original from '../../data/olrc-history-pilot/materializations.json' with { type: 'json' };
import { parseHistoricalGenerations } from '../lib/historical-qualification.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const originalRecipe = original.records[0]!.version.sourceQualification.recipeSha256;
const newRecipe = 'b'.repeat(64);

// Synthetic second-generation controls exercise registry admission, not publisher qualification.
function fixture() {
  const files = new Map<string, string>();
  const generations = [originalRecipe, newRecipe].map((recipeSha256, index) => {
    const directory = index === 0 ? '' : `generations/${recipeSha256}/`;
    const rows = structuredClone(original.records);
    if (index) for (const row of rows) {
      row.version.sourceQualification.recipeSha256 = recipeSha256;
      row.version.provisionVersionId = `pv-olrc-pilot-${hash(JSON.stringify(row.version.sourceQualification))}`;
      row.recordSha256 = hash(JSON.stringify(row.version));
    }
    const materializations = JSON.stringify({ schemaVersion: original.schemaVersion, records: rows });
    const qualification = JSON.stringify({ schemaVersion: 'usct.reviewed-history-materializations/v1',
      records: rows.map(({ version, recordSha256 }) => ({ provisionVersionId: version.provisionVersionId,
        recordSha256, sourceQualification: version.sourceQualification })) });
    files.set(`${directory}materializations.json`, materializations);
    files.set(`${directory}qualification.json`, qualification);
    for (const { version } of rows) {
      const proof = version.sourceQualification;
      files.set(`${directory}witnesses/${proof.releaseId}-${version.uscSection}-witness.json`,
        readFileSync(`data/olrc-history-pilot/witnesses/${proof.releaseId}-${version.uscSection}-witness.json`, 'utf8'));
    }
    return { recipeSha256, materializationsSha256: hash(materializations), qualificationSha256: hash(qualification) };
  });
  return { registry: { schemaVersion: 'usct.historical-generations/v1', generations,
    active: { 'pl-119-73': newRecipe, 'pl-119-142': newRecipe } }, files };
}

function admit(value: ReturnType<typeof fixture>) {
  return parseHistoricalGenerations(value.registry, path => {
    const bytes = value.files.get(path);
    if (bytes === undefined) throw new Error('Missing reviewed file');
    return bytes;
  });
}

describe('reviewed historical generation registry', () => {
  it('retains the exact original six rows beside a separately selected six-row generation', () => {
    const result = admit(fixture());
    expect(result.generations).toHaveLength(2);
    expect(result.generations[0]!.versions).toEqual(original.records.map(row => row.version));
    expect(result.generations[1]!.versions).toHaveLength(6);
    expect(result.active['pl-119-73']).toBe(newRecipe);
  });

  it('rejects duplicate/unknown generations and ambiguous publisher selection', () => {
    const duplicate = fixture(); duplicate.registry.generations.push(duplicate.registry.generations[0]!);
    expect(() => admit(duplicate)).toThrow();
    const unknown = fixture(); unknown.registry.active['pl-119-73'] = 'c'.repeat(64);
    expect(() => admit(unknown)).toThrow();
    const extra = fixture(); Object.assign(extra.registry.active, { 'pl-119-999': newRecipe });
    expect(() => admit(extra)).toThrow();
  });

  it('refuses missing/corrupt transport and proof bytes without altering retained inputs', () => {
    for (const path of ['materializations.json', 'qualification.json', 'witnesses/pl-119-73-111-witness.json']) {
      const value = fixture(); value.files.set(path, value.files.get(path)! + 'x');
      expect(() => admit(value)).toThrow();
    }
  });

  it('rejects a re-signed mixed-generation record even with self-consistent transport digests', () => {
    const value = fixture(); const name = `generations/${newRecipe}/materializations.json`;
    const body = JSON.parse(value.files.get(name)!) as typeof original;
    body.records[0]!.version.sourceQualification.recipeSha256 = originalRecipe;
    const raw = JSON.stringify(body); value.files.set(name, raw);
    value.registry.generations[1]!.materializationsSha256 = hash(raw);
    expect(() => admit(value)).toThrow();
  });
});
