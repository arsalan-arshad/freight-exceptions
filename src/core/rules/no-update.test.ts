import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOW, utc, event, iso, shipment, windowEnding } from '../testkit';
import { noUpdate } from './no-update';

const run = (s = shipment(), cfg = {}) => noUpdate(s, NOW, cfg);
const silent = (lastAgo: number, extra = {}) =>
  shipment({ events: [event('picked_up', lastAgo + 500), event('in_transit', lastAgo)], deliveryWindow: windowEnding(-1000), ...extra });

test('NO-UPDATE positive: last event 8h ago', () => {
  const [c] = run(silent(500));
  assert.ok(c);
  assert.equal(c.id, 's1:NO-UPDATE');
  assert.equal(c.severity, 'low');
  assert.equal(c.title, 'No update for 8h 20m');
  assert.equal(c.facts.lastUpdateAt, utc(500));
  assert.equal(c.facts.minutesSinceLastUpdate, 500);
  assert.equal(c.facts.hoursSinceLastUpdate, 8.3);
  assert.equal(c.evidence[0]?.source, 'event');
});

test('NO-UPDATE severity: low <12h, med from 12h, high from 24h; +1 when the delivery window already ended', () => {
  assert.equal(run(silent(719))[0]?.severity, 'low');
  assert.equal(run(silent(720))[0]?.severity, 'med');
  assert.equal(run(silent(1439))[0]?.severity, 'med');
  assert.equal(run(silent(1440))[0]?.severity, 'high');
  assert.equal(run(silent(500, { deliveryWindow: windowEnding(10) }))[0]?.severity, 'med', 'low bumped to med');
  assert.equal(run(silent(800, { deliveryWindow: windowEnding(10) }))[0]?.severity, 'high', 'med bumped to high');
  assert.equal(run(silent(2000, { deliveryWindow: windowEnding(10) }))[0]?.severity, 'high', 'capped at high');
});

test('NO-UPDATE boundary: exactly 6h does not fire, one minute later does', () => {
  assert.equal(run(silent(360)).length, 0);
  assert.equal(run(silent(361)).length, 1);
});

test('NO-UPDATE negative: recent update, delivered, not picked up, no events', () => {
  assert.equal(run(silent(30)).length, 0);
  assert.equal(run(shipment({ events: [event('picked_up', 3000), event('delivered', 2900)] })).length, 0);
  assert.equal(run(shipment({ events: [event('status_update', 3000)] })).length, 0, 'pickup unknown');
  assert.equal(run(shipment({ events: [event('eta_update', 3000, { eta: iso(-100) })] })).length, 0, 'pickup unknown');
  assert.equal(run(shipment()).length, 0);
});

test('NO-UPDATE: any event type resets the clock, including eta_update', () => {
  const s = shipment({ events: [event('picked_up', 2000), event('eta_update', 60, { eta: iso(-300) })] });
  assert.equal(run(s).length, 0);
});

test('NO-UPDATE: events in the future are ignored, garbage events are skipped', () => {
  const future = shipment({ events: [event('picked_up', 600), event('in_transit', -60)] });
  const [c] = run(future);
  assert.ok(c);
  assert.equal(c.facts.minutesSinceLastUpdate, 600);
  const garbage = shipment({ events: [event('picked_up', 600), { ...event('in_transit', 0), at: 'later' }] });
  assert.equal(run(garbage)[0]?.facts.minutesSinceLastUpdate, 600);
  const allGarbage = shipment({ events: [{ ...event('picked_up', 0), at: 'nope' }] });
  assert.equal(run(allGarbage).length, 0);
});

test('NO-UPDATE: picked-up detection (departed at pickup, in_transit alone)', () => {
  assert.equal(run(shipment({ events: [event('departed', 700, { stop: 'pickup' })] })).length, 1);
  assert.equal(run(shipment({ events: [event('in_transit', 700)] })).length, 1);
  assert.equal(run(shipment({ events: [event('arrived', 700, { stop: 'pickup' })] })).length, 0, 'only arrived: not picked up');
});

test('NO-UPDATE compares instants across offsets', () => {
  const mk = (off: number, ago: number) => shipment({ events: [event('picked_up', ago + 100, { offset: off }), event('in_transit', ago, { offset: off })] });
  assert.equal(run(mk(330, 360)).length, 0);
  assert.equal(run(mk(-480, 361)).length, 1);
  assert.equal(run(mk(330, 500))[0]?.facts.lastUpdateAt, utc(500));
});

test('NO-UPDATE config override: noUpdateHours', () => {
  assert.equal(run(silent(361), { noUpdateHours: 12 }).length, 0);
  assert.equal(run(silent(721), { noUpdateHours: 12 }).length, 1);
  assert.equal(run(silent(60), { noUpdateHours: 0.5 }).length, 1);
  assert.equal(run(silent(1440), { noUpdateHours: 24 }).length, 0);
});

test('NO-UPDATE display facts: overdueText matches the headline', () => {
  const [c] = run(silent(500));
  assert.equal(c?.facts.overdueText, '8h 20m');
  assert.ok(c?.title.includes('8h 20m'));
});
