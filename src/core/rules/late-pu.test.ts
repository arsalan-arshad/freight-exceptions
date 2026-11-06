import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOW, utc, event, iso, shipment, windowEnding } from '../testkit';
import { latePickup } from './late-pu';

const run = (s = shipment(), cfg = {}) => latePickup(s, NOW, cfg);

test('LATE-PU positive: window ended 5h ago, no pickup', () => {
  const [c, ...rest] = run(shipment({ pickupWindow: windowEnding(300) }));
  assert.equal(rest.length, 0);
  assert.ok(c);
  assert.equal(c.id, 's1:LATE-PU');
  assert.equal(c.ruleId, 'LATE-PU');
  assert.equal(c.severity, 'high');
  assert.equal(c.status, 'open');
  assert.equal(c.detectedAt, NOW.toISOString());
  assert.equal(c.title, 'Pickup 5h overdue');
  assert.equal(c.facts.reference, 'REF-1');
  assert.equal(c.facts.carrier, 'Example Carrier LLC');
  assert.equal(c.facts.customer, 'Acme Foods');
  assert.equal(c.facts.minutesOverdue, 300);
  assert.equal(c.facts.hoursOverdue, 5);
  assert.equal(c.facts.pickupWindowEnd, utc(300));
  assert.ok(c.evidence.length >= 1);
  assert.ok(c.suggestedNextStep.length > 0);
  assert.ok(c.summary.includes('REF-1'));
});

test('LATE-PU severity: med under 4h past the window end, high from 4h', () => {
  assert.equal(run(shipment({ pickupWindow: windowEnding(150) }))[0]?.severity, 'med');
  assert.equal(run(shipment({ pickupWindow: windowEnding(239) }))[0]?.severity, 'med');
  assert.equal(run(shipment({ pickupWindow: windowEnding(240) }))[0]?.severity, 'high');
});

test('LATE-PU boundary: exactly at the grace does not fire, one minute later does', () => {
  assert.equal(run(shipment({ pickupWindow: windowEnding(120) })).length, 0);
  assert.equal(run(shipment({ pickupWindow: windowEnding(121) })).length, 1);
});

test('LATE-PU negative: picked_up, departed at pickup, or clearly moved on', () => {
  const w = windowEnding(600);
  assert.equal(run(shipment({ pickupWindow: w, events: [event('picked_up', 500)] })).length, 0);
  assert.equal(run(shipment({ pickupWindow: w, events: [event('departed', 500, { stop: 'pickup' })] })).length, 0);
  assert.equal(run(shipment({ pickupWindow: w, events: [event('in_transit', 100)] })).length, 0);
  assert.equal(run(shipment({ pickupWindow: w, events: [event('delivered', 100)] })).length, 0);
  // departed at the DELIVERY stop is not a pickup departure by the contract, but it proves movement
  assert.equal(run(shipment({ pickupWindow: w, events: [event('departed', 100, { stop: 'delivery' })] })).length, 0);
});

test('LATE-PU: arrived at pickup but not picked up is capped at med and says so', () => {
  const [c] = run(shipment({ pickupWindow: windowEnding(600), events: [event('arrived', 90, { stop: 'pickup' })] }));
  assert.ok(c);
  assert.equal(c.severity, 'med');
  assert.equal(c.facts.arrivedAtPickup, utc(90));
  assert.ok(c.evidence.some((e) => e.source === 'event'));
});

test('LATE-PU missing or unusable inputs: never fires, never throws', () => {
  assert.equal(run(shipment()).length, 0);
  assert.equal(run(shipment({ pickupWindow: { start: iso(700), end: 'garbage' } })).length, 0);
  assert.equal(run(shipment({ pickupWindow: { start: iso(700), end: '2026-11-06T09:00:00' } })).length, 0, 'no offset => unusable');
  assert.equal(run(shipment({ pickupWindow: { start: iso(0), end: iso(600) } })).length, 0, 'start after end');
  assert.equal(run(shipment({ pickupWindow: { start: 'junk', end: iso(600) } })).length, 1, 'bad start ignored');
  assert.equal(latePickup(shipment({ pickupWindow: windowEnding(600) }), new Date('nope')).length, 0);
});

test('LATE-PU ignores events dated in the future and survives garbage events', () => {
  const s = shipment({
    pickupWindow: windowEnding(600),
    events: [
      event('picked_up', -30), // future: cannot have happened yet
      { ...event('picked_up', 0), at: 'not-a-date' },
      { ...event('departed', 0, { stop: 'pickup' }), at: '2026-11-06T10:00:00' },
    ],
  });
  assert.equal(run(s).length, 1);
});

test('LATE-PU compares instants: same moment in different offsets gives the same result', () => {
  const a = run(shipment({ pickupWindow: windowEnding(300, 120, 0) }))[0];
  const b = run(shipment({ pickupWindow: windowEnding(300, 120, 330) }))[0];
  const c = run(shipment({ pickupWindow: windowEnding(300, 120, -480) }))[0];
  assert.ok(a && b && c);
  for (const x of [b, c]) {
    assert.equal(x.id, a.id);
    assert.equal(x.severity, a.severity);
    assert.equal(x.title, a.title);
    assert.equal(x.facts.minutesOverdue, a.facts.minutesOverdue);
  }
  assert.equal(b.facts.pickupWindowEnd, utc(300), 'display is UTC whatever the source offset');
  // boundary is also offset-independent
  assert.equal(run(shipment({ pickupWindow: windowEnding(120, 120, 330) })).length, 0);
  assert.equal(run(shipment({ pickupWindow: windowEnding(121, 120, -480) })).length, 1);
});

test('LATE-PU config override: grace hours', () => {
  const s = shipment({ pickupWindow: windowEnding(300) });
  assert.equal(run(s, { latePickupGraceHours: 5 }).length, 0, 'exactly at 5h grace');
  assert.equal(run(shipment({ pickupWindow: windowEnding(301) }), { latePickupGraceHours: 5 }).length, 1);
  assert.equal(run(shipment({ pickupWindow: windowEnding(1) }), { latePickupGraceHours: 0 }).length, 1);
  assert.equal(run(s, { latePickupGraceHours: Number.NaN }).length, 1, 'NaN falls back to the default');
  assert.equal(run(s, { latePickupGraceHours: Infinity }).length, 0, 'Infinity disables');
});

test('LATE-PU display facts: UTC times and duration text agree with the title', () => {
  const [c] = run(shipment({ pickupWindow: windowEnding(312, 120, 330) }));
  assert.ok(c);
  assert.equal(c.facts.overdueText, '5h 12m');
  assert.equal(c.title, 'Pickup 5h 12m overdue');
  assert.equal(c.facts.pickupWindowEnd, utc(312));
  assert.match(String(c.facts.pickupWindowEnd), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
  assert.match(String(c.facts.asOf), / UTC$/);
  assert.ok(c.summary.includes(String(c.facts.pickupWindowEnd)) && c.summary.includes('5h 12m'));
});
