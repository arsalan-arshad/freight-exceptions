// Pathological inputs must finish fast (linear-time HTML and header handling).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, parseEml } from './index';

const ms = (f: () => unknown) => {
  const s = performance.now();
  f();
  return performance.now() - s;
};

const CASES: Array<[string, () => unknown]> = [
  ['"<" x 100k', () => htmlToText('<'.repeat(100_000))],
  ['unclosed <script x 20k', () => htmlToText('<script '.repeat(20_000))],
  ['unclosed comments in a text/html email', () => parseEml('Content-Type: text/html\n\n' + '<!--'.repeat(25_000))],
  ['<a x 50k without >', () => htmlToText('<a'.repeat(50_000))],
  ['<a> x 33k', () => htmlToText('<a>'.repeat(33_000))],
  ['unclosed <head x 16k', () => htmlToText('<head '.repeat(16_000))],
  ['entity-like "&a" x 50k', () => htmlToText('&a'.repeat(50_000))],
  ['"&" + 99k letters', () => htmlToText('&' + 'a'.repeat(99_000))],
  ['encoded-word soup in Subject', () => parseEml('Subject: ' + '=?a?b?'.repeat(30_000) + '\n\nx')],
  ['parameter soup in Content-Type', () => parseEml('Content-Type: ' + ';a'.repeat(40_000) + '\n\nx')],
  ['quoted-printable "=" x 100k', () => parseEml('Content-Transfer-Encoding: quoted-printable\n\n' + '='.repeat(100_000))],
  ['whitespace between encoded words', () => parseEml('Subject: =?utf-8?q?a?=' + ' '.repeat(100_000) + '=?utf-8?q?b?=\n\nx')],
];

for (const [name, f] of CASES) {
  test(`linear time: ${name}`, () => {
    const t = ms(f);
    assert.ok(t < 500, `took ${t.toFixed(0)} ms`);
  });
}

test('htmlToText still converts normal markup after the rewrite', () => {
  assert.equal(htmlToText('<html><head><title>x</title></head><body><p>a &amp; b</p><div>c<br>d</div><!-- hidden --><style>p{}</style>1 < 2 and 3 > 2</body></html>'), 'a & b\nc\nd\n1 < 2 and 3 > 2');
  assert.equal(htmlToText('keep <script>evil()</script>this'), 'keep this');
  assert.equal(htmlToText('before<script>never closed'), 'before');
});

test('htmlToText caps the processed input at about 100 KB', () => {
  const out = htmlToText('a'.repeat(250_000));
  assert.ok(out.length <= 100_000);
});
