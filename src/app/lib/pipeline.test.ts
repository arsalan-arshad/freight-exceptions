import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeLlmClient } from '@/ai';
import { generateSampleCsv, generateSampleEmails, generateSyntheticShipments } from '@/fixtures';
import { openSqliteStore } from '@/db';
import type { Shipment } from '@/core/types';
import { applyEmailItems, importCsv, importEmail, loadSample, refreshCases } from './pipeline';

const NOW = new Date('2026-03-10T18:00:00Z');

test('loadSample stores synthetic shipments and produces cases; loading twice is idempotent', async () => {
  const store = openSqliteStore(':memory:');
  const first = await loadSample(store, NOW);
  assert.equal(first.shipmentsLoaded, generateSyntheticShipments(NOW).length);
  assert.ok(first.refresh.casesDetected > 0, 'demo data should show exceptions');
  assert.equal(first.refresh.newCases, first.refresh.casesDetected);
  assert.equal((await store.listShipments()).length, first.shipmentsLoaded);
  const second = await loadSample(store, NOW);
  assert.equal(second.refresh.newCases, 0);
  assert.equal(second.refresh.casesDetected, first.refresh.casesDetected);
  assert.deepEqual(second.refresh.autoResolved, []);
  await store.close();
});

test('importCsv parses the sample CSV, reports counts and merges on re-import', async () => {
  const store = openSqliteStore(':memory:');
  const csv = generateSampleCsv(NOW);
  const a = await importCsv(store, csv, NOW, 'sample.csv');
  assert.ok(a.rowsParsed > 0);
  assert.equal(a.added, a.rowsParsed);
  assert.equal(a.updated, 0);
  assert.ok(a.refresh.casesDetected > 0);
  const b = await importCsv(store, csv, NOW, 'sample.csv');
  assert.equal(b.added, 0);
  assert.equal(b.updated, a.rowsParsed);
  assert.equal(b.refresh.newCases, 0);
  assert.equal((await store.listShipments()).length, a.rowsParsed);
  await store.close();
});

test('importCsv with hostile or broken input returns issues and never throws', async () => {
  const store = openSqliteStore(':memory:');
  const r = await importCsv(store, 'reference,carrier\n,\n"unterminated,x\n', NOW, '../../etc/passwd');
  assert.ok(Array.isArray(r.issues));
  const r2 = await importCsv(store, 'not,a,shipments,file\n1,2,3,4\n', NOW, 'x.csv');
  assert.equal(r2.rowsParsed, 0);
  assert.ok(r2.issues.length > 0);
  await store.close();
});

test('cases whose condition cleared are marked resolved and reported; dismissed stays dismissed', async () => {
  const store = openSqliteStore(':memory:');
  const s: Shipment = {
    id: 'fx-1',
    reference: 'FX-1',
    carrier: 'Example Carrier LLC',
    pickupWindow: { start: '2026-03-10T08:00:00Z', end: '2026-03-10T10:00:00Z' },
    events: [],
    documents: [],
  };
  await store.upsertShipments([s]);
  const r1 = await refreshCases(store, NOW);
  assert.equal(r1.casesDetected, 1);
  const id = (await store.listCases())[0]!.id;
  assert.equal((await store.getCase(id))?.status, 'open');

  // New data: the truck did pick up. The late-pickup condition no longer holds.
  await store.upsertShipments([
    {
      ...s,
      events: [{ id: 'fx-1:picked_up', type: 'picked_up', at: '2026-03-10T09:30:00Z', stop: 'pickup', source: { kind: 'manual', ref: 'test' } }],
    },
  ]);
  const r2 = await refreshCases(store, NOW);
  assert.equal(r2.autoResolved.length, 1);
  assert.equal(r2.autoResolved[0]!.id, id);
  assert.equal((await store.getCase(id))?.status, 'resolved');
  // Running again reports nothing new to resolve.
  assert.deepEqual((await refreshCases(store, NOW)).autoResolved, []);
  await store.close();

  const store2 = openSqliteStore(':memory:');
  await store2.upsertShipments([s]);
  await refreshCases(store2, NOW);
  await store2.setCaseStatus(id, 'dismissed');
  const r3 = await refreshCases(store2, NOW);
  assert.deepEqual(r3.autoResolved, []);
  assert.equal((await store2.getCase(id))?.status, 'dismissed');
  await store2.close();
});

