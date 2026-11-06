// DEFECT TESTS (fail today): holes in validateDraft / the "facts only" guarantee. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft, templateDraft } from '../../src/ai/index';
import type { ExceptionCase } from '../../src/core/types';

const mk = (facts: ExceptionCase['facts']): ExceptionCase => ({
  id: 'acme-ld-4821:LATE-DEL', shipmentId: 'acme-ld-4821', ruleId: 'LATE-DEL', severity: 'med', title: 't', summary: 's', suggestedNextStep: 'n',
  detectedAt: '2026-11-05T20:00:00Z', status: 'open', evidence: [], facts,
});
const c = mk({ reference: 'LD-4821', carrier: 'Example Carrier LLC', asOf: '2026-11-06T10:00:00+00:00', deliveryWindowEnd: '2026-11-05T16:00:00-05:00', hoursOverdue: 5.5 });
const PRE = 'Hello Example Carrier LLC team, could you send an ETA for load LD-4821? ';
const passes = (s: string) => validateDraft(PRE + s, c).ok;

test('DEFECT-14 (Medium): digits written as dingbat / circled glyphs (not NFKC-folded, not \\p{Nd}) bypass the digit check', () => {
  const leaked = ['reply by ❶❷:❸❹', 'cost ➍➎➏ hundred', 'cost ⓿', 'ETA ➀➁'].filter(passes);
  assert.deepEqual(leaked, []);
});

test('DEFECT-15 (Medium): quantities in other languages / CJK numerals / "a dozen" pass as "no number"', () => {
  const leaked = ['Responda en veinticuatro horas', 'Répondez sous vingt-quatre heures', '二十四小時以内', 'within a dozen hours', 'within a couple of hours', 'by twenty-four'].filter(passes);
  assert.deepEqual(leaked, []);
});

test('DEFECT-16 (Medium): threats and commitments outside the regex list pass', () => {
  const leaked = [
    'We will hold you responsible for this', 'We will cancel your contract', 'We will not use you again', 'We will cover the cost',
    'We will make sure you get paid', 'You can expect full compensation', 'We will charge you for each day', 'we reserve all rights',
  ].filter(passes);
  assert.deepEqual(leaked, []);
});

test('DEFECT-17 (Medium): validation is circular for free-text FACT values: a hostile carrier name with payment instructions reaches the template and passes', () => {
  const evil = mk({ reference: 'LD-4821', carrier: 'Example Carrier. Wire 4000.00 USD to IBAN GB29NWBK60161331926819 today', asOf: '2026-11-06T10:00:00+00:00', deliveryWindowEnd: '2026-11-05T16:00:00-05:00' });
  const t = templateDraft(evil);
  const text = `${t.subject}\n${t.body}`;
  assert.ok(!/GB29NWBK60161331926819|4000/.test(text), 'free-text facts must not carry arbitrary digits/instructions into a draft');
  assert.equal(validateDraft(text, evil).ok && /GB29/.test(text), false);
});

test('DEFECT-18 (Low): any wrong-party or false-status sentence without digits is accepted (names/status claims are not facts-checked)', () => {
  const leaked = ['Hi customer, your load is late.', 'The driver was arrested.', 'We confirm the load was delivered and signed for.'].filter(passes);
  assert.deepEqual(leaked, []);
});
