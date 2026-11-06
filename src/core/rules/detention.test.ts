import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOW, utc, event, iso, shipment } from '../testkit';
import { detention } from './detention';

const run = (s = shipment(), cfg = {}) => detention(s, NOW, cfg);
const pickupDwell = (arrivedAgo: number, departedAgo: number, extra = {}) =>
  shipment({
    events: [
      event('arrived', arrivedAgo, { stop: 'pickup' }),
      event('picked_up', departedAgo),
      event('departed', departedAgo, { stop: 'pickup' }),
      event('in_transit', 10),
    ],
    ...extra,
  });

test('DETENTION positive at pickup: 4h dwell vs 2h free time', () => {
  const cases = run(pickupDwell(400, 160));
  assert.equal(cases.length, 1);
  const c = cases[0];
  assert.ok(c);
  assert.equal(c.id, 's1:DETENTION:pickup');
  assert.equal(c.severity, 'med');
  assert.equal(c.facts.stop, 'pickup');
  assert.equal(c.facts.dwellMinutes, 240);
  assert.equal(c.facts.freeTimeMinutes, 120);
  assert.equal(c.facts.detentionMinutes, 120);
  assert.equal(c.facts.detentionHours, 2);
  assert.equal(c.facts.stillOnSite, 'no');
  assert.equal(c.facts.arrivedAt, utc(400));
  assert.equal(c.facts.departedAt, utc(160));
  assert.equal(c.title, 'Detention at pickup: 2h over free time');
  assert.ok(c.evidence.length >= 3);
});

test('DETENTION positive at delivery while still on site: bumped one level', () => {
  const s = shipment({ events: [event('picked_up', 2000), event('in_transit', 1500), event('arrived', 200, { stop: 'delivery' })] });
  const [c] = run(s);
  assert.ok(c);
  assert.equal(c.id, 's1:DETENTION:delivery');
  assert.equal(c.facts.stillOnSite, 'yes');
  assert.equal(c.facts.departedAt, undefined);
  assert.equal(c.facts.dwellMinutes, 200);
  assert.equal(c.facts.detentionMinutes, 80);
  assert.equal(c.severity, 'high'); // 80 min over = med, still on site => high
});

test('DETENTION severity: low <60 over, med 60-239, high 240+', () => {
  const sev = (dwell: number) => run(pickupDwell(dwell + 200, 200))[0]?.severity;
  assert.equal(sev(179), 'low'); // 59 over
  assert.equal(sev(180), 'med'); // 60 over
  assert.equal(sev(359), 'med'); // 239 over
  assert.equal(sev(360), 'high'); // 240 over
});

test('DETENTION boundary: dwell exactly at free time does not fire, one minute over does', () => {
  assert.equal(run(pickupDwell(400, 280)).length, 0); // 120 == 120
  assert.equal(run(pickupDwell(401, 280)).length, 1); // 121
});

test('DETENTION uses shipment free time over the default', () => {
  assert.equal(run(pickupDwell(300, 239, { freeTimeMinutes: 60 })).length, 1); // 61 > 60
  assert.equal(run(pickupDwell(300, 240, { freeTimeMinutes: 60 })).length, 0); // 60 == 60
  assert.equal(run(pickupDwell(400, 220, { freeTimeMinutes: 240 })).length, 0); // 180 < 240
  assert.equal(run(pickupDwell(400, 220, { freeTimeMinutes: -5 })).length, 1, 'invalid free time falls back to default 120');
  assert.equal(run(pickupDwell(400, 220, { freeTimeMinutes: Number.NaN })).length, 1);
  assert.equal(run(pickupDwell(300, 280, { freeTimeMinutes: 0 })).length, 1, 'zero free time is a valid override');
});

test('DETENTION evaluates both stops independently', () => {
  const s = shipment({
    events: [
      event('arrived', 900, { stop: 'pickup' }),
      event('departed', 600, { stop: 'pickup' }),
      event('picked_up', 600),
      event('arrived', 300, { stop: 'delivery' }),
      event('delivered', 100),
      event('departed', 90, { stop: 'delivery' }),
    ],
  });
  const ids = run(s).map((c) => c.id).sort();
  assert.deepEqual(ids, ['s1:DETENTION:delivery', 's1:DETENTION:pickup']);
});

