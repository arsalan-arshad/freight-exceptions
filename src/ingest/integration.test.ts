// Optional integration test against the fixtures module (written by another agent).
// Skipped automatically if src/fixtures/index.ts does not exist or does not export the expected functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { parseShipmentsCsv, parseEml, mergeShipments } from './index';

const fixturesPath = new URL('../fixtures/index.ts', import.meta.url);
const present = existsSync(fixturesPath);

test('fixtures: sample CSV parses cleanly and sample emails parse', { skip: !present && 'src/fixtures not present yet' }, async () => {
  const spec = '../fixtures/index';
  const mod = (await import(spec)) as {
    generateSampleCsv?: (now: Date) => string;
    generateSampleEmails?: (now: Date) => { id: string; raw: string }[];
  };
  if (!mod.generateSampleCsv || !mod.generateSampleEmails) {
    assert.ok(true, 'fixtures do not export the expected functions yet');
    return;
  }
  const now = new Date('2026-03-05T12:00:00Z');
  const { shipments, issues } = parseShipmentsCsv(mod.generateSampleCsv(now), { sourceName: 'sample.csv' });
  assert.ok(shipments.length > 0, 'sample CSV should contain shipments');
  const fatal = issues.filter((i) => /no reference|never closed|empty|skipped/.test(i.message));
  assert.deepEqual(fatal, [], JSON.stringify(fatal));
  const ids = new Set(shipments.map((s) => s.id));
  assert.equal(ids.size, shipments.length, 'shipment ids are unique');
  assert.deepEqual(mergeShipments(shipments, shipments).map((s) => s.id), shipments.map((s) => s.id));
  const refs = new Set(shipments.map((s) => s.reference.toUpperCase().replace(/[^A-Z0-9]/g, '')));
  for (const e of mod.generateSampleEmails(now)) {
    const parsed = parseEml(e.raw);
    assert.ok(parsed.body.length > 0, `email ${e.id} has a body`);
    const body = parsed.body.toUpperCase().replace(/[^A-Z0-9]/g, '');
    assert.ok([...refs].some((r) => body.includes(r)), `email ${e.id} mentions a reference from the sample CSV`);
  }
});
