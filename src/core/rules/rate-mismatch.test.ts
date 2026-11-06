import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOW, doc, shipment } from '../testkit';
import { rateMismatch } from './rate-mismatch';

const run = (s = shipment(), cfg = {}) => rateMismatch(s, NOW, cfg);
const invoice = (amount: number, currency = 'USD', ago = 100, id?: string) =>
  doc('invoice', ago, { amount: { amount, currency }, ...(id ? { id } : {}) });
const rated = (agreed: number, invoices: ReturnType<typeof doc>[], currency = 'USD') =>
  shipment({ agreedRate: { amount: agreed, currency }, documents: invoices });

test('RATE-MISMATCH positive: invoice above agreed', () => {
  const [c] = run(rated(1250, [invoice(1310)]));
  assert.ok(c);
  assert.equal(c.id, 's1:RATE-MISMATCH');
  assert.equal(c.severity, 'med'); // 4.8%
  assert.equal(c.facts.agreedRate, '1,250.00 USD');
  assert.equal(c.facts.invoiceAmount, '1,310.00 USD');
  assert.equal(c.facts.differenceAmount, '+60.00 USD');
  assert.equal(c.facts.differencePercent, 4.8);
  assert.equal(c.facts.toleranceAmount, '0.50 USD');
  assert.equal(c.title, 'Invoice 60.00 USD over agreed rate');
  assert.equal(c.evidence[0]?.source, 'document');
  assert.ok(c.evidence.length >= 2);
});

test('RATE-MISMATCH severity: above agreed low <2%, med from 2%, high from 10%; below is one level lower', () => {
  const sev = (agreed: number, inv: number) => run(rated(agreed, [invoice(inv)]))[0]?.severity;
  assert.equal(sev(1000, 1019), 'low');
  assert.equal(sev(1000, 1020), 'med');
  assert.equal(sev(1000, 1099), 'med');
  assert.equal(sev(1000, 1100), 'high');
  assert.equal(sev(1000, 900), 'med'); // 10% under: high - 1
  assert.equal(sev(1000, 980), 'low'); // 2% under: med - 1
  assert.equal(sev(1000, 990), 'low'); // 1% under: low - 1 floors at low
  assert.equal(sev(0, 50), 'high'); // agreed 0: no percentage, treated as highest
});

test('RATE-MISMATCH boundary: difference exactly equal to the tolerance does not fire (float safe)', () => {
  assert.equal(run(rated(1000.1, [invoice(1000.6)])).length, 0, '0.50 difference');
  assert.equal(run(rated(1000.1, [invoice(1000.61)])).length, 1, '0.51 difference');
  assert.equal(run(rated(1000.6, [invoice(1000.1)])).length, 0, 'below by exactly 0.50');
  assert.equal(run(rated(0.1, [invoice(0.1 + 0.2 - 0.2)])).length, 0, 'float noise is not a mismatch');
  assert.equal(run(rated(19.99, [invoice(19.99)])).length, 0);
});

test('RATE-MISMATCH negative: equal, no invoice, invoice without amount', () => {
  assert.equal(run(rated(1500, [invoice(1500)])).length, 0);
  assert.equal(run(rated(1500, [])).length, 0);
  assert.equal(run(rated(1500, [doc('invoice', 10)])).length, 0, 'invoice with no amount');
  assert.equal(run(rated(1500, [doc('rate_confirmation', 10, { amount: { amount: 9999, currency: 'USD' } })])).length, 0, 'only invoices count');
});

test('RATE-MISMATCH missing agreed rate: never fires', () => {
  assert.equal(run(shipment({ documents: [invoice(900)] })).length, 0);
  assert.equal(run(shipment({ agreedRate: { amount: Number.NaN, currency: 'USD' }, documents: [invoice(900)] })).length, 0);
  assert.equal(run(shipment({ agreedRate: { amount: 100, currency: '' }, documents: [invoice(900)] })).length, 0);
});

test('RATE-MISMATCH currency mismatch fires high, even if the numbers are equal', () => {
  const [c] = run(rated(1800, [invoice(1800, 'CAD')]));
  assert.ok(c);
  assert.equal(c.severity, 'high');
  assert.equal(c.facts.agreedCurrency, 'USD');
  assert.equal(c.facts.invoiceCurrency, 'CAD');
  assert.equal(c.facts.differenceAmount, undefined, 'no cross-currency difference is computed');
  assert.ok(c.title.includes('CAD'));
  // currency codes compare case-insensitively
  assert.equal(run(rated(1800, [invoice(1800, 'usd')])).length, 0);
});

test('RATE-MISMATCH uses the latest invoice; garbage invoices are skipped', () => {
  const wrongThenCorrected = rated(1250, [invoice(1400, 'USD', 900, 'inv-a'), invoice(1250, 'USD', 300, 'inv-b')]);
  assert.equal(run(wrongThenCorrected).length, 0);
  const correctThenWrong = rated(1250, [invoice(1250, 'USD', 900, 'inv-a'), invoice(1400, 'USD', 300, 'inv-b')]);
  assert.equal(run(correctThenWrong)[0]?.facts.invoiceAmount, '1,400.00 USD');
  const withGarbage = rated(1250, [invoice(Number.NaN, 'USD', 10, 'inv-nan'), invoice(1400, 'USD', 300, 'inv-b'), invoice(5, 'US$', 5, 'inv-cur')]);
  assert.equal(run(withGarbage)[0]?.facts.invoiceAmount, '1,400.00 USD');
  const future = rated(1250, [invoice(1400, 'USD', -600)]);
  assert.equal(run(future).length, 0, 'an invoice dated in the future has not been received');
  const unparseableDate = rated(1250, [doc('invoice', 0, { receivedAt: 'last tuesday', amount: { amount: 1400, currency: 'USD' } })]);
  const [c] = run(unparseableDate);
  assert.ok(c);
  assert.equal(c.facts.invoiceReceivedAt, undefined, 'unknown receipt time is omitted, not invented');
});

test('RATE-MISMATCH config override: tolerance', () => {
  assert.equal(run(rated(1000, [invoice(1005)]), { rateToleranceAmount: 5 }).length, 0);
  assert.equal(run(rated(1000, [invoice(1005.01)]), { rateToleranceAmount: 5 }).length, 1);
  assert.equal(run(rated(1000, [invoice(1000.01)]), { rateToleranceAmount: 0 }).length, 1);
  assert.equal(run(rated(1000, [invoice(1000)]), { rateToleranceAmount: 0 }).length, 0);
  assert.equal(run(rated(1000, [invoice(1001)]), { rateToleranceAmount: -1 }).length, 1, 'negative tolerance falls back to default 0.50');
});

test('RATE-MISMATCH formats thousands and cents', () => {
  const [c] = run(rated(12500.5, [invoice(1234567.89, 'USD')]));
  assert.ok(c);
  assert.equal(c.facts.agreedRate, '12,500.50 USD');
  assert.equal(c.facts.invoiceAmount, '1,234,567.89 USD');
});
