import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShipmentsCsv, parseCsvRecords } from './index';

const H =
  'reference,customer,carrier,pickup_start,pickup_end,delivery_start,delivery_end,free_time_minutes,agreed_rate,currency,pickup_arrived_at,picked_up_at,pickup_departed_at,delivery_arrived_at,delivery_departed_at,delivered_at,eta,last_status_at,last_status_note,pod_received_at,invoice_amount,invoice_received_at';

test('parseCsvRecords: quotes, escaped quotes, newlines in quotes, CRLF, BOM', () => {
  const r = parseCsvRecords('﻿a,b\r\n"x,1","he said ""hi"""\r\n"line1\nline2",z\r\n');
  assert.deepEqual(r.records, [
    ['a', 'b'],
    ['x,1', 'he said "hi"'],
    ['line1\nline2', 'z'],
  ]);
  assert.equal(r.unterminatedQuote, false);
});

test('parseCsvRecords: unterminated quote is flagged, never throws', () => {
  const r = parseCsvRecords('a,b\n"oops,1\n2,3');
  assert.equal(r.unterminatedQuote, true);
});

test('happy path: full row maps to events and documents with stable ids and csv sources', () => {
  const csv = `${H}
LD-1001,Acme Freight,Example Carrier LLC,2026-03-04T08:00:00Z,2026-03-04T10:00:00Z,2026-03-05T08:00:00Z,2026-03-05T12:00:00Z,90,"1,250.00",USD,2026-03-04T08:05:00Z,2026-03-04T09:00:00Z,2026-03-04T09:30:00Z,2026-03-05T11:00:00Z,2026-03-05T13:00:00Z,2026-03-05T12:50:00Z,2026-03-05T14:00:00Z,2026-03-05T10:00:00Z,"driver ""running late""",2026-03-06T09:00:00Z,1250.5,2026-03-07T09:00:00Z
`;
  const { shipments, issues } = parseShipmentsCsv(csv, { sourceName: 'in.csv' });
  assert.equal(issues.length, 0, JSON.stringify(issues));
  assert.equal(shipments.length, 1);
  const s = shipments[0]!;
  assert.equal(s.id, 'ld-1001');
  assert.equal(s.reference, 'LD-1001');
  assert.equal(s.customer, 'Acme Freight');
  assert.deepEqual(s.pickupWindow, { start: '2026-03-04T08:00:00Z', end: '2026-03-04T10:00:00Z' });
  assert.equal(s.freeTimeMinutes, 90);
  assert.deepEqual(s.agreedRate, { amount: 1250, currency: 'USD' });
  const ids = s.events.map((e) => e.id).sort();
  assert.deepEqual(ids, [
    'ld-1001:arrived_delivery',
    'ld-1001:arrived_pickup',
    'ld-1001:delivered',
    'ld-1001:departed_delivery',
    'ld-1001:departed_pickup',
    'ld-1001:eta_update',
    'ld-1001:picked_up',
    'ld-1001:status_update',
  ]);
  const eta = s.events.find((e) => e.type === 'eta_update')!;
  assert.equal(eta.eta, '2026-03-05T14:00:00Z');
  assert.equal(eta.stop, 'delivery');
  assert.equal(eta.at, '2026-03-05T10:00:00Z'); // last_status_at is the report time
  const st = s.events.find((e) => e.type === 'status_update')!;
  assert.equal(st.note, 'driver "running late"');
  assert.deepEqual(s.documents.map((d) => d.id).sort(), ['ld-1001:invoice', 'ld-1001:pod']);
  assert.deepEqual(s.documents.find((d) => d.kind === 'invoice')!.amount, { amount: 1250.5, currency: 'USD' });
  for (const x of [...s.events, ...s.documents]) {
    assert.equal(x.source.kind, 'csv');
    assert.equal(x.source.ref, 'in.csv:row 1');
  }
});

test('no offset => UTC with exactly one summary issue; space-separated times accepted', () => {
  const csv = `reference,pickup_start,pickup_end,picked_up_at
A-1,2026-03-04 08:00,2026-03-04 10:00:30,2026-03-04 09:00
A-2,2026-03-04 08:00,2026-03-04 10:00,2026-03-04T09:00:00-05:00
`;
  const { shipments, issues } = parseShipmentsCsv(csv);
  assert.equal(shipments[0]!.pickupWindow!.start, '2026-03-04T08:00:00Z');
  assert.equal(shipments[0]!.pickupWindow!.end, '2026-03-04T10:00:30Z');
  assert.equal(shipments[1]!.events[0]!.at, '2026-03-04T09:00:00-05:00');
  const utc = issues.filter((i) => /treated as UTC/.test(i.message));
  assert.equal(utc.length, 1);
  assert.match(utc[0]!.message, /^5 time value/);
});

