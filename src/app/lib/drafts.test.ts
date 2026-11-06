import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateShipments } from '@/core';
import type { ExceptionCase, Shipment } from '@/core/types';
import { FakeLlmClient } from '@/ai';
import { openSqliteStore } from '@/db';
import type { Store } from '@/db';
import { approveDraft, editDraft, generateDraft, viewDraft } from './drafts';

const NOW = new Date('2026-03-10T18:00:00Z');

function lateShipment(): Shipment {
  return {
    id: 'fx-1001',
    reference: 'FX-1001',
    customer: 'Acme Freight',
    carrier: 'Example Carrier LLC',
    pickupWindow: { start: '2026-03-10T08:00:00Z', end: '2026-03-10T10:00:00Z' },
    deliveryWindow: { start: '2026-03-11T08:00:00Z', end: '2026-03-11T16:00:00Z' },
    events: [],
    documents: [],
  };
}

async function setup(): Promise<{ store: Store; c: ExceptionCase }> {
  const store = openSqliteStore(':memory:');
  const s = lateShipment();
  await store.upsertShipments([s]);
  const cases = evaluateShipments([s], NOW);
  const c = cases.find((x) => x.ruleId === 'LATE-PU');
  assert.ok(c, 'sample shipment should produce a LATE-PU case');
  await store.saveCases(cases);
  return { store, c };
}

test('generateDraft without a model uses the template, stores it unapproved and marks the case drafted', async () => {
  const { store, c } = await setup();
  const v = await generateDraft(store, c.id, null, NOW);
  assert.equal(v.draft.origin, 'template');
  assert.equal(v.draft.approved, false);
  assert.deepEqual(v.violations, []);
  assert.ok(v.draft.body.length > 0);
  assert.equal((await store.getCase(c.id))?.status, 'drafted');
  assert.deepEqual((await viewDraft(store, c))?.draft, v.draft);
  await store.close();
});

test('a model draft with an invented time falls back to the template and says why', async () => {
  const { store, c } = await setup();
  const llm = new FakeLlmClient(() =>
    JSON.stringify({ subject: 'Where is FX-1001?', body: 'Please confirm pickup by 3:45 PM today for FX-1001. We will pay $9,999.00 extra.' }),
  );
  const v = await generateDraft(store, c.id, llm, NOW);
  assert.equal(v.draft.origin, 'template');
  assert.ok(v.fallbackReasons.length > 0);
  assert.ok(!v.draft.body.includes('9,999'));
  await store.close();
});

test('editDraft saves text even with violations, clears approval and reports them; approve is refused until fixed', async () => {
  const { store, c } = await setup();
  const gen = await generateDraft(store, c.id, null, NOW);
  const ok = await approveDraft(store, c.id, NOW);
  assert.equal(ok.draft.approved, true);
  assert.ok(ok.draft.approvedAt);

  const bad = await editDraft(store, c.id, gen.draft.subject, gen.draft.body + '\nPlease be there by 11:11 PM and we pay $777.00.', NOW);
  assert.equal(bad.draft.approved, false);
  assert.ok(bad.violations.length > 0);
  assert.ok((await store.getDraft(c.id))?.body.includes('777'));
  await assert.rejects(() => approveDraft(store, c.id, NOW), /Cannot approve/);

  const fixed = await editDraft(store, c.id, gen.draft.subject, gen.draft.body, NOW);
  assert.deepEqual(fixed.violations, []);
  assert.equal((await approveDraft(store, c.id, NOW)).draft.approved, true);
  await store.close();
});

test('draft operations on unknown case or missing draft fail cleanly', async () => {
  const { store, c } = await setup();
  await assert.rejects(() => generateDraft(store, 'nope', null, NOW), /Case not found/);
  await assert.rejects(() => editDraft(store, c.id, 's', 'b', NOW), /no draft/i);
  await assert.rejects(() => approveDraft(store, c.id, NOW), /no draft/i);
  await store.close();
});

test('a draft goes stale when the case facts change later, cannot be approved until regenerated, and the person is told why', async () => {
  const { store, c } = await setup();
  const first = await generateDraft(store, c.id, null, NOW);
  assert.equal(first.stale, false);
  assert.deepEqual(first.violations, []);

  // Two minutes later the rules are re-run: same exception, but "as of" and the overdue time moved on.
  const later = new Date(NOW.getTime() + 2 * 60_000);
  const s = lateShipment();
  const rerun = evaluateShipments([s], later).find((x) => x.ruleId === 'LATE-PU');
  assert.ok(rerun);
  await store.saveCases([rerun]);
  const current = (await store.getCase(c.id))!;
  assert.notEqual(current.facts.asOf, c.facts.asOf);

  const seen = await viewDraft(store, current);
  assert.equal(seen?.stale, true, 'unedited draft must be flagged as out of date');
  await assert.rejects(approveDraft(store, c.id, later), (e: unknown) => (e as { status?: number }).status === 409 && /out of date|changed since/i.test((e as Error).message));

  const fresh = await generateDraft(store, c.id, null, later);
  assert.equal(fresh.stale, false);
  assert.deepEqual(fresh.violations, []);
  const approved = await approveDraft(store, c.id, later);
  assert.equal(approved.draft.approved, true);
  await store.close();
});
