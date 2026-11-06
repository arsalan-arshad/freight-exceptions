import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOW, utc, doc, event, iso, shipment } from '../testkit';
import { noPod } from './no-pod';

const run = (s = shipment(), cfg = {}) => noPod(s, NOW, cfg);
const deliveredAgo = (m: number, docs = [] as ReturnType<typeof doc>[], extraEvents = [] as ReturnType<typeof event>[]) =>
  shipment({ events: [event('picked_up', m + 1000), event('delivered', m), ...extraEvents], documents: docs });

test('NO-POD positive: delivered 30h ago with no POD', () => {
  const [c] = run(deliveredAgo(1800));
  assert.ok(c);
  assert.equal(c.id, 's1:NO-POD');
  assert.equal(c.severity, 'low');
  assert.equal(c.title, 'No POD 30h after delivery');
  assert.equal(c.facts.deliveredAt, utc(1800));
  assert.equal(c.facts.hoursSinceDelivered, 30);
  assert.equal(c.facts.minutesSinceDelivered, 1800);
  assert.equal(c.facts.noPodThresholdHours, 24);
  assert.equal(c.evidence[0]?.source, 'event');
  assert.ok(c.suggestedNextStep.toLowerCase().includes('proof of delivery'));
});

test('NO-POD severity: low <48h, med from 48h, high from 72h', () => {
  assert.equal(run(deliveredAgo(2879))[0]?.severity, 'low');
  assert.equal(run(deliveredAgo(2880))[0]?.severity, 'med');
  assert.equal(run(deliveredAgo(4319))[0]?.severity, 'med');
  assert.equal(run(deliveredAgo(4320))[0]?.severity, 'high');
});

test('NO-POD boundary: exactly 24h does not fire, one minute later does', () => {
  assert.equal(run(deliveredAgo(1440)).length, 0);
  assert.equal(run(deliveredAgo(1441)).length, 1);
});

test('NO-POD negative: POD present (any receivedAt, even garbage); not delivered', () => {
  assert.equal(run(deliveredAgo(3000, [doc('pod', 2900)])).length, 0);
  assert.equal(run(deliveredAgo(3000, [doc('pod', 0, { receivedAt: 'yesterday-ish' })])).length, 0);
  assert.equal(run(shipment({ events: [event('picked_up', 3000)] })).length, 0);
});

test('NO-POD: other document kinds do not count as a POD; a POD dated in the future does not either', () => {
  assert.equal(run(deliveredAgo(3000, [doc('bol', 100), doc('invoice', 100)])).length, 1);
  assert.equal(run(deliveredAgo(3000, [doc('pod', -60)])).length, 1);
});

test('NO-POD missing/garbage delivered time: does not fire', () => {
  assert.equal(run(shipment({ events: [{ ...event('delivered', 0), at: 'garbage' }] })).length, 0);
  assert.equal(run(shipment({ events: [{ ...event('delivered', 0), at: '2026-11-04T10:00:00' }] })).length, 0);
  assert.equal(run(shipment({ events: [event('delivered', -120)] })).length, 0, 'future delivered');
});

test('NO-POD uses the earliest delivered event (a re-report must not postpone the clock)', () => {
  const s = deliveredAgo(1800, [], [event('delivered', 100, { id: 'again' })]);
  assert.equal(run(s)[0]?.facts.minutesSinceDelivered, 1800);
});

test('NO-POD compares instants across offsets', () => {
  const mk = (off: number) =>
    shipment({ events: [event('delivered', 1500, { offset: off })] });
  const base = run(mk(0))[0];
  assert.ok(base);
  for (const off of [330, -480, 60]) {
    const c = run(mk(off))[0];
    assert.ok(c);
    assert.equal(c.severity, base.severity);
    assert.equal(c.title, base.title);
    assert.equal(c.facts.deliveredAt, utc(1500));
  }
  assert.equal(run(shipment({ events: [event('delivered', 1440, { offset: 330 })] })).length, 0);
  assert.equal(run(shipment({ events: [event('delivered', 1441, { offset: -480 })] })).length, 1);
});

test('NO-POD config override: noPodHours', () => {
  assert.equal(run(deliveredAgo(1440), { noPodHours: 12 }).length, 1);
  assert.equal(run(deliveredAgo(720), { noPodHours: 12 }).length, 0);
  assert.equal(run(deliveredAgo(721), { noPodHours: 12 }).length, 1);
  assert.equal(run(deliveredAgo(1800), { noPodHours: 48 }).length, 0);
  // severity scales with the configured threshold: 12h threshold, 40h => ratio 3.3 => high
  assert.equal(run(deliveredAgo(2400), { noPodHours: 12 })[0]?.severity, 'high');
});

test('NO-POD display facts: overdueText matches the headline, time is UTC', () => {
  const [c] = run(deliveredAgo(4860));
  assert.ok(c);
  assert.equal(c.facts.overdueText, '3d 9h');
  assert.equal(c.title, 'No POD 3d 9h after delivery');
});
