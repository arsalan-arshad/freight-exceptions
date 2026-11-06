import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEml, parseEmailDate, MAX_BODY_CHARS } from './index';

test('simple message with folded headers', () => {
  const raw = 'From: Dispatch <dispatch@example.com>\r\nSubject: Load LD-1001\r\n  update\r\nDate: Wed, 04 Mar 2026 10:00:00 -0500\r\n\r\nTruck arrived.\r\nThanks';
  const r = parseEml(raw);
  assert.equal(r.subject, 'Load LD-1001 update');
  assert.equal(r.from, 'Dispatch <dispatch@example.com>');
  assert.equal(r.date, 'Wed, 04 Mar 2026 10:00:00 -0500');
  assert.equal(r.body, 'Truck arrived.\nThanks');
  assert.equal(parseEmailDate(r.date), '2026-03-04T15:00:00Z');
});

test('quoted-printable body with utf-8 and soft line breaks', () => {
  const raw = 'Subject: x\nContent-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: quoted-printable\n\nCaf=C3=A9 delivery at 14:30 =E2=80=93 long line that is=\n continued here=3D ok';
  assert.equal(parseEml(raw).body, 'Café delivery at 14:30 – long line that is continued here= ok');
});

test('base64 body and encoded-word subject', () => {
  const body = Buffer.from('POD attached for LD-1001', 'utf8').toString('base64');
  const subj = `=?UTF-8?B?${Buffer.from('Réf LD-1001', 'utf8').toString('base64')}?=`;
  const raw = `Subject: ${subj}\nContent-Transfer-Encoding: base64\n\n${body}\n`;
  const r = parseEml(raw);
  assert.equal(r.body, 'POD attached for LD-1001');
  assert.equal(r.subject, 'Réf LD-1001');
});

test('multipart/alternative picks text/plain; attachments skipped; nested multipart', () => {
  const raw = [
    'Subject: multi',
    'Content-Type: multipart/mixed; boundary="outer"',
    '',
    'preamble ignored',
    '--outer',
    'Content-Type: multipart/alternative; boundary=inner',
    '',
    '--inner',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>HTML version</p>',
    '--inner',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Plain version LD-1001',
    '--inner--',
    '--outer',
    'Content-Type: text/plain; name="pod.txt"',
    'Content-Disposition: attachment; filename="pod.txt"',
    '',
    'ATTACHMENT TEXT',
    '--outer--',
    '',
  ].join('\r\n');
  assert.equal(parseEml(raw).body, 'Plain version LD-1001');
});

test('html-only message is stripped of tags, scripts and entities', () => {
  const raw = 'Content-Type: text/html\n\n<html><head><style>p{color:red}</style></head><body><script>alert(1)</script><p>Load&nbsp;LD-1001 &amp; co</p><div>Delivered<br>today</div></body></html>';
  assert.equal(parseEml(raw).body, 'Load LD-1001 & co\nDelivered\ntoday');
});

test('missing headers: whole text is the body; empty and non-string input are safe', () => {
  const r = parseEml('Hello, the truck is late.\n\nRegards');
  assert.equal(r.body, 'Hello, the truck is late.\n\nRegards');
  assert.equal(r.subject, undefined);
  assert.deepEqual(parseEml(''), { body: '' });
  assert.deepEqual(parseEml(undefined as unknown as string), { body: '' });
  assert.equal(parseEml('From Example Carrier: arrived at dock').body, 'From Example Carrier: arrived at dock');
});

test('huge body is capped at 100k chars and flagged', () => {
  const r = parseEml(`Subject: big\n\n${'x'.repeat(500_000)}`);
  assert.equal(r.body.length, MAX_BODY_CHARS);
  assert.equal(r.truncated, true);
});

test('non-UTF8 bytes and control characters do not crash or leak', () => {
  const raw = 'Content-Type: text/plain; charset=iso-8859-1\nContent-Transfer-Encoding: quoted-printable\n\nCaf=E9 \u0000 \u0007 end =ZZ';
  const r = parseEml(raw);
  assert.ok(r.body.startsWith('Café'));
  assert.ok(!/[\u0000\u0007]/.test(r.body));
  assert.doesNotThrow(() => parseEml('Content-Type: text/plain; charset=bogus-9\nContent-Transfer-Encoding: base64\n\n!!!notbase64!!!'));
  assert.doesNotThrow(() => parseEml('Content-Type: multipart/mixed\n\nno boundary'));
  assert.doesNotThrow(() => parseEml('Content-Type: multipart/mixed; boundary=x\n\n--x\n--x\n--x\n'));
});

test('parseEmailDate rejects dates without a zone', () => {
  assert.equal(parseEmailDate('Wed, 04 Mar 2026 10:00:00'), undefined);
  assert.equal(parseEmailDate('garbage'), undefined);
  assert.equal(parseEmailDate(undefined), undefined);
  assert.equal(parseEmailDate('Wed, 04 Mar 2026 10:00:00 GMT'), '2026-03-04T10:00:00Z');
});
