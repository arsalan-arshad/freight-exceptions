import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RULES, evaluateShipments, parseInstant, type RuleId } from '../core';
import { shuffled } from '../core/testkit';
import { SAMPLE_CSV_COLUMNS, generateSampleCsv, generateSampleEmails, generateSyntheticShipments } from './index';

const NOW = new Date('2026-11-06T15:00:00.000Z');
const MIN = 60_000;

/** Expected outcome of the synthetic fixtures under DEFAULT_RULE_CONFIG: case id -> severity. */
const EXPECTED: Record<string, string> = {
  'fx-1001:LATE-PU': 'high',
  'fx-1004:LATE-PU': 'med',
  'fx-1006:LATE-PU': 'med',
  'fx-1007:LATE-DEL': 'high',
  'fx-1008:LATE-DEL': 'med',
  'fx-1011:LATE-DEL': 'low',
  'fx-1014:NO-UPDATE': 'low',
  'fx-1015:NO-POD': 'low',
  'fx-1016:NO-POD': 'high',
  'fx-1019:NO-POD': 'low',
  'fx-1022:NO-UPDATE': 'med',
  'fx-1023:NO-UPDATE': 'high',
  'fx-1025:NO-UPDATE': 'low',
  'fx-1026:NO-UPDATE': 'low',
  'fx-1027:NO-UPDATE': 'high',
  'fx-1027:LATE-DEL': 'med',
  'fx-1028:DETENTION:pickup': 'med',
  'fx-1029:DETENTION:delivery': 'high',
  'fx-1029:LATE-DEL': 'high',
  'fx-1032:DETENTION:pickup': 'low',
  'fx-1036:DETENTION:delivery': 'med',
  'fx-1037:RATE-MISMATCH': 'med',
  'fx-1038:RATE-MISMATCH': 'high',
  'fx-1041:RATE-MISMATCH': 'low',
  'fx-1042:RATE-MISMATCH': 'high',
  'fx-1044:RATE-MISMATCH': 'low',
};

