import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmountNumber } from './index';
import { item, reasonOf, run } from './testkit';

test('parseAmountNumber: accepted and ambiguous forms', () => {
  const ok: Array<[string, number]> = [['1250', 1250], ['1250.5', 1250.5], ['1,250', 1250], ['1,250.00', 1250], ['1.250,00', 1250], ['1,250,000', 1250000], ['1.250.000', 1250000], ['850,50', 850.5]];
  for (const [s, v] of ok) {
    const r = parseAmountNumber(s, { groupingComma: true });
    assert.ok(r.ok && r.value === v, s);
  }
  // one rule: a lone separator + exactly three digits is ambiguous; "1,250" is read as 1250 only when the caller knows
  // the currency is dot-decimal (groupingComma). "1.250" is never accepted.
  assert.equal(parseAmountNumber('1,250').ok, false);
  assert.equal(parseAmountNumber('1.250', { groupingComma: true }).ok, false);
  assert.equal(parseAmountNumber('1.250,00').ok, true);
  for (const s of ['1.250', '1,2,3', '12,345,6', '1,250.000', '', 'abc', '1.2.3', ',50', '12345,678']) {
    assert.equal(parseAmountNumber(s).ok, false, s);
  }
});

test('money: US and European formats accepted when unambiguous', async () => {
  const ok: Array<[string, number]> = [
    ['Invoice total: $1,250.00', 1250],
    ['Invoice total: 1.250,00 EUR', 1250],
    ['Invoice total: EUR 850,50', 850.5],
    ['Amount due 1250', 1250],
    ['Amount due USD 1,250', 1250],
    ['please pay USD 12,500.5 by Friday', 12500.5],
  ];
  for (const [q, v] of ok) {
    const { r } = await run([item('invoiceAmount', v, q)], q);
    assert.equal(r.accepted[0]?.value, v, `${q}: ${JSON.stringify(r.rejected)}`);
  }
});

test('money: ids, ambiguous numbers, zero, negative and text are rejected', async () => {
  const bad: Array<[string, unknown]> = [
    ['Invoice INV-2201 attached', 2201],
    ['Invoice total: 1.250 EUR', 1250],
    ['Pickup number 1250 at dock', 1250],
    ['Invoice total: $0.00', 0],
    ['Invoice total: $1,250.00', -1250],
    ['Invoice total: $1,250.00', 'lots'],
    ['Invoice total: $1,250.00', null],
  ];
  for (const [q, v] of bad) {
    const { r } = await run([item('invoiceAmount', v, q)], q);
    assert.equal(r.accepted.length, 0, `${q} / ${String(v)}`);
  }
});

test('currency needs words/codes in the quote; a bare $ is ambiguous', async () => {
  const dollar = await run([item('invoiceCurrency', 'USD', 'Invoice total: $1,250.00')], 'Invoice total: $1,250.00');
  assert.match(reasonOf(dollar.r, 'invoiceCurrency')!, /bare "\$" is ambiguous/);
  const words = await run([item('invoiceCurrency', 'usd', 'total 1250 US dollars')], 'total 1250 US dollars');
  assert.equal(words.r.accepted[0]?.value, 'USD');
  const eur = await run([item('invoiceCurrency', 'EUR', 'total €850')], 'total €850');
  assert.equal(eur.r.accepted[0]?.value, 'EUR');
  const junk = await run([item('invoiceCurrency', 'dollars', 'total 1250 US dollars')], 'total 1250 US dollars');
  assert.equal(junk.r.accepted.length, 0);
});

test('podAttached: only true, only with POD + attachment wording, never with negation or future wording', async () => {
  const yes = await run([item('podAttached', true, 'Signed POD attached.')]);
  assert.equal(yes.r.accepted[0]?.value, true);
  const proof = await run([item('podAttached', true, 'proof of delivery is attached')], 'Here: proof of delivery is attached');
  assert.equal(proof.r.accepted.length, 1);
  for (const q of ['POD not attached yet', 'No POD attached', 'will send POD attached later', 'Please send the POD attached to the load', 'Is the POD attached?', 'signed copy attached']) {
    const { r } = await run([item('podAttached', true, q)], q);
    assert.equal(r.accepted.length, 0, q);
  }
  const f = await run([item('podAttached', false, 'POD not attached yet')], 'POD not attached yet');
  assert.match(reasonOf(f.r, 'podAttached')!, /only true is accepted/);
});

test('amount quote must be about an invoice/total/amount due, not a fee or rate confirmation', async () => {
  const fee = 'Detention charge $150.00';
  assert.equal((await run([item('invoiceAmount', 150, fee)], fee)).r.accepted.length, 0);
  const rc = 'Rate con $1,200.00';
  assert.match(reasonOf((await run([item('invoiceAmount', 1200, rc)], rc)).r, 'invoiceAmount')!, /not described as an invoice/);
  const bare = 'Pickup at 1,250.00 gate';
  assert.equal((await run([item('invoiceAmount', 1250, bare)], bare)).r.accepted.length, 0);
  const multi = 'Rate con $1,200.00; detention 150.00; invoice total USD 1,250.00';
  assert.equal((await run([item('invoiceAmount', 1250, multi)], multi)).r.accepted.length, 1);
  assert.equal((await run([item('invoiceAmount', 1200, multi)], multi)).r.accepted.length, 0);
});
