// Runs the real rules engine over synthetic fixtures and checks that templates and validation work on the
// facts it actually produces (key names and formats), not only on hand-built cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateShipments } from '../core';
import { generateSyntheticShipments } from '../fixtures';
import { draftFollowUp } from './draft';
import { FakeLlmClient } from './fake';
import { templateDraft } from './template';
import { validateDraft } from './validate';

const NOW = new Date('2026-11-06T15:00:00.000Z');

test('templates for every case produced by the real engine pass validateDraft and use the real fact keys', async () => {
  const shipments = generateSyntheticShipments(NOW, 7);
  const cases = evaluateShipments(shipments, NOW);
  assert.ok(cases.length >= 6, `expected several cases, got ${cases.length}`);
  const seen = new Set<string>();
  for (const c of cases) {
    seen.add(c.ruleId);
    const d = templateDraft(c);
    const vb = validateDraft(d.body, c);
    const vs = validateDraft(d.subject, c, { maxLength: 150 });
    assert.deepEqual(vb.violations, [], `${c.id}\n${d.body}`);
    assert.deepEqual(vs.violations, [], `${c.id}\n${d.subject}`);
    assert.ok(!/undefined|null|NaN|\[|\{/.test(d.subject + d.body), c.id);
    // the reference from the facts is really used
    assert.ok(d.body.includes(String(c.facts.reference)), `${c.id}: reference missing\n${d.body}`);
    // readable text facts from core are used instead of raw minute counts
    for (const key of ['overdueText', 'dwellText'] as const) {
      const t = c.facts[key];
      if (typeof t === 'string') assert.ok(d.body.includes(t), `${c.id}: ${key} "${t}" not used\n${d.body}`);
    }
    // a model that parrots the template is accepted; a model that moves the deadline by a minute is not
    const shipment = shipments.find((s) => s.id === c.shipmentId)!;
    const ok = await draftFollowUp(c, shipment, new FakeLlmClient(() => JSON.stringify(d)));
    assert.equal(ok.origin, 'llm', `${c.id}: ${ok.fallbackReasons.join('|')}`);
  }
  for (const id of ['LATE-PU', 'LATE-DEL', 'NO-POD', 'NO-UPDATE', 'DETENTION', 'RATE-MISMATCH']) {
    assert.ok(seen.has(id), `fixtures produced no ${id} case, so it was not exercised`);
  }
});

test('on real engine output, tampering with any time or amount in a good draft is caught', () => {
  const cases = evaluateShipments(generateSyntheticShipments(NOW, 7), NOW);
  let tampered = 0;
  for (const c of cases) {
    const body = templateDraft(c).body;
    // bump the last digit of every digit run that comes from a fact by one
    const changed = body.replace(/\d+(?=\D|$)/g, (m) => m.slice(0, -1) + String((Number(m.slice(-1)) + 1) % 10));
    if (changed === body) continue;
    tampered++;
    assert.equal(validateDraft(changed, c).ok, false, `${c.id} tamper not detected:\n${changed}`);
  }
  assert.ok(tampered > 0);
});
