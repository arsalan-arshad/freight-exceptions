// DEFECT TEST (fails today): quadratic regexes in the HTML-to-text step can freeze the Node event loop.
// Reachable from POST /api/import/email even when NO model is configured (parseEml runs before the "no model" check).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, parseEml } from '../../src/ingest/index';

const timed = (fn: () => unknown) => { const s = performance.now(); fn(); return performance.now() - s; };

test('DEFECT-19 (High): htmlToText("<" x 100,000) must finish well under a second', () => {
  const ms = timed(() => htmlToText('<'.repeat(100_000)));
  assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms (quadratic: doubling the input quadruples the time)`);
});

test('DEFECT-20 (High): htmlToText("<script " x 20,000, never closed) must finish well under a second', () => {
  const ms = timed(() => htmlToText('<script '.repeat(20_000)));
  assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`);
});

test('DEFECT-21 (High): a 100 KB text/html email blocks parseEml for seconds', () => {
  const ms = timed(() => parseEml('Content-Type: text/html\n\n' + '<!--'.repeat(25_000)));
  assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`);
});
