import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Shipment } from '../core/types';
import { applyExtraction } from './index';
import type { ExtractionResult } from './index';

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

const ship = (reference: string, id = reference.toLowerCase()): Shipment => ({ id, reference, carrier: 'Example Carrier LLC', events: [], documents: [] });
const SRC = { kind: 'email' as const, ref: 'email:msg-0007' };
const RECV = '2026-03-05T18:00:00Z';

const result = (...items: Array<[string, string | number | boolean, string]>): ExtractionResult => ({
  accepted: items.map(([field, value, quote]) => ({ field: field as never, value, quote })),
  rejected: [],
  needsReview: false,
});

test('matches by normalised reference and builds events/docs with email sources and stable ids', () => {
  const existing = deepFreeze([ship('LD-1001', 'ld-1001'), ship('LD-1002', 'ld-1002')]);
  const res = deepFreeze(
    result(
      ['reference', 'ld 1001', 'Load ld 1001'],
      ['deliveredAt', '2026-03-05T17:50:00Z', 'Delivered 2026-03-05 12:50 EST'],
      ['arrivedAt', '2026-03-05T16:00:00Z', 'arrived at the delivery dock 11:00 EST'],
      ['departedAt', '2026-03-05T17:00:00Z', 'left at 12:00 EST'],
      ['eta', '2026-03-06T20:30:00Z', 'New ETA is March 6 2:30 PM CST'],
      ['podAttached', true, 'Signed POD attached.'],
      ['invoiceAmount', 1250, 'Invoice total: USD 1,250.00'],
      ['invoiceCurrency', 'USD', 'Invoice total: USD 1,250.00'],
    ),
  );
  const out = applyExtraction(existing, res, SRC, { receivedAt: RECV });
  assert.equal(out.unmatched, false);
  assert.equal(out.matchedReference, 'LD-1001');
  const s = out.shipments.find((x) => x.id === 'ld-1001')!;
  assert.deepEqual(
    s.events.map((e) => e.id).sort(),
    ['ld-1001:email:msg-0007:arrivedAt', 'ld-1001:email:msg-0007:deliveredAt', 'ld-1001:email:msg-0007:departedAt', 'ld-1001:email:msg-0007:eta'],
  );
  const delivered = s.events.find((e) => e.type === 'delivered')!;
  assert.equal(delivered.at, '2026-03-05T17:50:00Z');
  assert.equal(delivered.stop, 'delivery');
  assert.deepEqual(delivered.source, { kind: 'email', ref: 'email:msg-0007', excerpt: 'Delivered 2026-03-05 12:50 EST' });
  const arrived = s.events.find((e) => e.type === 'arrived')!;
  assert.equal(arrived.stop, 'delivery'); // quote says "delivery dock"
  const departed = s.events.find((e) => e.type === 'departed')!;
  assert.equal(departed.stop, undefined); // quote does not say; never guessed
  const eta = s.events.find((e) => e.type === 'eta_update')!;
  assert.equal(eta.eta, '2026-03-06T20:30:00Z');
  assert.equal(eta.at, RECV);
  assert.deepEqual(s.documents.map((d) => d.id).sort(), ['ld-1001:email:msg-0007:invoice', 'ld-1001:email:msg-0007:pod']);
  assert.deepEqual(s.documents.find((d) => d.kind === 'invoice')!.amount, { amount: 1250, currency: 'USD' });
  assert.equal(s.documents.find((d) => d.kind === 'pod')!.receivedAt, RECV);
  assert.equal(out.shipments.find((x) => x.id === 'ld-1002')!.events.length, 0);
  assert.ok(out.notes.some((n) => /departedAt: quote does not say/.test(n)));
  assert.ok(out.notes.some((n) => /carrier/.test(n)) === false);
});

