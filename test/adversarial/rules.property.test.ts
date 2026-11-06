// ADVERSARIAL (properties that HOLD today): determinism and robustness of the rule engine. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { evaluateShipments } from '../../src/core/index';
import { toCents, formatCents } from '../../src/core/format';
import type { Shipment, StatusEvent } from '../../src/core/types';

const NOW = new Date('2026-11-06T15:00:00Z');
const S = (over: Partial<Shipment> = {}): Shipment => ({ id: 's1', reference: 'REF-1', carrier: 'Example Carrier LLC', events: [], documents: [], ...over });
const ev = (id: string, type: StatusEvent['type'], at: string, extra: Partial<StatusEvent> = {}): StatusEvent => ({ id, type, at, source: { kind: 'manual', ref: id }, ...extra });
function lcg(seed: number) { let s = seed >>> 0 || 1; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32; }
function shuffle<T>(a: readonly T[], r: () => number): T[] { const o = [...a]; for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [o[i], o[j]] = [o[j]!, o[i]!]; } return o; }

const rich = (): Shipment => S({
  pickupWindow: { start: '2026-11-04T08:00:00-05:00', end: '2026-11-04T12:00:00-05:00' },
  deliveryWindow: { start: '2026-11-05T08:00:00-05:00', end: '2026-11-05T12:00:00-05:00' },
  agreedRate: { amount: 1250, currency: 'USD' },
  events: [
    ev('a1', 'arrived', '2026-11-04T13:00:00-05:00', { stop: 'pickup' }), ev('d1', 'departed', '2026-11-04T17:30:00-05:00', { stop: 'pickup' }),
    ev('t1', 'in_transit', '2026-11-04T18:00:00-05:00'), ev('e1', 'eta_update', '2026-11-05T09:00:00-05:00', { eta: '2026-11-05T20:00:00-05:00', stop: 'delivery' }),
    ev('dl', 'delivered', '2026-11-05T21:00:00-05:00', { stop: 'delivery' }),
  ],
  documents: [{ id: 'i1', kind: 'invoice', receivedAt: '2026-11-06T08:00:00-05:00', amount: { amount: 1350, currency: 'USD' }, source: { kind: 'manual', ref: 'i1' } }],
});

test('shuffling events/documents/shipments and duplicating events never changes the cases', () => {
  const base = rich();
  const expected = JSON.stringify(evaluateShipments([base, S({ id: 's2', reference: 'REF-2', pickupWindow: { start: '2026-11-04T08:00:00Z', end: '2026-11-04T09:00:00Z' } })], NOW));
  assert.ok(JSON.parse(expected).length >= 3);
  const r = lcg(7);
  for (let i = 0; i < 100; i++) {
    const b = rich();
    b.events = shuffle([...b.events, ...b.events.slice(0, 2)], r); // duplicates by id
    b.documents = shuffle([...b.documents, ...b.documents], r);
    const other = S({ id: 's2', reference: 'REF-2', pickupWindow: { start: '2026-11-04T08:00:00Z', end: '2026-11-04T09:00:00Z' } });
    assert.equal(JSON.stringify(evaluateShipments(shuffle([b, other], r), NOW)), expected);
  }
});

test('the same instant written in different offsets yields the same case ids, rules and severities', () => {
  const mk = (off: string, h: number) => S({ deliveryWindow: { start: `2026-11-05T${String(h - 4).padStart(2, '0')}:00:00${off}`, end: `2026-11-05T${String(h).padStart(2, '0')}:00:00${off}` } });
  const a = evaluateShipments([mk('Z', 12)], NOW);
  const b = evaluateShipments([mk('+05:30', 17)].map((s) => ({ ...s, deliveryWindow: { start: '2026-11-05T13:30:00+05:30', end: '2026-11-05T17:30:00+05:30' } })), NOW);
  const c = evaluateShipments([S({ deliveryWindow: { start: '2026-11-05T03:00:00-05:00', end: '2026-11-05T07:00:00-05:00' } })], NOW);
  const key = (x: ReturnType<typeof evaluateShipments>) => x.map((k) => [k.id, k.ruleId, k.severity, k.title].join('|'));
  assert.deepEqual(key(a), key(b));
  assert.deepEqual(key(a), key(c));
  assert.equal(a.length, 1);
});

test('thresholds are strict: exactly at the threshold does not fire, one millisecond over does', () => {
  const win = (msBefore: number) => ({ start: '2026-11-06T00:00:00Z', end: new Date(NOW.getTime() - msBefore).toISOString() });
  assert.equal(evaluateShipments([S({ deliveryWindow: win(0) })], NOW).length, 0); // lateDeliveryGraceHours = 0, now == end
  assert.equal(evaluateShipments([S({ deliveryWindow: win(1) })], NOW).length, 1);
  const pu = (ms: number) => S({ pickupWindow: { start: '2026-11-05T00:00:00Z', end: new Date(NOW.getTime() - 2 * 3_600_000 - ms).toISOString() } });
  assert.equal(evaluateShipments([pu(0)], NOW).length, 0);
  assert.equal(evaluateShipments([pu(1)], NOW).length, 1);
});