test('DETENTION never guesses: missing arrival, contradictory times, moved on without a departure', () => {
  assert.equal(run(shipment({ events: [event('departed', 100, { stop: 'pickup' })] })).length, 0, 'no arrival');
  assert.equal(run(shipment()).length, 0);
  const backwards = shipment({ events: [event('arrived', 200, { stop: 'pickup' }), event('departed', 300, { stop: 'pickup' })] });
  assert.equal(run(backwards).length, 0);
  const movedOn = shipment({ events: [event('arrived', 600, { stop: 'pickup' }), event('picked_up', 400), event('in_transit', 100)] });
  assert.equal(run(movedOn).length, 0, 'departure unknown, not "still on site"');
  const deliveredNoDeparture = shipment({ events: [event('arrived', 600, { stop: 'delivery' }), event('delivered', 300)] });
  assert.equal(run(deliveredNoDeparture).length, 0);
});

test('DETENTION: pickup arrival with no pickup yet counts as on site; garbage and future events ignored', () => {
  const onSite = shipment({ events: [event('arrived', 300, { stop: 'pickup' })] });
  const [c] = run(onSite);
  assert.ok(c);
  assert.equal(c.facts.stillOnSite, 'yes');
  const futureArrival = shipment({ events: [event('arrived', -30, { stop: 'pickup' })] });
  assert.equal(run(futureArrival).length, 0);
  const garbage = shipment({ events: [{ ...event('arrived', 0, { stop: 'pickup' }), at: 'whenever' }] });
  assert.equal(run(garbage).length, 0);
});

test('DETENTION uses earliest arrival and earliest departure at/after it (duplicates are harmless)', () => {
  const s = shipment({
    events: [
      event('arrived', 400, { stop: 'pickup' }),
      event('arrived', 350, { stop: 'pickup', id: 'dup-arrival' }),
      event('departed', 160, { stop: 'pickup' }),
      event('departed', 100, { stop: 'pickup', id: 'dup-departure' }),
      event('picked_up', 160),
    ],
  });
  assert.equal(run(s)[0]?.facts.dwellMinutes, 240);
});

test('DETENTION compares instants across offsets', () => {
  const mk = (off: number, arrived: number, departed: number) =>
    shipment({ events: [event('arrived', arrived, { stop: 'pickup', offset: off }), event('departed', departed, { stop: 'pickup', offset: -off }), event('picked_up', departed)] });
  assert.equal(run(mk(330, 400, 280)).length, 0);
  assert.equal(run(mk(-480, 401, 280)).length, 1);
  assert.equal(run(mk(330, 400, 100))[0]?.facts.arrivedAt, utc(400));
});

test('DETENTION config override: defaultFreeTimeMinutes', () => {
  assert.equal(run(pickupDwell(300, 200), { defaultFreeTimeMinutes: 90 }).length, 1); // 100 > 90
  assert.equal(run(pickupDwell(300, 200), { defaultFreeTimeMinutes: 100 }).length, 0);
  assert.equal(run(pickupDwell(300, 200, { freeTimeMinutes: 200 }), { defaultFreeTimeMinutes: 10 }).length, 0, 'shipment value wins');
});

test('DETENTION display facts: dwellText, overFreeTimeText, freeTimeText agree with title and summary', () => {
  const [c] = run(pickupDwell(420, 100));
  assert.ok(c);
  assert.equal(c.facts.dwellMinutes, 320);
  assert.equal(c.facts.dwellText, '5h 20m');
  assert.equal(c.facts.overFreeTimeText, '3h 20m');
  assert.equal(c.facts.freeTimeText, '2h');
  assert.equal(c.title, 'Detention at pickup: 3h 20m over free time');
  assert.ok(c.summary.includes('5h 20m') && c.summary.includes('2h of free time'));
  assert.ok(!/\d+ minutes/.test(c.summary), 'no raw minute counts next to duration text');
  const [p] = run(pickupDwell(100, 40, { freeTimeMinutes: 45 }));
  assert.equal(p?.facts.freeTimeText, '45m');
  assert.equal(p?.facts.dwellText, '1h');
  assert.equal(p?.facts.overFreeTimeText, '15m');
});