test('importEmail without a model stores nothing and says why', async () => {
  const store = openSqliteStore(':memory:');
  await importCsv(store, generateSampleCsv(NOW), NOW, 'sample.csv');
  const before = JSON.stringify(await store.listShipments());
  const r = await importEmail(store, generateSampleEmails(NOW)[2]!.raw, null, NOW);
  assert.equal(r.stored, false);
  assert.match(r.message, /needs a model/i);
  assert.equal(JSON.stringify(await store.listShipments()), before);
  await store.close();
});

const POD_QUOTE = 'The signed proof of delivery for LD-7005 is attached.';
const podLlm = () =>
  new FakeLlmClient(() =>
    JSON.stringify([
      { field: 'reference', value: 'LD-7005', quote: POD_QUOTE },
      { field: 'podAttached', value: true, quote: POD_QUOTE },
      { field: 'invoiceAmount', value: 4242, quote: 'amount due 4242 dollars' }, // invented: must be rejected
    ]),
  );

test('importEmail is a PREVIEW: it reports proposals and stores nothing', async () => {
  const store = openSqliteStore(':memory:');
  await importCsv(store, generateSampleCsv(NOW), NOW, 'sample.csv');
  const before = JSON.stringify(await store.listShipments());
  const casesBefore = JSON.stringify(await store.listCases());
  const r = await importEmail(store, generateSampleEmails(NOW)[2]!.raw, podLlm(), NOW);
  assert.equal(r.stored, false);
  assert.equal(r.matchedReference, 'LD-7005');
  assert.equal(r.needsReview, true);
  assert.equal(r.confirmationRequired, true);
  assert.ok(r.accepted.some((a) => a.field === 'podAttached'));
  assert.ok(r.rejected.some((x) => x.field === 'invoiceAmount'));
  assert.match(r.message, /nothing is stored yet/i);
  assert.equal(JSON.stringify(await store.listShipments()), before);
  assert.equal(JSON.stringify(await store.listCases()), casesBefore);
  await store.close();
});

test('applyEmailItems re-verifies, refuses flagged emails without explicit confirmation, then attaches to the existing shipment', async () => {
  const store = openSqliteStore(':memory:');
  await importCsv(store, generateSampleCsv(NOW), NOW, 'sample.csv');
  const raw = generateSampleEmails(NOW)[2]!.raw;
  const items = [
    { field: 'reference', value: 'LD-7005', quote: POD_QUOTE },
    { field: 'podAttached', value: true, quote: POD_QUOTE },
    { field: 'invoiceAmount', value: 4242, quote: 'amount due 4242 dollars' }, // not in the email
  ];
  const refused = await applyEmailItems(store, raw, items, false, NOW);
  assert.equal(refused.stored, false);
  assert.match(refused.message, /not applied/i);
  assert.ok(!(await store.listShipments()).find((x) => x.reference === 'LD-7005')!.documents.some((d) => d.kind === 'pod'));

  const ok = await applyEmailItems(store, raw, items, true, NOW);
  assert.equal(ok.stored, true, ok.message);
  assert.ok(ok.rejected.some((x) => x.field === 'invoiceAmount'), 'invented value is still rejected by the server-side re-check');
  const ship = (await store.listShipments()).find((x) => x.reference === 'LD-7005')!;
  assert.ok(ship.documents.some((d) => d.kind === 'pod'));
  assert.ok(!ship.documents.some((d) => d.kind === 'invoice'));
  assert.ok(ok.refresh);
  await store.close();
});

