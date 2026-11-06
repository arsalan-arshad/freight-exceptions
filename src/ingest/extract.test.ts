import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromEmail, buildExtractionPrompt, REASONS } from './index';
import { CTX, EMAIL, FakeLlm, item, reasonOf, run } from './testkit';

test('happy path: every field verified, values derived from the source text', async () => {
  const { r } = await run([
    item('reference', 'LD-1001', 'Load LD-1001 with Example Carrier LLC'),
    item('carrier', 'Example Carrier LLC', 'Load LD-1001 with Example Carrier LLC arrived'),
    item('arrivedAt', '2026-03-05T16:00:00Z', 'arrived at the delivery dock on 2026-03-05 at 11:00 EST'),
    item('deliveredAt', '2026-03-05T12:50:00-05:00', 'Delivered 2026-03-05 12:50 EST'),
    item('podAttached', true, 'Signed POD attached.'),
    item('invoiceAmount', 1250, 'Invoice total: USD 1,250.00 for this load.'),
    item('invoiceCurrency', 'USD', 'Invoice total: USD 1,250.00'),
    item('eta', '2026-03-06T20:30:00Z', 'New ETA is March 6, 2026 2:30 PM CST.'),
  ]);
  assert.deepEqual(r.rejected, []);
  assert.equal(r.needsReview, false);
  const by = Object.fromEntries(r.accepted.map((a) => [a.field, a]));
  assert.equal(by['reference']!.value, 'LD-1001');
  assert.equal(by['arrivedAt']!.value, '2026-03-05T16:00:00Z');
  assert.equal(by['deliveredAt']!.value, '2026-03-05T17:50:00Z');
  assert.equal(by['eta']!.value, '2026-03-06T20:30:00Z');
  assert.equal(by['invoiceAmount']!.value, 1250);
  assert.equal(by['podAttached']!.value, true);
  for (const a of r.accepted) assert.ok(EMAIL.includes(a.quote), `quote must be verbatim: ${a.quote}`);
});

test('quote is matched after collapsing whitespace and case; accepted quote is the original text', async () => {
  const { r } = await run([item('reference', 'LD-1001', 'LOAD   ld-1001\nwith')]);
  assert.equal(r.accepted.length, 1);
  assert.equal(r.accepted[0]!.quote, 'Load LD-1001 with');
  assert.equal(r.accepted[0]!.value, 'LD-1001'); // taken from the source, not from the model
});

test('code fences and surrounding prose are tolerated', async () => {
  const body = JSON.stringify([item('reference', 'LD-1001', 'Load LD-1001')]);
  const a = await run('```json\n' + body + '\n```');
  assert.equal(a.r.accepted.length, 1);
  const b = await run('Sure! Here you go: ' + body + ' Hope that helps.');
  assert.equal(b.r.accepted.length, 1);
});

test('malformed JSON / non-array / non-string reply: everything rejected, needsReview', async () => {
  for (const reply of ['not json at all', '{"field":"reference"}', '[{"field":', '', 'null']) {
    const { r } = await run(reply);
    assert.equal(r.accepted.length, 0, reply);
    assert.equal(r.needsReview, true);
    assert.equal(r.rejected.length, 1);
  }
  assert.equal((await run('not json')).r.rejected[0]!.reason, REASONS.notJson);
  assert.equal((await run('{"a":1}')).r.rejected[0]!.reason, REASONS.notArray);
  const llm = new FakeLlm(() => 42 as unknown as string);
  const r = await extractFromEmail(EMAIL, llm, CTX);
  assert.equal(r.accepted.length, 0);
  assert.equal(r.needsReview, true);
});

test('model invents a time that is not in the quote: rejected', async () => {
  const { r } = await run([item('deliveredAt', '2026-03-05T20:00:00Z', 'Delivered 2026-03-05 12:50 EST')]);
  assert.equal(r.accepted.length, 0);
  assert.match(reasonOf(r, 'deliveredAt')!, /does not match any time resolvable from the quote/);
});

test('model converts the time zone wrongly: rejected (instant must match exactly)', async () => {
  const { r } = await run([item('deliveredAt', '2026-03-05T12:50:00Z', 'Delivered 2026-03-05 12:50 EST')]);
  assert.equal(r.accepted.length, 0);
});

