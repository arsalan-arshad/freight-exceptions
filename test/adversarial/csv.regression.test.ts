// DEFECT TESTS (fail today): data-integrity edge cases in CSV ingest. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShipmentsCsv } from '../../src/ingest/index';

test('DEFECT-23 (Medium): distinct references that differ only by punctuation placement are merged into ONE shipment', () => {
  const r = parseShipmentsCsv('reference,carrier,delivery_start,delivery_end\nLD-12-34,Carrier A,2026-03-01T08:00:00Z,2026-03-01T12:00:00Z\nLD-1-234,Carrier B,2026-03-02T08:00:00Z,2026-03-02T12:00:00Z\n');
  assert.equal(r.shipments.length, 2, 'LD-12-34 and LD-1-234 are different loads; merging hides the second one\'s exceptions');
});

test('DEFECT-24 (Low): "1,250 EUR" is read as 1250 although "1.250" is rejected as ambiguous (EU decimal comma => 1.25)', () => {
  const r = parseShipmentsCsv('reference;agreed_rate\nLD-1;1,250 EUR\n');
  assert.equal(r.shipments[0]?.agreedRate, undefined, 'an ambiguous thousands/decimal separator must be rejected, not guessed');
});

test('DEFECT-25 (Low): any three-letter word in a money cell becomes the currency ("ABC 1250" => ABC)', () => {
  const r = parseShipmentsCsv('reference,agreed_rate\nLD-1,fee 1250\n');
  assert.notEqual(r.shipments[0]?.agreedRate?.currency, 'FEE');
});
