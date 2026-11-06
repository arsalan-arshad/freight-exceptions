import { test } from 'node:test';
import assert from 'node:assert/strict';
import { item, reasonOf, run } from './testkit';

// Past events must not be later than the email that reports them, so these tests use a late receipt time.
const LATE = { messageId: 'm', receivedAt: '2026-04-01T00:00:00Z' };

test('time zone forms: Z, UTC, GMT+2, numeric offsets', async () => {
  const cases: Array<[string, string]> = [
    ['arrived 2026-03-05T11:00:00Z', '2026-03-05T11:00:00Z'],
    ['arrived 2026-03-05T11:00:00-05:00', '2026-03-05T16:00:00Z'],
    ['arrived 2026-03-05 11:00 UTC', '2026-03-05T11:00:00Z'],
    ['arrived 5 Mar 2026 11:00 GMT+2', '2026-03-05T09:00:00Z'],
    ['arrived 2026-03-05 11:00 -0500', '2026-03-05T16:00:00Z'],
    ['arrived March 5, 2026 at 11:00 PM PST', '2026-03-06T07:00:00Z'],
    ['arrived 5th March 2026 11:30am MDT', '2026-03-05T17:30:00Z'],
    ['arrived on 5 March 2026 at 12:00 AM EDT', '2026-03-05T04:00:00Z'],
  ];
  for (const [q, want] of cases) {
    const { r } = await run([item('arrivedAt', want, q)], q, LATE);
    assert.equal(r.accepted[0]?.value, want, `${q}: ${JSON.stringify(r.rejected)}`);
  }
});

test('unsupported abbreviations and ranges mistaken for offsets are rejected', async () => {
  for (const q of ['arrived 2026-03-05 11:00 IST', 'arrived 2026-03-05 11:00 ET', 'arrived 2026-03-05 10:00-12:00 EST', 'arrived 2026-03-05 11:00 Eastern']) {
    const { r } = await run([item('arrivedAt', '2026-03-05T11:00:00Z', q)], q);
    assert.equal(r.accepted.length, 0, q);
  }
  const ist = await run([item('arrivedAt', '2026-03-05T11:00:00Z', 'arrived 2026-03-05 11:00 IST')], 'arrived 2026-03-05 11:00 IST');
  assert.match(reasonOf(ist.r, 'arrivedAt')!, /ambiguous or unsupported/);
});

test('ambiguous or impossible dates are rejected', async () => {
  for (const q of ['arrived 03/04/2026 11:00 EST', 'arrived 2026-02-30 11:00 EST', 'arrived 2026-03-05 25:00 EST', 'arrived 2026-03-05', 'arrived 13/13/2026 11:00 EST']) {
    const { r } = await run([item('arrivedAt', '2026-03-05T16:00:00Z', q)], q);
    assert.equal(r.accepted.length, 0, q);
  }
  const amb = await run([item('arrivedAt', '2026-03-04T16:00:00Z', 'arrived 03/04/2026 11:00 EST')], 'arrived 03/04/2026 11:00 EST');
  assert.match(reasonOf(amb.r, 'arrivedAt')!, /ambiguous numeric date/);
  const ok = await run([item('arrivedAt', '2026-03-13T16:00:00Z', 'arrived 03/13/2026 11:00 EST')], 'arrived 03/13/2026 11:00 EST', LATE);
  assert.equal(ok.r.accepted.length, 1);
  const dmy = await run([item('arrivedAt', '2026-03-13T16:00:00Z', 'arrived 13/03/2026 11:00 EST')], 'arrived 13/03/2026 11:00 EST', LATE);
  assert.equal(dmy.r.accepted.length, 1);
});

test('date without a year uses ctx.receivedAt year; rejected without receivedAt or when it lands in the future', async () => {
  const q = 'delivered Mar 4 at 9:15 AM EST';
  const ok = await run([item('deliveredAt', '2026-03-04T14:15:00Z', q)], q, { messageId: 'm', receivedAt: '2026-03-05T18:00:00Z' });
  assert.equal(ok.r.accepted[0]?.value, '2026-03-04T14:15:00Z');
  const no = await run([item('deliveredAt', '2026-03-04T14:15:00Z', q)], q, { messageId: 'm' });
  assert.match(reasonOf(no.r, 'deliveredAt')!, /without a year needs ctx\.receivedAt/);
  const future = await run([item('deliveredAt', '2026-03-04T14:15:00Z', q)], q, { messageId: 'm', receivedAt: '2026-01-02T00:00:00Z' });
  assert.match(reasonOf(future.r, 'deliveredAt')!, /in the future of that email/);
});