test('inputs are never mutated (deep-frozen inputs do not throw) and output is independent', () => {
  const existing = deepFreeze([ship('LD-1001')]);
  const res = deepFreeze(result(['reference', 'LD-1001', 'Load LD-1001'], ['pickedUpAt', '2026-03-05T14:00:00Z', 'picked up 09:00 EST']));
  const out = applyExtraction(existing, res, SRC);
  assert.equal(existing[0]!.events.length, 0);
  assert.equal(out.shipments[0]!.events.length, 1);
  assert.equal(out.shipments[0]!.events[0]!.stop, 'pickup');
  assert.notEqual(out.shipments[0], existing[0]);
});

test('unmatched reference: no shipment is created', () => {
  const existing = [ship('LD-1001')];
  const out = applyExtraction(existing, result(['reference', 'LD-9999', 'Load LD-9999'], ['deliveredAt', '2026-03-05T17:50:00Z', 'Delivered']), SRC);
  assert.equal(out.unmatched, true);
  assert.equal(out.matchedReference, undefined);
  assert.equal(out.shipments.length, 1);
  assert.equal(out.shipments[0]!.events.length, 0);
});

test('no accepted reference, or an ambiguous one, applies nothing', () => {
  const none = applyExtraction([ship('LD-1001')], result(['deliveredAt', '2026-03-05T17:50:00Z', 'Delivered']), SRC);
  assert.equal(none.unmatched, true);
  const dup = applyExtraction([ship('LD-1001', 'a'), ship('ld 1001', 'b')], result(['reference', 'LD-1001', 'Load LD-1001'], ['deliveredAt', '2026-03-05T17:50:00Z', 'Delivered']), SRC);
  assert.equal(dup.unmatched, true);
  assert.ok(dup.shipments.every((s) => s.events.length === 0));
});

test('applying the same email twice is idempotent', () => {
  const res = result(['reference', 'LD-1001', 'Load LD-1001'], ['deliveredAt', '2026-03-05T17:50:00Z', 'Delivered 12:50 EST'], ['podAttached', true, 'POD attached']);
  const once = applyExtraction([ship('LD-1001')], res, SRC, { receivedAt: RECV });
  const twice = applyExtraction(once.shipments, res, SRC, { receivedAt: RECV });
  assert.deepEqual(twice.shipments, once.shipments);
  assert.ok(twice.notes.some((n) => /already present/.test(n)));
});

test('missing receivedAt: eta falls back to latest other time, else is skipped; pod and invoice are skipped with notes', () => {
  const withOther = applyExtraction(
    [ship('LD-1001')],
    result(['reference', 'LD-1001', 'Load LD-1001'], ['deliveredAt', '2026-03-05T17:50:00Z', 'Delivered'], ['eta', '2026-03-06T20:30:00Z', 'ETA']),
    SRC,
  );
  assert.equal(withOther.shipments[0]!.events.find((e) => e.type === 'eta_update')!.at, '2026-03-05T17:50:00Z');
  const alone = applyExtraction(
    [ship('LD-1001')],
    result(['reference', 'LD-1001', 'Load LD-1001'], ['eta', '2026-03-06T20:30:00Z', 'ETA'], ['podAttached', true, 'POD attached'], ['invoiceAmount', 10, 'USD 10.00'], ['invoiceCurrency', 'USD', 'USD 10.00']),
    SRC,
  );
  assert.equal(alone.shipments[0]!.events.length, 0);
  assert.equal(alone.shipments[0]!.documents.length, 0);
  assert.equal(alone.notes.filter((n) => /receivedAt/.test(n)).length, 3);
});

test('invoice amount without an accepted currency is not applied (currency is never guessed)', () => {
  const out = applyExtraction([ship('LD-1001')], result(['reference', 'LD-1001', 'Load LD-1001'], ['invoiceAmount', 1250, 'total $1,250.00']), SRC, { receivedAt: RECV });
  assert.equal(out.shipments[0]!.documents.length, 0);
  assert.ok(out.notes.some((n) => /no accepted invoiceCurrency/.test(n)));
});