test('DST boundaries and leap day: offsets are taken literally, instants compare correctly', () => {
  // US DST ends 2026-11-01 02:00 local. 01:30-04:00 and 01:30-05:00 are two different instants one hour apart.
  const now = new Date('2026-11-01T08:00:00Z');
  const first = S({ deliveryWindow: { start: '2026-11-01T00:00:00-04:00', end: '2026-11-01T01:30:00-04:00' } }); // 05:30Z
  const second = S({ id: 's2', reference: 'R2', deliveryWindow: { start: '2026-11-01T00:00:00-04:00', end: '2026-11-01T01:30:00-05:00' } }); // 06:30Z
  const out = evaluateShipments([first, second], now);
  assert.deepEqual(out.map((o) => o.shipmentId).sort(), ['s1', 's2']);
  const leap = S({ deliveryWindow: { start: '2028-02-28T00:00:00Z', end: '2028-02-29T12:00:00Z' } });
  assert.equal(evaluateShipments([leap], new Date('2028-02-29T13:00:00Z')).length, 1);
  const bogus = S({ deliveryWindow: { start: '2027-02-28T00:00:00Z', end: '2027-02-29T12:00:00Z' } }); // 2027 is not a leap year
  assert.equal(evaluateShipments([bogus], new Date('2030-01-01T00:00:00Z')).length, 0);
});

test('missing / garbage inputs produce no case and never throw', () => {
  const junk: unknown[] = [
    S(), S({ pickupWindow: { start: 'x', end: 'y' } }), S({ deliveryWindow: { start: '2026-11-05T12:00:00Z', end: '2026-11-05T10:00:00Z' } }),
    S({ events: [null, 5, { type: 'delivered' }, { id: 'x', type: 'delivered', at: '2026-11-05T10:00:00' }] as never }),
    S({ agreedRate: { amount: NaN, currency: 'USD' }, documents: [{ id: 'i', kind: 'invoice', receivedAt: '2026-11-05T10:00:00Z', amount: { amount: 5, currency: 'USD' }, source: { kind: 'manual', ref: 'i' } }] }),
    null, undefined, 'str', 7, { id: 5 }, { id: 'ok', events: 'no', documents: 3 },
  ];
  assert.doesNotThrow(() => evaluateShipments(junk as never, NOW));
  assert.equal(evaluateShipments(junk as never, NOW).length, 0);
  assert.deepEqual(evaluateShipments(rich() as never, NOW), []);
  assert.deepEqual(evaluateShipments([rich()], new Date(NaN)), []);
});

test('NaN / Infinity / negative / wrong-typed config values fall back to defaults or disable, without throwing', () => {
  const sh = [rich()];
  const base = JSON.stringify(evaluateShipments(sh, NOW));
  for (const bad of [{ noPodHours: NaN }, { noPodHours: -1 }, { lateDeliveryGraceHours: '5' }, { rateToleranceAmount: -100 }, { defaultFreeTimeMinutes: undefined }] as never[]) {
    assert.equal(JSON.stringify(evaluateShipments(sh, NOW, bad)), base);
  }
  assert.doesNotThrow(() => evaluateShipments(sh, NOW, { rateToleranceAmount: Infinity, noUpdateHours: Infinity } as never));
  assert.equal(evaluateShipments(sh, NOW, { rateToleranceAmount: Infinity }).some((x) => x.ruleId === 'RATE-MISMATCH'), false);
  assert.doesNotThrow(() => evaluateShipments(sh, NOW, null as never));
});

test('money is compared in cents: 0.1+0.2 noise cannot flip a result', () => {
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents(1.005), 101);
  assert.equal(formatCents(toCents(1250.1 + 0.2), 'USD'), '1,250.30 USD');
  const mk = (invoice: number) => S({ agreedRate: { amount: 100.1, currency: 'USD' }, documents: [{ id: 'i', kind: 'invoice', receivedAt: '2026-11-05T10:00:00Z', amount: { amount: invoice, currency: 'USD' }, source: { kind: 'manual', ref: 'i' } }] });
  assert.equal(evaluateShipments([mk(100.1 + 0.2 - 0.2)], NOW).length, 0);
  assert.equal(evaluateShipments([mk(100.1 + 0.5)], NOW).length, 0); // exactly the 0.50 tolerance
  assert.equal(evaluateShipments([mk(100.1 + 0.51)], NOW).length, 1);
});

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) { const p = join(dir, n); statSync(p).isDirectory() ? walk(p, out) : out.push(p); }
  return out;
}
test('INVARIANT: src/core (the only place exceptions are decided) imports nothing from ai, ingest, db or app', () => {
  const files = walk('src/core').filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f) && !f.endsWith('testkit.ts'));
  assert.ok(files.length > 8);
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/from\s+'([^']+)'/g)) {
      const spec = m[1]!;
      assert.ok(spec.startsWith('.'), `${f} imports package ${spec}`);
      const resolved = resolve(dirname(f), spec);
      assert.ok(resolved.startsWith(resolve('src/core')), `${f} imports ${spec}, outside src/core`);
    }
    assert.ok(!/LlmClient|\bllm\b|fetch\(/i.test(text), `${f} mentions a model`);
  }
});
