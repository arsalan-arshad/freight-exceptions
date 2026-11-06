// DEFECT TESTS (fail today): web-layer hardening gaps. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSameOrigin } from '../../src/app/lib/http';
import { readConfig } from '../../src/app/lib/config';
import { openSqliteStore } from '../../src/db/index';

test('DEFECT-26 (Medium): DNS rebinding passes the "same origin" check because Origin is only compared with the attacker-controlled Host', () => {
  const req = new Request('http://evil.test:3000/api/reset', { method: 'POST', headers: { host: 'evil.test:3000', origin: 'http://evil.test:3000' } });
  assert.throws(() => assertSameOrigin(req), 'a request whose Host is not localhost / a configured host must be refused when it reaches a local server');
});

test('DEFECT-27 (Low): an unrecognised DEMO_MODE value silently turns demo mode OFF (uploads and the model enabled on a public demo)', () => {
  for (const v of ['enabled', 'y', 'ture', 'yes please']) {
    const cfg = readConfig({ DEMO_MODE: v });
    assert.equal(cfg.demoMode, true, `DEMO_MODE=${JSON.stringify(v)} is non-empty, not an explicit false, and should not fail open`);
  }
});

test('DEFECT-28 (Low): the SQLite file (customer shipment data) is created readable by group/other (0644 under a normal umask)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fx-adv-'));
  const prev = process.umask(0o022);
  try {
    const store = openSqliteStore(join(dir, 'freight.sqlite'));
    await store.upsertShipments([{ id: 'a', reference: 'A', events: [], documents: [] }]);
    const mode = statSync(join(dir, 'freight.sqlite')).mode & 0o777;
    await store.close();
    assert.equal(mode & 0o077, 0, `mode is ${mode.toString(8)}`);
  } finally { process.umask(prev); rmSync(dir, { recursive: true, force: true }); }
});