test('quote not present in the email: rejected', async () => {
  const { r } = await run([item('deliveredAt', '2026-03-05T17:50:00Z', 'Delivered 2026-03-05 12:50 EST sharp, driver Bob')]);
  assert.equal(reasonOf(r, 'deliveredAt'), REASONS.quoteNotFound);
});

test('quote in email but value contradicts it: rejected for amount, reference, carrier, currency', async () => {
  const { r } = await run([
    item('invoiceAmount', 1520, 'Invoice total: USD 1,250.00 for this load.'),
    item('reference', 'LD-1002', 'Load LD-1001 with Example Carrier LLC'),
    item('carrier', 'Other Carrier Inc', 'Load LD-1001 with Example Carrier LLC'),
    item('invoiceCurrency', 'EUR', 'Invoice total: USD 1,250.00'),
  ]);
  assert.equal(r.accepted.length, 0);
  assert.match(reasonOf(r, 'invoiceAmount')!, /does not match any amount in the quote/);
  assert.match(reasonOf(r, 'reference')!, /does not appear as a whole token/);
  assert.match(reasonOf(r, 'carrier')!, /does not appear in the quote/);
  assert.match(reasonOf(r, 'invoiceCurrency')!, /not stated in the quote/);
  assert.equal(r.needsReview, true);
});

test('reference must match a whole token: partial references and non-digit words are rejected', async () => {
  const partial = await run([item('reference', '1001', 'Load LD-1001 with')]);
  assert.equal(partial.r.accepted.length, 0);
  const word = await run([item('reference', 'Load', 'Load LD-1001 with')]);
  assert.match(reasonOf(word.r, 'reference')!, /3-40 letters\/digits/);
  const spaced = await run([item('reference', 'LD-1001', 'Load LD 1001 with')], 'Load LD 1001 with Example Carrier LLC');
  assert.equal(spaced.r.accepted[0]!.value, 'LD 1001');
  // separator positions matter: LD1001 is not LD-1001 and LD-12-34 is not LD-1-234
  const glued = await run([item('reference', 'LD1001', 'Load LD 1001 with')], 'Load LD 1001 with Example Carrier LLC');
  assert.equal(glued.r.accepted.length, 0);
  const moved = await run([item('reference', 'LD-1-234', 'Load LD-12-34 with')], 'Load LD-12-34 with Example Carrier LLC');
  assert.equal(moved.r.accepted.length, 0);
});

test('time without a time zone is rejected unless ctx.assumeOffset is set', async () => {
  const text = 'Load LD-1001 delivered 2026-03-05 12:50 at the dock.';
  const q = 'delivered 2026-03-05 12:50 at the dock';
  const a = await run([item('deliveredAt', '2026-03-05T12:50:00-05:00', q)], text);
  assert.match(reasonOf(a.r, 'deliveredAt')!, /no time zone .* ctx\.assumeOffset is not set/);
  const b = await run([item('deliveredAt', '2026-03-05T12:50:00-05:00', q)], text, { ...CTX, assumeOffset: '-05:00' });
  assert.equal(b.r.accepted[0]!.value, '2026-03-05T17:50:00Z');
  const c = await run([item('deliveredAt', '2026-03-05T12:50:00-05:00', q)], text, { ...CTX, assumeOffset: 'bogus' });
  assert.equal(c.r.accepted.length, 0);
});

test('prompt: email is delimited, capped, and contains the message id', () => {
  const p = buildExtractionPrompt('x'.repeat(100_000), CTX);
  assert.ok(p.user.length < 31_000 + 500);
  assert.match(p.user, /msg-0001/);
  assert.match(p.system, /JSON array/);
});

test('empty email does not call the model', async () => {
  const llm = new FakeLlm(() => '[]');
  const r = await extractFromEmail('   \n ', llm, CTX);
  assert.equal(llm.calls.length, 0);
  assert.equal(r.needsReview, true);
  assert.equal(r.rejected[0]!.reason, REASONS.emptyEmail);
});

test('needsReview: true when reference missing even if everything else verified', async () => {
  const { r } = await run([item('deliveredAt', '2026-03-05T17:50:00Z', 'Delivered 2026-03-05 12:50 EST')]);
  assert.equal(r.accepted.length, 1);
  assert.equal(r.rejected.length, 0);
  assert.equal(r.needsReview, true);
});