test('synthetic shipments: about 30-50, unique, ids are slugs of the references', () => {
  const ships = generateSyntheticShipments(NOW);
  assert.ok(ships.length >= 30 && ships.length <= 50, `got ${ships.length}`);
  assert.equal(new Set(ships.map((s) => s.id)).size, ships.length);
  assert.equal(new Set(ships.map((s) => s.reference)).size, ships.length);
  for (const s of ships) {
    assert.equal(s.id, s.reference.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    for (const e of s.events) assert.equal(e.source.kind, 'synthetic');
    for (const d of s.documents) assert.equal(d.source.kind, 'synthetic');
  }
});

test('synthetic shipments are deterministic per (now, seed) and the seed never moves the boundaries', () => {
  assert.deepEqual(generateSyntheticShipments(NOW, 1), generateSyntheticShipments(NOW, 1));
  assert.deepEqual(generateSyntheticShipments(NOW, 7), generateSyntheticShipments(NOW, 7));
  assert.notDeepEqual(generateSyntheticShipments(NOW, 1), generateSyntheticShipments(NOW, 2));
  const summarize = (seed: number) => evaluateShipments(generateSyntheticShipments(NOW, seed), NOW).map((c) => `${c.id}=${c.severity}`);
  assert.deepEqual(summarize(2), summarize(1));
  assert.deepEqual(summarize(99), summarize(1));
});

test('synthetic shipments are relative to now', () => {
  const later = new Date(NOW.getTime() + 36 * 3_600_000);
  const a = evaluateShipments(generateSyntheticShipments(NOW), NOW).map((c) => `${c.id}=${c.severity}`);
  const b = evaluateShipments(generateSyntheticShipments(later), later).map((c) => `${c.id}=${c.severity}`);
  assert.deepEqual(a, b);
});

test('fixtures produce at least one case for each of the six rules', () => {
  const cases = evaluateShipments(generateSyntheticShipments(NOW), NOW);
  const seen = new Set<RuleId>(cases.map((c) => c.ruleId));
  for (const r of RULES) assert.ok(seen.has(r.id), `no case for ${r.id}`);
  for (const sev of ['low', 'med', 'high']) assert.ok(cases.some((c) => c.severity === sev), `no ${sev}`);
});

test('fixtures produce exactly the expected cases (positives fire, negatives and boundaries stay quiet)', () => {
  const got: Record<string, string> = {};
  for (const c of evaluateShipments(generateSyntheticShipments(NOW), NOW)) got[c.id] = c.severity;
  assert.deepEqual(got, EXPECTED);
});

test('fixtures: shuffled shipment, event and document order gives identical cases', () => {
  const base = generateSyntheticShipments(NOW);
  const expected = evaluateShipments(base, NOW);
  const scrambled = shuffled(base, 5).map((s) => ({ ...s, events: shuffled(s.events, 3), documents: shuffled(s.documents, 4) }));
  assert.deepEqual(evaluateShipments(scrambled, NOW), expected);
});

test('fixtures contain the intended awkward data (unsorted, duplicate, garbage, future, no-offset)', () => {
  const ships = generateSyntheticShipments(NOW);
  const byRef = (r: string) => ships.find((s) => s.reference === r)!;
  const dup = byRef('FX-1002');
  assert.equal(new Set(dup.events.map((e) => e.id)).size, dup.events.length - 1, 'one duplicated event id');
  const garbage = byRef('FX-1014');
  assert.ok(garbage.events.some((e) => parseInstant(e.at) === null));
  assert.ok(garbage.events.some((e) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(e.at)), 'a timestamp with no offset');
  assert.ok(byRef('FX-1026').events.some((e) => (parseInstant(e.at)?.ms ?? 0) > NOW.getTime()), 'a future event');
  assert.equal(byRef('FX-1005').pickupWindow, undefined);
  assert.equal(byRef('FX-1043').agreedRate, undefined);
  assert.ok(ships.some((s) => s.pickupWindow?.end.endsWith('+05:30')), 'non-UTC offsets are used');
});

test('every time shown in cases is "YYYY-MM-DD HH:mm UTC" (no ISO T/offset strings in facts, titles, summaries, evidence)', () => {
  const cases = evaluateShipments(generateSyntheticShipments(NOW), NOW);
  const TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/;
  let times = 0;
  for (const c of cases) {
    for (const [k, v] of Object.entries(c.facts)) {
      if (typeof v !== 'string') continue;
      if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
        times++;
        assert.match(v, TIME, `${c.id}.${k}`);
      }
    }
    const text = [c.title, c.summary, ...c.evidence.map((e) => e.excerpt)].join(' | ');
    assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}T\d{2}:/, `${c.id} shows an ISO timestamp`);
    assert.doesNotMatch(text, /[+-]\d{2}:\d{2}\b/, `${c.id} shows an offset`);
    if (c.ruleId === 'DETENTION') {
      assert.ok(c.title.includes(String(c.facts.overFreeTimeText)), c.id);
      assert.ok(c.summary.includes(String(c.facts.dwellText)), c.id);
      assert.ok(c.summary.includes(String(c.facts.freeTimeText)), c.id);
    }
  }
  assert.ok(times > 30);
});

test('fixtures only use fake names', () => {
  const text = JSON.stringify(generateSyntheticShipments(NOW)) + generateSampleCsv(NOW) + generateSampleEmails(NOW).map((e) => e.raw).join('\n');
  const emails = text.match(/[\w.+-]+@[\w.-]+/g) ?? [];
  for (const e of emails) assert.ok(/@(mail\.)?example\.com$/.test(e), `non-example address ${e}`);
});

// ---------------- CSV ----------------