test('ambiguous and malformed dates are not guessed: issue + empty field', () => {
  const csv = `reference,picked_up_at,delivered_at,eta,pod_received_at
B-1,03/04/2026,2026-03-04,not a date,2026-02-30T10:00:00Z
`;
  const { shipments, issues } = parseShipmentsCsv(csv);
  const s = shipments[0]!;
  assert.equal(s.events.length, 0);
  assert.equal(s.documents.length, 0);
  assert.match(issues.find((i) => /picked_up_at/.test(i.message))!.message, /ambiguous/);
  assert.match(issues.find((i) => /delivered_at/.test(i.message))!.message, /no time of day/);
  assert.ok(issues.some((i) => /eta/.test(i.message) && /unrecognised/.test(i.message)));
  assert.ok(issues.some((i) => /pod_received_at/.test(i.message) && /invalid calendar date/.test(i.message)));
});

test('header aliases, case-insensitivity and unknown columns', () => {
  const csv = `Load #,PU Start,PU End,DEL_START,del_end,Carrier Name,Free Time,Rate,CCY,Weird Column
 ld 77 ,2026-03-04T08:00:00Z,2026-03-04T10:00:00Z,2026-03-05T08:00:00Z,2026-03-05T12:00:00Z,Example Carrier LLC,120,"$1,100.00",EUR,zzz
`;
  const { shipments, issues } = parseShipmentsCsv(csv);
  const s = shipments[0]!;
  assert.equal(s.reference, 'ld 77');
  assert.equal(s.id, 'ld-77');
  assert.equal(s.carrier, 'Example Carrier LLC');
  assert.equal(s.freeTimeMinutes, 120);
  assert.deepEqual(s.agreedRate, { amount: 1100, currency: 'EUR' });
  assert.ok(s.deliveryWindow);
  assert.ok(issues.some((i) => i.row === 0 && /unknown column/.test(i.message) && /Weird Column/.test(i.message)));
});

test('missing reference column => nothing imported, issue; empty file => issue', () => {
  const r = parseShipmentsCsv('carrier,eta\nX,2026-01-01T00:00:00Z\n');
  assert.equal(r.shipments.length, 0);
  assert.match(r.issues[0]!.message, /no reference column/);
  const e = parseShipmentsCsv('');
  assert.equal(e.shipments.length, 0);
  assert.match(e.issues[0]!.message, /empty/);
  const e2 = parseShipmentsCsv('﻿\r\n\r\n');
  assert.equal(e2.shipments.length, 0);
});

test('rows without a reference are skipped with an issue; blank lines ignored; ragged rows flagged', () => {
  const csv = 'reference,carrier,eta\r\n\r\n,Nobody,\r\nR-1,Example Carrier LLC\r\n   ,,\r\nR-2,A,B,C,D\r\n';
  const { shipments, issues } = parseShipmentsCsv(csv);
  assert.deepEqual(shipments.map((s) => s.reference), ['R-1', 'R-2']);
  assert.ok(issues.some((i) => i.row === 1 && /no usable reference/.test(i.message)));
  assert.ok(issues.some((i) => i.row === 2 && /missing cells treated as empty/.test(i.message)));
  assert.ok(issues.some((i) => i.row === 3 && /extra cells ignored/.test(i.message)));
});

test('duplicate references are merged: first row wins, blanks filled, conflict reported', () => {
  const csv = `reference,carrier,customer,picked_up_at
LD-9,First Carrier,,2026-03-04T09:00:00Z
ld 9,Second Carrier,Acme Freight,2026-03-04T10:00:00Z
`;
  const { shipments, issues } = parseShipmentsCsv(csv);
  assert.equal(shipments.length, 1);
  const s = shipments[0]!;
  assert.equal(s.carrier, 'First Carrier');
  assert.equal(s.customer, 'Acme Freight');
  assert.equal(s.events.length, 1);
  assert.equal(s.events[0]!.at, '2026-03-04T09:00:00Z');
  const dup = issues.find((i) => /duplicate reference/.test(i.message))!;
  assert.equal(dup.row, 2);
  assert.match(dup.message, /carrier/);
  assert.match(dup.message, /picked_up/);
});

test('CSV injection: cells starting with = + - @ are kept verbatim, with an informational issue', () => {
  const csv = `reference,customer,carrier,last_status_at,last_status_note
=HYPERLINK("http://example.com"),+cmd|' /C calc'!A0,@SUM(1+1),2026-03-04T09:00:00Z,-2+3
`;
  const { shipments, issues } = parseShipmentsCsv(csv);
  const s = shipments[0]!;
  assert.equal(s.reference, '=HYPERLINK("http://example.com")');
  assert.equal(s.customer, "+cmd|' /C calc'!A0");
  assert.equal(s.carrier, '@SUM(1+1)');
  assert.equal(s.events[0]!.note, '-2+3');
  assert.equal(issues.filter((i) => /never evaluated/.test(i.message)).length, 4);
});

