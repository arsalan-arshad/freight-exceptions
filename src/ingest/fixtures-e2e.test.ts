// Optional end-to-end test over the synthetic fixtures (another agent's module): skipped if absent.
// A scripted fake "model" proposes plausible items per email; the verifier decides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { applyExtraction, extractFromEmail, parseEml, parseEmailDate, parseShipmentsCsv } from './index';
import { FakeLlm, item } from './testkit';

const present = existsSync(new URL('../fixtures/index.ts', import.meta.url));

test('fixtures e2e: sample emails -> verified extraction -> applied to sample CSV shipments', { skip: !present && 'src/fixtures not present yet' }, async () => {
  const spec = '../fixtures/index';
  const mod = (await import(spec)) as {
    generateSampleCsv?: (now: Date) => string;
    generateSampleEmails?: (now: Date) => { id: string; raw: string }[];
  };
  if (!mod.generateSampleCsv || !mod.generateSampleEmails) return;
  const now = new Date('2026-03-05T12:00:00Z');
  const { shipments } = parseShipmentsCsv(mod.generateSampleCsv(now));
  const emails = new Map(mod.generateSampleEmails(now).map((e) => [e.id, e.raw]));

  // What a decent model would propose per sample email (some proposals are deliberately wrong).
  const script: Record<string, unknown[]> = {
    'msg-0001': [item('reference', 'LD-7004', 'For load LD-7004'), item('eta', '2026-03-05T20:00:00Z', 'Mar 05, 2026 3:00 PM (UTC-05:00)')],
    'msg-0002': [
      item('reference', 'LD-7012', 'Load LD-7012 was delivered'),
      item('deliveredAt', '2026-03-05T06:00:00Z', 'Delivery completed Mar 05, 2026 12:00 AM (UTC-06:00)'),
      item('podAttached', true, 'Signed POD will follow once the receiver scans it.'), // must be rejected
    ],
    'msg-0003': [item('reference', 'LD-7005', 'proof of delivery for LD-7005 is attached'), item('podAttached', true, 'The signed proof of delivery for LD-7005 is attached.')],
    'msg-0004': [
      item('reference', 'LD-7010', 'invoice for load LD-7010'),
      item('invoiceAmount', 1185, 'Total due: $1,185.00 USD'),
      item('invoiceCurrency', 'USD', 'Total due: $1,185.00 USD'),
    ],
    'msg-0005': [item('reference', 'LD-7006', 'Quick update on LD-7006'), item('arrivedAt', '2026-03-05T20:15:00Z', 'checked in at the receiver at 2:15 PM')], // no zone: rejected
  };

  const accepted = new Map<string, string[]>();
  for (const [id, raw] of emails) {
    const p = parseEml(raw);
    const receivedAt = parseEmailDate(p.date);
    const llm = new FakeLlm(() => JSON.stringify(script[id] ?? []));
    const r = await extractFromEmail(p.body, llm, { messageId: id, ...(receivedAt ? { receivedAt } : {}) });
    accepted.set(id, r.accepted.map((a) => a.field));
    if (id === 'msg-0002') assert.ok(r.rejected.some((x) => x.field === 'podAttached'), 'future-tense POD must be rejected');
    if (id === 'msg-0005') assert.ok(r.rejected.some((x) => x.field === 'arrivedAt' && /no time zone/.test(x.reason)));
    if (id === 'msg-0006') assert.equal(r.needsReview, true); // nothing extractable
    if (script[id] && id !== 'msg-0005' && id !== 'msg-0002') assert.equal(r.needsReview, false, `${id}: ${JSON.stringify(r.rejected)}`);
    // Apply to the CSV shipments when the reference exists there.
    const out = applyExtraction(shipments, r, { kind: 'email', ref: `email:${id}` }, receivedAt ? { receivedAt } : {});
    if (!out.unmatched) {
      const s = out.shipments.find((x) => x.reference === out.matchedReference)!;
      assert.ok([...s.events, ...s.documents].every((x) => x.source.kind !== 'email' || x.source.excerpt));
    }
  }
  assert.deepEqual(accepted.get('msg-0001'), ['reference', 'eta']);
  assert.deepEqual(accepted.get('msg-0003'), ['reference', 'podAttached']);
  assert.deepEqual(accepted.get('msg-0004'), ['reference', 'invoiceAmount', 'invoiceCurrency']);
});
