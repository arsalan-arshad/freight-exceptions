import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openSqliteStore } from './sqlite';
import type { ExceptionCase, Shipment } from '../core/types';
import type { DraftRecord } from './types';

function shipment(id: string, ref = id.toUpperCase()): Shipment {
  return { id, reference: ref, carrier: 'Example Carrier LLC', events: [], documents: [] };
}

function mkCase(over: Partial<ExceptionCase> = {}): ExceptionCase {
  return {
    id: 'ld-1:LATE-PU',
    shipmentId: 'ld-1',
    ruleId: 'LATE-PU',
    severity: 'high',
    title: 'Pickup 5h overdue',
    summary: 'Pickup is late.',
    facts: { reference: 'LD-1', carrier: 'Example Carrier LLC' },
    evidence: [{ source: 'csv', ref: 'shipments.csv:row 1', excerpt: 'pickup_end=2026-01-01T10:00:00Z' }],
    suggestedNextStep: 'Ask carrier for ETA',
    detectedAt: '2026-01-01T15:00:00Z',
    status: 'open',
    ...over,
  };
}

function mkDraft(caseId: string, over: Partial<DraftRecord> = {}): DraftRecord {
  return {
    caseId,
    subject: 'Subject',
    body: 'Body',
    origin: 'template',
    approved: false,
    createdAt: '2026-01-01T15:00:00Z',
    updatedAt: '2026-01-01T15:00:00Z',
    ...over,
  };
}

test('shipments round trip and upsert replaces', async () => {
  const store = openSqliteStore(':memory:');
  const s = shipment('ld-1');
  s.pickupWindow = { start: '2026-01-01T08:00:00Z', end: '2026-01-01T10:00:00Z' };
  s.agreedRate = { amount: 1250.5, currency: 'USD' };
  await store.upsertShipments([s, shipment('ld-2')]);
  assert.deepEqual(await store.getShipment('ld-1'), s);
  assert.equal((await store.listShipments()).length, 2);
  await store.upsertShipments([{ ...s, carrier: 'Other Carrier' }]);
  assert.equal((await store.getShipment('ld-1'))?.carrier, 'Other Carrier');
  assert.equal((await store.listShipments()).length, 2);
  assert.equal(await store.getShipment('nope'), null);
  await store.close();
});

test('cases round trip', async () => {
  const store = openSqliteStore(':memory:');
  const c = mkCase();
  await store.saveCases([c]);
  assert.deepEqual(await store.getCase(c.id), c);
  assert.deepEqual(await store.listCases(), [c]);
  assert.equal(await store.getCase('missing'), null);
  await store.close();
});

test('saveCases preserves person status and detectedAt but refreshes facts and evidence', async () => {
  const store = openSqliteStore(':memory:');
  await store.saveCases([mkCase()]);
  await store.setCaseStatus('ld-1:LATE-PU', 'dismissed');
  await store.saveCases([
    mkCase({
      title: 'Pickup 9h overdue',
      facts: { reference: 'LD-1', hours: 9 },
      evidence: [{ source: 'event', ref: 'e1', excerpt: 'new' }],
      detectedAt: '2026-02-02T00:00:00Z',
      status: 'open',
    }),
  ]);
  const got = await store.getCase('ld-1:LATE-PU');
  assert.equal(got?.status, 'dismissed');
  assert.equal(got?.title, 'Pickup 9h overdue');
  assert.deepEqual(got?.facts, { reference: 'LD-1', hours: 9 });
  assert.equal(got?.evidence[0]?.ref, 'e1');
  assert.equal(got?.detectedAt, '2026-01-01T15:00:00Z');
  for (const st of ['resolved', 'drafted'] as const) {
    await store.setCaseStatus('ld-1:LATE-PU', st);
    await store.saveCases([mkCase()]);
    assert.equal((await store.getCase('ld-1:LATE-PU'))?.status, st);
  }
  await store.close();
});

test('saveCases does not delete cases missing from the new set', async () => {
  const store = openSqliteStore(':memory:');
  await store.saveCases([mkCase(), mkCase({ id: 'ld-2:NO-POD', shipmentId: 'ld-2', ruleId: 'NO-POD' })]);
  await store.saveCases([mkCase()]);
  assert.equal((await store.listCases()).length, 2);
  await store.close();
});

