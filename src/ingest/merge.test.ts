import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Shipment } from '../core/types';
import { mergeShipments } from './index';

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}
const src = { kind: 'csv' as const, ref: 'x.csv:row 1' };

const a: Shipment = {
  id: 'ld-1001',
  reference: 'LD-1001',
  carrier: 'Example Carrier LLC',
  events: [{ id: 'ld-1001:picked_up', type: 'picked_up', at: '2026-03-04T09:00:00Z', stop: 'pickup', source: src }],
  documents: [],
};
const b: Shipment = {
  id: 'ld1001',
  reference: 'ld 1001',
  carrier: 'Other Name',
  customer: 'Acme Freight',
  agreedRate: { amount: 100, currency: 'USD' },
  events: [
    { id: 'ld1001:picked_up', type: 'picked_up', at: '2026-03-04T11:00:00Z', stop: 'pickup', source: src },
    { id: 'ld1001:delivered', type: 'delivered', at: '2026-03-05T09:00:00Z', stop: 'delivery', source: src },
  ],
  documents: [{ id: 'ld1001:pod', kind: 'pod', receivedAt: '2026-03-06T09:00:00Z', source: src }],
};

test('merges by normalised reference; older value wins, newer only fills gaps; ids re-keyed and deduped', () => {
  const out = mergeShipments(deepFreeze([a]), deepFreeze([b]));
  assert.equal(out.length, 1);
  const s = out[0]!;
  assert.equal(s.id, 'ld-1001');
  assert.equal(s.reference, 'LD-1001');
  assert.equal(s.carrier, 'Example Carrier LLC');
  assert.equal(s.customer, 'Acme Freight');
  assert.deepEqual(s.agreedRate, { amount: 100, currency: 'USD' });
  assert.deepEqual(s.events.map((e) => e.id), ['ld-1001:picked_up', 'ld-1001:delivered']);
  assert.equal(s.events[0]!.at, '2026-03-04T09:00:00Z');
  assert.deepEqual(s.documents.map((d) => d.id), ['ld-1001:pod']);
});

test('union keeps non-matching shipments in order: a first, then b-only', () => {
  const c: Shipment = { id: 'zz', reference: 'ZZ-1', events: [], documents: [] };
  const d: Shipment = { id: 'aa', reference: 'AA-1', events: [], documents: [] };
  const out = mergeShipments([c], [d, { ...a }]);
  assert.deepEqual(out.map((s) => s.reference), ['ZZ-1', 'AA-1', 'LD-1001']);
});

test('deterministic, and events are ordered by instant even across offsets', () => {
  const x: Shipment = {
    id: 'q',
    reference: 'Q-1',
    events: [
      { id: 'q:2', type: 'status_update', at: '2026-03-04T10:00:00-05:00', source: src }, // 15:00Z
      { id: 'q:1', type: 'status_update', at: '2026-03-04T12:00:00Z', source: src },
    ],
    documents: [],
  };
  const o1 = mergeShipments([x], []);
  const o2 = mergeShipments([x], []);
  assert.deepEqual(o1, o2);
  assert.deepEqual(o1[0]!.events.map((e) => e.id), ['q:1', 'q:2']);
});

test('same event id with different content: first kept; duplicates inside one list are folded', () => {
  const dupA: Shipment = { ...a, events: [{ ...a.events[0]!, at: '2026-03-04T09:00:00Z' }] };
  const dupB: Shipment = { ...a, events: [{ ...a.events[0]!, at: '2026-03-04T23:00:00Z' }] };
  const out = mergeShipments([dupA, dupB], []);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.events[0]!.at, '2026-03-04T09:00:00Z');
});

test('shipments with an unusable reference are never merged together', () => {
  const x: Shipment = { id: 'x1', reference: '---', events: [], documents: [] };
  const y: Shipment = { id: 'x2', reference: '???', events: [], documents: [] };
  assert.equal(mergeShipments([x], [y]).length, 2);
});

test('empty inputs', () => {
  assert.deepEqual(mergeShipments([], []), []);
  assert.equal(mergeShipments([a], []).length, 1);
  assert.equal(mergeShipments([], [a]).length, 1);
});