test('relative words: tomorrow resolved only with receivedAt and a zone; tonight rejected; past events cannot be "tomorrow"', async () => {
  const q = 'new ETA tomorrow at 14:00 EST';
  const ctx = { messageId: 'm', receivedAt: '2026-03-04T20:00:00Z' }; // 15:00 EST on Mar 4
  const ok = await run([item('eta', '2026-03-05T19:00:00Z', q)], q, ctx);
  assert.equal(ok.r.accepted[0]?.value, '2026-03-05T19:00:00Z');
  const none = await run([item('eta', '2026-03-05T19:00:00Z', q)], q, { messageId: 'm' });
  assert.match(reasonOf(none.r, 'eta')!, /relative date "tomorrow" needs ctx\.receivedAt/);
  const wrong = await run([item('eta', '2026-03-04T19:00:00Z', q)], q, ctx);
  assert.equal(wrong.r.accepted.length, 0);
  const tonight = await run([item('eta', '2026-03-05T02:00:00Z', 'ETA tonight 21:00 EST')], 'ETA tonight 21:00 EST', ctx);
  assert.match(reasonOf(tonight.r, 'eta')!, /tonight/);
  const bad = await run([item('deliveredAt', '2026-03-05T19:00:00Z', 'delivered tomorrow 14:00 EST')], 'delivered tomorrow 14:00 EST', ctx);
  assert.match(reasonOf(bad.r, 'deliveredAt')!, /future/);
  const badRecv = await run([item('eta', '2026-03-05T19:00:00Z', q)], q, { messageId: 'm', receivedAt: 'yesterday-ish' });
  assert.match(reasonOf(badRecv.r, 'eta')!, /receivedAt is not a valid/);
  const noZone = await run([item('eta', '2026-03-05T19:00:00Z', 'new ETA tomorrow at 14:00')], 'new ETA tomorrow at 14:00', ctx);
  assert.match(reasonOf(noZone.r, 'eta')!, /no time zone/);
});

test('time with no date at all: only with receivedAt and only if it makes sense for the field', async () => {
  const q = 'arrived at 09:15 EST';
  const ctx = { messageId: 'm', receivedAt: '2026-03-04T20:00:00Z' };
  const ok = await run([item('arrivedAt', '2026-03-04T14:15:00Z', q)], q, ctx);
  assert.equal(ok.r.accepted.length, 1);
  const late = await run([item('arrivedAt', '2026-03-04T14:15:00Z', q)], q, { messageId: 'm', receivedAt: '2026-03-04T10:00:00Z' });
  assert.equal(late.r.accepted.length, 0);
  const etaPast = await run([item('eta', '2026-03-04T14:15:00Z', 'ETA 09:15 EST')], 'ETA 09:15 EST', ctx);
  assert.match(reasonOf(etaPast.r, 'eta')!, /before that email/);
  const none = await run([item('arrivedAt', '2026-03-04T14:15:00Z', q)], q, { messageId: 'm' });
  assert.equal(none.r.accepted.length, 0);
});

test('two different times in one quote: the model must pick one that exists; a third one is rejected', async () => {
  const q = 'arrived 2026-03-05 11:00 EST, departed 2026-03-05 12:30 EST';
  const a = await run([item('departedAt', '2026-03-05T17:30:00Z', q)], q);
  assert.equal(a.r.accepted.length, 1);
  const b = await run([item('departedAt', '2026-03-05T19:30:00Z', q)], q);
  assert.equal(b.r.accepted.length, 0);
});

test('a date and an unrelated time far apart cannot be glued together when ambiguous', async () => {
  const q = 'Delivered Mar 4, 2026. Next pickup Mar 9, 2026 and dock opens 08:00 EST.';
  const { r } = await run([item('deliveredAt', '2026-03-04T13:00:00Z', q)], q);
  assert.equal(r.accepted.length, 0);
});

test('model value without an offset, or non-string, is rejected', async () => {
  const q = 'Delivered 2026-03-05 12:50 EST';
  const a = await run([item('deliveredAt', '2026-03-05T17:50:00', q)], q);
  assert.match(reasonOf(a.r, 'deliveredAt')!, /not an ISO 8601 date-time with an offset/);
  const b = await run([item('deliveredAt', 1772733000, q)], q);
  assert.match(reasonOf(b.r, 'deliveredAt')!, /must be an ISO 8601 string/);
});

test('a past event later than the email that reports it is rejected, even with an explicit date', async () => {
  const q = 'Delivered 2026-03-05 20:00 EST';
  const r = await run([item('deliveredAt', '2026-03-06T01:00:00Z', q)], q); // receivedAt 2026-03-05T18:00Z
  assert.match(reasonOf(r.r, 'deliveredAt')!, /in the future of the email/);
  const ok = await run([item('deliveredAt', '2026-03-06T01:00:00Z', q)], q, LATE);
  assert.equal(ok.r.accepted.length, 1);
});

test('time-zone abbreviations only count as UPPERCASE standalone tokens ("est." means estimated)', async () => {
  const q = 'ETA 2026-03-06 14:00 est.';
  const a = await run([item('eta', '2026-03-06T19:00:00Z', q)], q);
  assert.match(reasonOf(a.r, 'eta')!, /no time zone/);
  const b = await run([item('eta', '2026-03-06T19:00:00Z', 'ETA 2026-03-06 14:00 EST.')], 'ETA 2026-03-06 14:00 EST.');
  assert.equal(b.r.accepted.length, 1);
});