test('listCases filters by status, status list, rule and shipment; sorted by severity then id', async () => {
  const store = openSqliteStore(':memory:');
  await store.saveCases([
    mkCase({ id: 'b:LATE-DEL', shipmentId: 'b', ruleId: 'LATE-DEL', severity: 'low' }),
    mkCase({ id: 'a:NO-POD', shipmentId: 'a', ruleId: 'NO-POD', severity: 'med' }),
    mkCase({ id: 'c:LATE-PU', shipmentId: 'c', ruleId: 'LATE-PU', severity: 'high' }),
    mkCase({ id: 'a:LATE-PU', shipmentId: 'a', ruleId: 'LATE-PU', severity: 'high' }),
  ]);
  await store.setCaseStatus('b:LATE-DEL', 'resolved');
  assert.deepEqual((await store.listCases()).map((c) => c.id), ['a:LATE-PU', 'c:LATE-PU', 'a:NO-POD', 'b:LATE-DEL']);
  assert.deepEqual((await store.listCases({ status: 'resolved' })).map((c) => c.id), ['b:LATE-DEL']);
  assert.deepEqual((await store.listCases({ status: ['open', 'drafted'] })).length, 3);
  assert.deepEqual((await store.listCases({ status: [] })), []);
  assert.deepEqual((await store.listCases({ ruleId: 'LATE-PU' })).map((c) => c.id), ['a:LATE-PU', 'c:LATE-PU']);
  assert.deepEqual((await store.listCases({ shipmentId: 'a' })).map((c) => c.id), ['a:LATE-PU', 'a:NO-POD']);
  assert.deepEqual((await store.listCases({ shipmentId: 'a', ruleId: 'NO-POD', status: 'open' })).map((c) => c.id), ['a:NO-POD']);
  await store.close();
});

test('filter values are parameterised (injection strings match nothing and damage nothing)', async () => {
  const store = openSqliteStore(':memory:');
  await store.saveCases([mkCase()]);
  assert.deepEqual(await store.listCases({ ruleId: "x' OR '1'='1" }), []);
  assert.deepEqual(await store.listCases({ shipmentId: "'; DROP TABLE cases; --" }), []);
  assert.equal((await store.listCases()).length, 1);
  await store.close();
});

test('setCaseStatus rejects unknown case and invalid status', async () => {
  const store = openSqliteStore(':memory:');
  await assert.rejects(() => store.setCaseStatus('nope', 'resolved'), /not found/);
  await store.saveCases([mkCase()]);
  await assert.rejects(() => store.setCaseStatus('ld-1:LATE-PU', 'bogus' as never), /Invalid/);
  await store.close();
});

test('drafts round trip, overwrite and approval fields', async () => {
  const store = openSqliteStore(':memory:');
  assert.equal(await store.getDraft('x'), null);
  const d = mkDraft('ld-1:LATE-PU');
  await store.saveDraft(d);
  assert.deepEqual(await store.getDraft('ld-1:LATE-PU'), d);
  const approved = mkDraft('ld-1:LATE-PU', { body: 'Edited', approved: true, approvedAt: '2026-01-02T00:00:00Z', origin: 'llm' });
  await store.saveDraft(approved);
  assert.deepEqual(await store.getDraft('ld-1:LATE-PU'), approved);
  await store.close();
});

test('clearAll removes shipments, cases and drafts', async () => {
  const store = openSqliteStore(':memory:');
  await store.upsertShipments([shipment('ld-1')]);
  await store.saveCases([mkCase()]);
  await store.saveDraft(mkDraft('ld-1:LATE-PU'));
  await store.clearAll();
  assert.deepEqual(await store.listShipments(), []);
  assert.deepEqual(await store.listCases(), []);
  assert.equal(await store.getDraft('ld-1:LATE-PU'), null);
  await store.close();
});