/** Minimal RFC 4180 parser, enough to check the generated text independently of src/ingest. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

const CONTRACT_HEADER =
  'reference,customer,carrier,pickup_start,pickup_end,delivery_start,delivery_end,free_time_minutes,agreed_rate,currency,pickup_arrived_at,picked_up_at,pickup_departed_at,delivery_arrived_at,delivery_departed_at,delivered_at,eta,last_status_at,last_status_note,pod_received_at,invoice_amount,invoice_received_at';

test('generateSampleCsv has exactly the CONTRACT header columns', () => {
  const csv = generateSampleCsv(NOW);
  assert.equal(csv.split('\n')[0], CONTRACT_HEADER);
  assert.deepEqual([...SAMPLE_CSV_COLUMNS], CONTRACT_HEADER.split(','));
  assert.ok(csv.endsWith('\n'));
});

test('generateSampleCsv: ~20 well-formed rows, quoted fields with commas, relative ISO times with offsets', () => {
  const csv = generateSampleCsv(NOW);
  const rows = parseCsv(csv);
  assert.equal(rows.length, 21, 'header + 20 rows');
  for (const [i, r] of rows.entries()) assert.equal(r.length, 22, `row ${i} has 22 cells`);
  const header = rows[0] as string[];
  const refs = rows.slice(1).map((r) => r[0]);
  assert.equal(new Set(refs).size, 20);
  assert.ok(csv.includes('"Widget Wholesale, Co."'));
  assert.ok(csv.includes('"Driver said, ""ETA 6pm, maybe later"""'));
  const timeCols = header.filter((h) => /(_start|_end|_at)$/.test(h) || h === 'eta');
  for (const r of rows.slice(1)) {
    for (const col of timeCols) {
      const v = r[header.indexOf(col)] as string;
      if (v !== '') assert.ok(parseInstant(v), `${r[0]} ${col}=${v}`);
    }
  }
  const first = rows[1] as string[];
  assert.equal(first[0], 'LD-7001');
  assert.equal(parseInstant(first[header.indexOf('pickup_end')] as string)?.ms, NOW.getTime() - 360 * MIN);
  assert.deepEqual(generateSampleCsv(NOW), csv, 'deterministic');
  assert.notEqual(generateSampleCsv(new Date(NOW.getTime() + 3_600_000)), csv, 'moves with now');
});

// ---------------- Emails ----------------

test('generateSampleEmails: 6 fake .eml texts, each mentioning a reference from the sample CSV', () => {
  const refs = parseCsv(generateSampleCsv(NOW)).slice(1).map((r) => r[0] as string);
  const mails = generateSampleEmails(NOW);
  assert.equal(mails.length, 6);
  assert.equal(new Set(mails.map((m) => m.id)).size, 6);
  for (const m of mails) {
    for (const h of ['Message-ID:', 'Date:', 'From:', 'To:', 'Subject:']) assert.ok(m.raw.includes(`\n${h}`) || m.raw.startsWith(h), `${m.id} lacks ${h}`);
    assert.ok(m.raw.includes('\n\n'), 'blank line between headers and body');
    const mentioned = refs.filter((r) => m.raw.includes(r));
    assert.ok(mentioned.length >= 1, `${m.id} mentions no CSV reference`);
    assert.ok(/From: .*@example\.com/.test(m.raw));
    assert.ok(/To: .*@example\.com/.test(m.raw));
    assert.ok(parseInstant(new Date(/Date: (.*)/.exec(m.raw)?.[1] ?? '').toISOString()), 'Date header parses');
  }
  assert.deepEqual(generateSampleEmails(NOW), mails, 'deterministic');
});

test('generateSampleEmails: covers ETA, delivery, POD, invoice, a time without timezone, and nothing-extractable', () => {
  const byId = Object.fromEntries(generateSampleEmails(NOW).map((m) => [m.id, m.raw]));
  assert.match(byId['msg-0001'] as string, /new ETA/i);
  assert.match(byId['msg-0001'] as string, /UTC-05:00/);
  assert.match(byId['msg-0002'] as string, /delivered/i);
  assert.match(byId['msg-0003'] as string, /proof of delivery.*attached/i);
  assert.match(byId['msg-0004'] as string, /\$1,185\.00 USD/);
  const noTz = byId['msg-0005'] as string;
  assert.match(noTz, /2:15 PM/);
  assert.doesNotMatch(noTz.split('\n\n').slice(1).join('\n\n'), /UTC|[+-]\d{2}:\d{2}|\bE[SD]T\b|\bCST\b/, 'body has no timezone');
  const empty = (byId['msg-0006'] as string).split('\n\n').slice(1).join('\n\n');
  assert.doesNotMatch(empty.replace('LD-7003', ''), /\d/, 'no digits, so nothing to extract besides the reference');
});
