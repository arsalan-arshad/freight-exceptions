// DEFECT TESTS: each test FAILS today and demonstrates a real hole in "every extracted value is backed by a verbatim quote".
// The quote is verified to EXIST in the email, but not that it SAYS what the field claims. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromEmail } from '../../src/ingest/index';
import { FakeLlmClient } from '../../src/ai/index';

const CTX = { messageId: 'adv-d', receivedAt: '2026-03-05T18:00:00Z' };
async function run(text: string, items: unknown[], ctx: Record<string, unknown> = CTX) {
  return extractFromEmail(text, new FakeLlmClient(() => JSON.stringify(items)) as never, ctx as never);
}

test('DEFECT-1 (High): a time quote about something else is accepted for any time field (ETA labelled deliveredAt)', async () => {
  const text = 'Load LD-1001: new ETA is March 6, 2026 2:30 PM CST. Not delivered yet.';
  const r = await run(text, [{ field: 'deliveredAt', value: '2026-03-06T20:30:00Z', quote: 'new ETA is March 6, 2026 2:30 PM CST' }]);
  assert.deepEqual(r.accepted, [], 'an ETA must not be accepted as a delivery time');
});

test('DEFECT-2 (High): quote may cut a number mid-token: LD-10012 is accepted as LD-1001 (wrong shipment)', async () => {
  const r = await run('Status for load LD-10012 is late.', [{ field: 'reference', value: 'LD-1001', quote: 'Status for load LD-1001' }]);
  assert.deepEqual(r.accepted, []);
});

test('DEFECT-3 (High): quote may cut an amount mid-token: 11,250.00 is accepted as 1,250.00 (can hide a RATE-MISMATCH)', async () => {
  const r = await run('Invoice total: USD 11,250.00', [{ field: 'invoiceAmount', value: 1250, quote: '1,250.00' }]);
  assert.deepEqual(r.accepted, []);
});

test('DEFECT-4 (High): quote may cut a clock time mid-token: 11:00 is accepted as 1:00', async () => {
  const r = await run('Truck arrived at the dock 11:00 EST on March 5, 2026.', [{ field: 'arrivedAt', value: '2026-03-05T06:00:00Z', quote: '1:00 EST on March 5, 2026' }]);
  assert.deepEqual(r.accepted, []);
});

test('DEFECT-5 (High): negation OUTSIDE the quote is invisible: "NO signed POD attached yet" yields podAttached=true (clears NO-POD)', async () => {
  const r = await run('We have NO signed POD attached yet.', [{ field: 'podAttached', value: true, quote: 'signed POD attached' }]);
  assert.deepEqual(r.accepted, []);
});

test('DEFECT-6 (Medium): negation vocabulary gaps accept "POD attachment failed", "never attached", "to be attached", "unsigned/blank POD attached"', async () => {
  const accepted: string[] = [];
  for (const q of ['POD attachment failed', 'POD was never attached', 'Signed POD to be attached tomorrow', 'POD should be attached', 'Unsigned POD attached', 'Blank POD attached', 'Draft POD attached']) {
    const r = await run(q, [{ field: 'podAttached', value: true, quote: q }]);
    if (r.accepted.length) accepted.push(q);
  }
  assert.deepEqual(accepted, []);
});

test('DEFECT-7 (Medium): a future explicit date is accepted for a past-event field and silently becomes true later (delivered "appointment")', async () => {
  const q = 'Delivery appointment 2026-03-10 09:00 EST';
  const r = await run(q, [{ field: 'deliveredAt', value: '2026-03-10T14:00:00Z', quote: q }]);
  assert.deepEqual(r.accepted, [], 'deliveredAt after the email was received cannot be a fact');
});

test('DEFECT-8 (Medium): facts from the quoted reply chain / another load are attributed to the load named in the new message', async () => {
  const text = 'Re: LD-1001 status\n\nThanks.\n\n> On Mar 4, Dispatch wrote:\n> LD-2002 delivered 2026-03-05 12:50 EST';
  const r = await run(text, [
    { field: 'reference', value: 'LD-1001', quote: 'Re: LD-1001 status' },
    { field: 'deliveredAt', value: '2026-03-05T17:50:00Z', quote: 'LD-2002 delivered 2026-03-05 12:50 EST' },
  ]);
  assert.ok(!r.accepted.some((a) => a.field === 'deliveredAt'), 'a delivery quote naming LD-2002 must not attach to LD-1001');
});

test('DEFECT-9 (Medium): quoted-reply text (lines starting with ">") counts as the sender\'s new statement', async () => {
  const text = 'Thanks, noted.\n\n> Please confirm: delivered 2026-03-05 12:50 EST, signed POD attached?\n';
  const r = await run(text, [{ field: 'deliveredAt', value: '2026-03-05T17:50:00Z', quote: 'delivered 2026-03-05 12:50 EST' }]);
  assert.deepEqual(r.accepted, []);
});

test('DEFECT-10 (Low): "est." (estimated) is read as the EST time zone', async () => {
  const r = await run('ETA 2026-03-06 14:00 est.', [{ field: 'eta', value: '2026-03-06T19:00:00Z', quote: 'ETA 2026-03-06 14:00 est.' }]);
  assert.deepEqual(r.accepted, []);
});

test('DEFECT-11 (Medium): invoiceAmount may be ANY amount in the quote (detention fee labelled as invoice total)', async () => {
  const q = 'Rate con $1,200.00; detention 150.00; invoice total USD 1,250.00';
  const r = await run(q, [{ field: 'invoiceAmount', value: 150, quote: q }]);
  assert.deepEqual(r.accepted, []);
});