test('applyEmailItems does not trust the browser: a forged quote is rejected and nothing attaches', async () => {
  const store = openSqliteStore(':memory:');
  await importCsv(store, generateSampleCsv(NOW), NOW, 'sample.csv');
  const raw = generateSampleEmails(NOW)[2]!.raw;
  const r = await applyEmailItems(
    store,
    raw,
    [
      { field: 'reference', value: 'LD-7005', quote: POD_QUOTE },
      { field: 'deliveredAt', value: '2026-03-10T16:00:00Z', quote: 'delivered yesterday at four' },
    ],
    true,
    NOW,
  );
  assert.ok(r.rejected.some((x) => x.field === 'deliveredAt'));
  const ship = (await store.listShipments()).find((x) => x.reference === 'LD-7005')!;
  assert.ok(!ship.events.some((e) => e.type === 'delivered' && e.id.includes('email')));
  assert.equal((await applyEmailItems(store, raw, [], true, NOW)).stored, false);
  await store.close();
});

test('importEmail never creates a shipment for an unknown reference', async () => {
  const store = openSqliteStore(':memory:');
  await importCsv(store, generateSampleCsv(NOW), NOW, 'sample.csv');
  const n = (await store.listShipments()).length;
  const raw = 'Subject: LD-9999 delivered\nDate: Tue, 10 Mar 2026 17:40:00 +0000\n\nLoad LD-9999 was delivered.';
  const llm = new FakeLlmClient(() => JSON.stringify([{ field: 'reference', value: 'LD-9999', quote: 'Load LD-9999 was delivered.' }]));
  const r = await importEmail(store, raw, llm, NOW);
  assert.equal(r.stored, false);
  assert.equal(r.unmatched, true);
  assert.match(r.message, /never create/i);
  assert.equal((await store.listShipments()).length, n);
  await store.close();
});

test('importEmail survives a failing model', async () => {
  const store = openSqliteStore(':memory:');
  await importCsv(store, generateSampleCsv(NOW), NOW, 'sample.csv');
  const llm = new FakeLlmClient(() => {
    throw new Error('network down');
  });
  const r = await importEmail(store, generateSampleEmails(NOW)[2]!.raw, llm, NOW);
  assert.equal(r.stored, false);
  assert.equal(r.needsReview, true);
  await store.close();
});

test('a data-resolved case re-opens and is reported when the exception returns; a person-resolved one stays resolved', async () => {
  const store = openSqliteStore(':memory:');
  const late = (id: string): Shipment => ({
    id,
    reference: id.toUpperCase(),
    carrier: 'Example Carrier LLC',
    pickupWindow: { start: '2026-03-10T08:00:00Z', end: '2026-03-10T10:00:00Z' },
    events: [],
    documents: [],
  });
  const picked = (s: Shipment): Shipment => ({
    ...s,
    events: [{ id: `${s.id}:picked_up`, type: 'picked_up', at: '2026-03-10T09:30:00Z', stop: 'pickup', source: { kind: 'manual', ref: 't' } }],
  });
  const a = late('fx-a');
  const b = late('fx-b');
  await store.upsertShipments([a, b]);
  await refreshCases(store, NOW);
  await store.setCaseStatus('fx-b:LATE-PU', 'resolved', 'person');
  await store.upsertShipments([picked(a)]);
  const r1 = await refreshCases(store, NOW);
  assert.deepEqual(r1.autoResolved.map((c) => c.id), ['fx-a:LATE-PU']);
  assert.deepEqual(r1.reopened, []);
  assert.equal((await store.getCase('fx-a:LATE-PU'))?.resolvedBy, 'data');

  await store.upsertShipments([a]); // pickup retracted
  const r2 = await refreshCases(store, NOW);
  assert.deepEqual(r2.reopened.map((c) => c.id), ['fx-a:LATE-PU']);
  assert.equal((await store.getCase('fx-a:LATE-PU'))?.status, 'open');
  assert.equal((await store.getCase('fx-b:LATE-PU'))?.status, 'resolved', 'a person resolved this one; the person decides');
  await store.close();
});

test('an empty or header-only CSV reports noDataRows and stores nothing', async () => {
  const store = openSqliteStore(':memory:');
  const r = await importCsv(store, 'reference,carrier,delivery_end\n', NOW, 'empty.csv');
  assert.equal(r.noDataRows, true);
  assert.equal((await store.listShipments()).length, 0);
  await store.close();
});
