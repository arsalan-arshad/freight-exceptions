import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOW, utc, doc, event, iso, shipment, windowEnding } from '../testkit';
import { lateDelivery } from './late-del';

const run = (s = shipment(), cfg = {}) => lateDelivery(s, NOW, cfg);
const base = { events: [event('picked_up', 2000), event('in_transit', 30)] };

test('LATE-DEL positive (overdue): window ended 3h ago, not delivered', () => {
  const [c] = run(shipment({ ...base, deliveryWindow: windowEnding(180) }));
  assert.ok(c);
  assert.equal(c.id, 's1:LATE-DEL');
  assert.equal(c.severity, 'high');
  assert.equal(c.title, 'Delivery 3h overdue');
  assert.equal(c.facts.minutesOverdue, 180);
  assert.equal(c.facts.hoursOverdue, 3);
  assert.equal(c.facts.deliveryWindowEnd, utc(180));
  assert.ok(c.evidence.length >= 1);
});

test('LATE-DEL overdue severity: med under 2h, high from 2h', () => {
  assert.equal(run(shipment({ ...base, deliveryWindow: windowEnding(30) }))[0]?.severity, 'med');
  assert.equal(run(shipment({ ...base, deliveryWindow: windowEnding(119) }))[0]?.severity, 'med');
  assert.equal(run(shipment({ ...base, deliveryWindow: windowEnding(120) }))[0]?.severity, 'high');
});

test('LATE-DEL positive (ETA): newest ETA is after the window end', () => {
  const s = shipment({
    deliveryWindow: windowEnding(-240),
    events: [event('picked_up', 800), event('eta_update', 60, { eta: iso(-420) })],
  });
  const [c] = run(s);
  assert.ok(c);
  assert.equal(c.severity, 'med'); // 3h projected
  assert.equal(c.title, 'Delivery ETA 3h after window');
  assert.equal(c.facts.latestEta, utc(-420));
  assert.equal(c.facts.projectedMinutesLate, 180);
  assert.equal(c.facts.minutesOverdue, undefined, 'not overdue yet');
});

test('LATE-DEL ETA severity: low under 2h, med from 2h, high from 8h', () => {
  const at = (extraMin: number) =>
    run(
      shipment({
        deliveryWindow: windowEnding(-240),
        events: [event('picked_up', 800), event('eta_update', 10, { eta: iso(-240 - extraMin) })],
      }),
    )[0]?.severity;
  assert.equal(at(1), 'low');
  assert.equal(at(119), 'low');
  assert.equal(at(120), 'med');
  assert.equal(at(479), 'med');
  assert.equal(at(480), 'high');
});

test('LATE-DEL boundaries: now == window end, ETA == window end', () => {
  assert.equal(run(shipment({ ...base, deliveryWindow: windowEnding(0) })).length, 0);
  assert.equal(run(shipment({ ...base, deliveryWindow: windowEnding(-1) })).length, 0);
  assert.equal(run(shipment({ ...base, deliveryWindow: windowEnding(1) })).length, 1);
  const eta = (m: number) =>
    shipment({ deliveryWindow: windowEnding(-240), events: [event('picked_up', 800), event('eta_update', 5, { eta: iso(m) })] });
  assert.equal(run(eta(-240)).length, 0);
  assert.equal(run(eta(-241)).length, 1);
});

test('LATE-DEL uses only the NEWEST eta_update', () => {
  const late = event('eta_update', 120, { eta: iso(-600) });
  const recovered = event('eta_update', 30, { eta: iso(-100) });
  const s = (events: ReturnType<typeof event>[]) => shipment({ deliveryWindow: windowEnding(-240), events: [event('picked_up', 800), ...events] });
  assert.equal(run(s([late, recovered])).length, 0, 'newer ETA is on time');
  assert.equal(run(s([recovered, late])).length, 0, 'input order does not matter');
  assert.equal(run(s([recovered, event('eta_update', 10, { eta: iso(-600) })])).length, 1, 'newer ETA is late');
  const garbageNewest = { ...event('eta_update', 10), eta: 'soon' };
  assert.equal(run(s([late, garbageNewest])).length, 0, 'unparseable newest ETA means unknown, not the stale one');
});