test('file store creates parent directory, uses WAL, persists and enforces schema version', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fx-db-'));
  try {
    const path = join(dir, 'nested', 'deeper', 'freight.sqlite');
    const store = openSqliteStore(path);
    await store.upsertShipments([shipment('ld-1')]);
    await store.saveCases([mkCase()]);
    await store.close();
    assert.ok(existsSync(path));

    const raw = new DatabaseSync(path);
    assert.deepEqual((raw.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode, 'wal');
    assert.equal((raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 1);
    raw.close();

    const again = openSqliteStore(path);
    assert.equal((await again.listShipments()).length, 1);
    assert.equal((await again.listCases()).length, 1);
    await again.close();

    const future = new DatabaseSync(path);
    future.exec('PRAGMA user_version = 99');
    future.close();
    assert.throws(() => openSqliteStore(path), /newer than this app supports/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('malformed JSON rows are skipped and do not crash listing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fx-db-'));
  try {
    const path = join(dir, 'freight.sqlite');
    const store = openSqliteStore(path);
    await store.upsertShipments([shipment('ok')]);
    await store.saveCases([mkCase()]);
    await store.saveDraft(mkDraft('ld-1:LATE-PU'));

    const raw = new DatabaseSync(path);
    const t = new Date().toISOString();
    raw.prepare('INSERT INTO shipments (id, reference, data, updated_at) VALUES (?, ?, ?, ?)').run('bad1', 'BAD1', '{not json', t);
    raw.prepare('INSERT INTO shipments (id, reference, data, updated_at) VALUES (?, ?, ?, ?)').run('bad2', 'BAD2', '{"id":"bad2"}', t);
    raw.prepare('INSERT INTO cases (id, shipment_id, rule_id, status, severity_rank, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('bad:LATE-PU', 'bad', 'LATE-PU', 'open', 0, 'null', t);
    raw.prepare('INSERT INTO cases (id, shipment_id, rule_id, status, severity_rank, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('bad2:LATE-PU', 'bad2', 'LATE-PU', 'weird', 0, JSON.stringify(mkCase({ id: 'bad2:LATE-PU' })), t);
    raw.prepare('INSERT INTO drafts (case_id, data, updated_at) VALUES (?, ?, ?)').run('bad-draft', '[[[', t);
    raw.close();

    assert.deepEqual((await store.listShipments()).map((s) => s.id), ['ok']);
    assert.equal(await store.getShipment('bad1'), null);
    assert.deepEqual((await store.listCases()).map((c) => c.id), ['ld-1:LATE-PU']);
    assert.equal(await store.getCase('bad:LATE-PU'), null);
    assert.equal(await store.getDraft('bad-draft'), null);
    assert.ok(await store.getDraft('ld-1:LATE-PU'));
    await store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('close is idempotent', async () => {
  const store = openSqliteStore(':memory:');
  await store.close();
  await store.close();
});

test('setCaseStatus records resolvedBy; data-resolved cases re-open when detected again, person-resolved and dismissed do not', async () => {
  const store = openSqliteStore(':memory:');
  await store.saveCases([mkCase(), mkCase({ id: 'b:NO-POD', shipmentId: 'b', ruleId: 'NO-POD' }), mkCase({ id: 'c:NO-POD', shipmentId: 'c', ruleId: 'NO-POD' })]);
  await store.setCaseStatus('ld-1:LATE-PU', 'resolved', 'data');
  await store.setCaseStatus('b:NO-POD', 'resolved'); // default: a person
  await store.setCaseStatus('c:NO-POD', 'dismissed', 'data'); // dismissal is always a person's
  assert.equal((await store.getCase('ld-1:LATE-PU'))?.resolvedBy, 'data');
  assert.equal((await store.getCase('b:NO-POD'))?.resolvedBy, 'person');
  assert.equal((await store.getCase('c:NO-POD'))?.resolvedBy, 'person');

  await store.saveCases([mkCase(), mkCase({ id: 'b:NO-POD', shipmentId: 'b', ruleId: 'NO-POD' }), mkCase({ id: 'c:NO-POD', shipmentId: 'c', ruleId: 'NO-POD' })]);
  const re = await store.getCase('ld-1:LATE-PU');
  assert.equal(re?.status, 'open');
  assert.equal(re?.resolvedBy, undefined);
  assert.deepEqual((await store.listCases({ status: 'open' })).map((c) => c.id), ['ld-1:LATE-PU']);
  assert.equal((await store.getCase('b:NO-POD'))?.status, 'resolved');
  assert.equal((await store.getCase('b:NO-POD'))?.resolvedBy, 'person');
  assert.equal((await store.getCase('c:NO-POD'))?.status, 'dismissed');

  await store.setCaseStatus('ld-1:LATE-PU', 'drafted');
  assert.equal((await store.getCase('ld-1:LATE-PU'))?.resolvedBy, undefined);
  await store.close();
});

test('database file is created 0600 and new directories 0700 (best effort)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fx-db-'));
  const prev = process.umask(0o022);
  try {
    const path = join(dir, 'newdir', 'freight.sqlite');
    const store = openSqliteStore(path);
    await store.upsertShipments([shipment('ld-1')]);
    assert.equal(statSync(path).mode & 0o077, 0);
    assert.equal(statSync(join(dir, 'newdir')).mode & 0o077, 0);
    await store.close();
  } finally {
    process.umask(prev);
    rmSync(dir, { recursive: true, force: true });
  }
});
