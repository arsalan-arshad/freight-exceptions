import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCents, formatDuration, formatInstant, formatUtc, toCents } from './format';
import { parseInstant, parseWindow } from './time';

test('parseInstant accepts Z and numeric offsets and compares instants', () => {
  const a = parseInstant('2026-11-06T15:00:00Z');
  const b = parseInstant('2026-11-06T20:30:00+05:30');
  const c = parseInstant('2026-11-06T07:00:00-08:00');
  const d = parseInstant('2026-11-06T16:00:00+0100');
  assert.ok(a && b && c && d);
  assert.equal(a.ms, b.ms);
  assert.equal(a.ms, c.ms);
  assert.equal(a.ms, d.ms);
  assert.equal(b.offsetMinutes, 330);
  assert.equal(c.offsetMinutes, -480);
});

test('parseInstant rejects garbage, timezone-less and impossible dates (never throws)', () => {
  for (const bad of [
    '',
    'not-a-date',
    'yesterday',
    '2026-11-06T15:00:00',
    '2026-11-06',
    '2026-13-45T10:00:00Z',
    '2026-02-30T10:00:00Z',
    '2026-11-06T25:00:00Z',
    '2026-11-06T10:61:00Z',
    '2026-11-06T10:00:00+25:00',
    null,
    undefined,
    42,
    {},
  ]) {
    assert.equal(parseInstant(bad), null, String(bad));
  }
  assert.ok(parseInstant('2028-02-29T00:00:00Z'), 'leap day is valid');
  assert.equal(parseInstant('2027-02-29T00:00:00Z'), null);
});

test('parseInstant handles fractional seconds', () => {
  const a = parseInstant('2026-11-06T15:00:00.250Z');
  const b = parseInstant('2026-11-06T15:00:00Z');
  assert.ok(a && b);
  assert.equal(a.ms - b.ms, 250);
});

test('parseWindow: end must parse; start after end is contradictory', () => {
  assert.equal(parseWindow(undefined), null);
  assert.equal(parseWindow({ start: '2026-11-06T10:00:00Z', end: 'junk' }), null);
  assert.equal(parseWindow({ start: '2026-11-06T12:00:00Z', end: '2026-11-06T10:00:00Z' }), null);
  const w = parseWindow({ start: 'junk', end: '2026-11-06T10:00:00Z' });
  assert.ok(w);
  assert.equal(w.startMs, undefined);
});

test('formatInstant writes an explicit offset and round-trips', () => {
  const p = parseInstant('2026-11-06T20:30:00+05:30');
  assert.ok(p);
  assert.equal(formatInstant(p.ms, p.offsetMinutes), '2026-11-06T20:30:00+05:30');
  assert.equal(formatInstant(p.ms, 0), '2026-11-06T15:00:00+00:00');
  assert.equal(formatInstant(p.ms, -300), '2026-11-06T10:00:00-05:00');
});

test('formatDuration and money formatting', () => {
  assert.equal(formatDuration(0), '0m');
  assert.equal(formatDuration(45), '45m');
  assert.equal(formatDuration(300), '5h');
  assert.equal(formatDuration(310), '5h 10m');
  assert.equal(formatCents(125000, 'USD'), '1,250.00 USD');
  assert.equal(formatCents(5, 'USD'), '0.05 USD');
  assert.equal(formatCents(-6000, 'USD', true), '-60.00 USD');
  assert.equal(formatCents(6000, 'USD', true), '+60.00 USD');
  assert.equal(formatCents(123456789, 'CAD'), '1,234,567.89 CAD');
});

test('toCents is float-safe', () => {
  assert.equal(toCents(1000.6) - toCents(1000.1), 50);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents(1.005), 101);
  assert.equal(toCents(-12.34), -1234);
  assert.equal(toCents(0.5), 50);
});

test('formatUtc renders equal instants identically as "YYYY-MM-DD HH:mm UTC"', () => {
  const inputs = ['2026-11-05T16:57:10+00:00', '2026-11-05T22:27:10+05:30', '2026-11-05T08:57:10-08:00', '2026-11-05T17:57:59+01:00'];
  for (const i of inputs) {
    const p = parseInstant(i);
    assert.ok(p);
    assert.equal(formatUtc(p.ms), '2026-11-05 16:57 UTC', i);
  }
  assert.equal(formatUtc(parseInstant('2026-01-02T03:04:00Z')!.ms), '2026-01-02 03:04 UTC');
  assert.equal(formatUtc(parseInstant('2026-12-31T23:59:59-05:00')!.ms), '2027-01-01 04:59 UTC');
});

test('formatDuration uses days from 48h', () => {
  assert.equal(formatDuration(312), '5h 12m');
  assert.equal(formatDuration(47 * 60 + 59), '47h 59m');
  assert.equal(formatDuration(48 * 60), '2d');
  assert.equal(formatDuration(51 * 60 + 30), '2d 3h');
});