test('LATE-DEL negative: delivered (even late) never fires; future delivered event is ignored', () => {
  const w = windowEnding(300);
  assert.equal(run(shipment({ deliveryWindow: w, events: [event('delivered', 100)] })).length, 0);
  assert.equal(run(shipment({ deliveryWindow: w, events: [event('delivered', -60)] })).length, 1, 'delivered "in the future" is not yet delivered');
});

test('LATE-DEL overdue and ETA late: one case, higher severity, both facts', () => {
  const [c, ...rest] = run(
    shipment({ deliveryWindow: windowEnding(30), events: [event('picked_up', 800), event('eta_update', 10, { eta: iso(-600) })] }),
  );
  assert.equal(rest.length, 0);
  assert.ok(c);
  assert.equal(c.severity, 'high'); // overdue med, forecast 10h high
  assert.equal(c.facts.minutesOverdue, 30);
  assert.equal(c.facts.projectedMinutesLate, 630);
});

test('LATE-DEL missing inputs: no window, garbage window, garbage events', () => {
  assert.equal(run(shipment({ events: [event('eta_update', 5, { eta: iso(-9999) })] })).length, 0);
  assert.equal(run(shipment({ deliveryWindow: { start: iso(900), end: 'whenever' } })).length, 0);
  const s = shipment({
    deliveryWindow: windowEnding(-100),
    events: [{ ...event('eta_update', 5), at: 'x', eta: iso(-999) }, { ...event('eta_update', 5), eta: '12:30' }],
  });
  assert.equal(run(s).length, 0);
});

test('LATE-DEL compares instants across offsets', () => {
  const a = run(shipment({ ...base, deliveryWindow: windowEnding(180, 120, 0) }))[0];
  const b = run(shipment({ ...base, deliveryWindow: windowEnding(180, 120, -300) }))[0];
  assert.ok(a && b);
  assert.equal(a.severity, b.severity);
  assert.equal(a.title, b.title);
  assert.equal(b.facts.deliveryWindowEnd, utc(180));
  const etaA = shipment({ deliveryWindow: windowEnding(-240, 120, 0), events: [event('eta_update', 5, { eta: iso(-241, 330) })] });
  assert.equal(run(etaA).length, 1);
});

test('LATE-DEL config override: grace hours (ETA path is not affected by grace)', () => {
  assert.equal(run(shipment({ ...base, deliveryWindow: windowEnding(180) }), { lateDeliveryGraceHours: 3 }).length, 0);
  assert.equal(run(shipment({ ...base, deliveryWindow: windowEnding(181) }), { lateDeliveryGraceHours: 3 }).length, 1);
  const etaLate = shipment({ deliveryWindow: windowEnding(-240), events: [event('eta_update', 5, { eta: iso(-300) })] });
  assert.equal(run(etaLate, { lateDeliveryGraceHours: 10 }).length, 1);
});

test('LATE-DEL ignores documents entirely', () => {
  assert.equal(run(shipment({ deliveryWindow: windowEnding(180), documents: [doc('pod', 10)] })).length, 1);
});

test('LATE-DEL display facts: overdueText / projectedLateText', () => {
  const [o] = run(shipment({ ...base, deliveryWindow: windowEnding(45) }));
  assert.equal(o?.facts.overdueText, '45m');
  const [e] = run(shipment({ deliveryWindow: windowEnding(-240), events: [event('eta_update', 5, { eta: iso(-240 - 3100, 60) })] }));
  assert.equal(e?.facts.projectedLateText, '2d 3h');
  assert.equal(e?.facts.latestEta, utc(-240 - 3100));
  assert.equal(e?.facts.overdueText, undefined);
});