test('currency: blank defaults to USD with one summary issue; inline code/symbol used; conflicts rejected', () => {
  const csv = `reference,agreed_rate,currency,invoice_amount,invoice_received_at
C-1,1000,,1000,2026-03-04T09:00:00Z
C-2,"EUR 1.250,50",,,
C-3,"€850,50",,,
C-4,500,GBP,USD 500,2026-03-04T09:00:00Z
`;
  const { shipments, issues } = parseShipmentsCsv(csv);
  assert.deepEqual(shipments[0]!.agreedRate, { amount: 1000, currency: 'USD' });
  assert.deepEqual(shipments[0]!.documents[0]!.amount, { amount: 1000, currency: 'USD' });
  assert.deepEqual(shipments[1]!.agreedRate, { amount: 1250.5, currency: 'EUR' });
  assert.deepEqual(shipments[2]!.agreedRate, { amount: 850.5, currency: 'EUR' });
  const usd = issues.filter((i) => /assumed "USD"/.test(i.message));
  assert.equal(usd.length, 1);
  assert.match(usd[0]!.message, /2 amount/);
  // C-4: GBP column vs USD in cell => invoice amount rejected, but the invoice doc (with received time) still exists without amount
  const c4 = shipments.find((s) => s.reference === 'C-4')!;
  assert.deepEqual(c4.agreedRate, { amount: 500, currency: 'GBP' });
  assert.equal(c4.documents[0]!.amount, undefined);
  assert.ok(issues.some((i) => /USD but currency column says GBP/.test(i.message)));
});

test('invalid numbers and orphan values produce issues, not throws', () => {
  const csv = `reference,free_time_minutes,agreed_rate,invoice_amount,last_status_note,eta
D-1,abc,1.250,12.00,orphan note,2026-03-05T14:00:00Z
D-2,,,-5,,
`;
  const { shipments, issues } = parseShipmentsCsv(csv);
  const d1 = shipments[0]!;
  assert.equal(d1.freeTimeMinutes, undefined);
  assert.equal(d1.agreedRate, undefined);
  assert.ok(issues.some((i) => /free_time_minutes/.test(i.message)));
  assert.ok(issues.some((i) => /agreed_rate/.test(i.message) && /ambiguous/.test(i.message)));
  assert.ok(issues.some((i) => /invoice_amount without invoice_received_at/.test(i.message)));
  assert.ok(issues.some((i) => /last_status_note has no last_status_at/.test(i.message)));
  assert.ok(issues.some((i) => /eta given but no/.test(i.message)));
  assert.ok(issues.some((i) => /negative amounts/.test(i.message)));
});

test('semicolon delimited files (European exports) are detected', () => {
  const csv = 'Load number;Carrier;Rate;Currency\nE-1;Example Carrier LLC;1.250,00;EUR\n';
  const { shipments, issues } = parseShipmentsCsv(csv);
  assert.deepEqual(shipments[0]!.agreedRate, { amount: 1250, currency: 'EUR' });
  assert.ok(issues.some((i) => /delimiter ";" detected/.test(i.message)));
});

test('window with only one end or end before start is dropped with an issue', () => {
  const csv = `reference,pickup_start,pickup_end,delivery_start,delivery_end
F-1,2026-03-04T08:00:00Z,,2026-03-05T12:00:00Z,2026-03-05T08:00:00Z
`;
  const { shipments, issues } = parseShipmentsCsv(csv);
  assert.equal(shipments[0]!.pickupWindow, undefined);
  assert.equal(shipments[0]!.deliveryWindow, undefined);
  assert.equal(issues.filter((i) => i.row === 1).length, 2);
});

test('eta without any report time is dropped; eta falls back to latest event time otherwise', () => {
  const csv = `reference,picked_up_at,eta
G-1,2026-03-04T09:00:00Z,2026-03-05T14:00:00Z
G-2,,2026-03-05T14:00:00Z
`;
  const { shipments, issues } = parseShipmentsCsv(csv);
  const e = shipments[0]!.events.find((x) => x.type === 'eta_update')!;
  assert.equal(e.at, '2026-03-04T09:00:00Z');
  assert.equal(shipments[1]!.events.length, 0);
  assert.ok(issues.some((i) => /eta given but no/.test(i.message)));
  assert.ok(issues.some((i) => /no last_status_at/.test(i.message)));
});

test('garbage input never throws', () => {
  for (const input of ['\u0000\u0001', '"""', ',,,,\n,,,', 'reference\n"unterminated', 'a'.repeat(100000), null as unknown as string, undefined as unknown as string]) {
    assert.doesNotThrow(() => parseShipmentsCsv(input));
  }
});

test('deterministic: same input gives identical output', () => {
  const csv = `reference,picked_up_at,eta,last_status_at\nX-1,2026-03-04 09:00,2026-03-05 10:00,2026-03-04 12:00\nX-2,2026-03-04 09:00,,\n`;
  assert.deepEqual(parseShipmentsCsv(csv), parseShipmentsCsv(csv));
});
