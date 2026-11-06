import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from './env';
import { HttpError, assertSameOrigin, handle, readJsonBody, readTextBody, routeId, str } from './http';

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request('http://localhost:3000/api/x', { method: 'POST', body, headers });

test('readTextBody returns text under the limit', async () => {
  assert.equal(await readTextBody(post('héllo')), 'héllo');
});

test('readTextBody rejects bodies over the limit (streamed, no content-length)', async () => {
  const big = 'a'.repeat(1000);
  await assert.rejects(
    () => readTextBody(post(big), 500),
    (e: unknown) => e instanceof HttpError && e.status === 413,
  );
});

test('readTextBody rejects on declared content-length', async () => {
  await assert.rejects(
    () => readTextBody(post('x', { 'content-length': '999999999' })),
    (e: unknown) => e instanceof HttpError && e.status === 413,
  );
});

test('readJsonBody validates shape', async () => {
  assert.deepEqual(await readJsonBody(post('{"a":1}')), { a: 1 });
  await assert.rejects(() => readJsonBody(post('nope')), /valid JSON/);
  await assert.rejects(() => readJsonBody(post('[1]')), /JSON object/);
  await assert.rejects(() => readJsonBody(post('null')), /JSON object/);
});

test('str validates type, length and emptiness', () => {
  assert.equal(str('ok', 'f', 5), 'ok');
  assert.throws(() => str(3, 'f', 5), /must be a string/);
  assert.throws(() => str('toolong', 'f', 5), /too long/);
  assert.throws(() => str('  ', 'f', 5), /must not be empty/);
  assert.equal(str('', 'f', 5, { allowEmpty: true }), '');
});

test('assertSameOrigin allows GET, no-Origin writes and same-origin; refuses cross-site writes', () => {
  const cfg = readConfig({});
  const mk = (method: string, origin?: string, host = 'localhost:3000') =>
    new Request('http://localhost:3000/api/x', { method, headers: { host, ...(origin ? { origin } : {}) } });
  assert.doesNotThrow(() => assertSameOrigin(mk('GET', 'http://evil.example'), cfg));
  assert.doesNotThrow(() => assertSameOrigin(mk('POST'), cfg));
  assert.doesNotThrow(() => assertSameOrigin(mk('POST', 'http://localhost:3000'), cfg));
  assert.throws(() => assertSameOrigin(mk('POST', 'http://evil.example'), cfg), /Cross-site/);
  assert.throws(() => assertSameOrigin(mk('POST', 'not a url'), cfg), /Cross-site/);
});

test('assertSameOrigin host allow-list: local names pass, rebinding hosts fail unless allowed, protected or demo servers skip it', () => {
  const mk = (host: string) => new Request('http://x/api/x', { method: 'POST', headers: { host, origin: `http://${host}` } });
  const open = readConfig({});
  for (const h of ['localhost:3000', 'LOCALHOST', '127.0.0.1:8080', '[::1]:3000']) assert.doesNotThrow(() => assertSameOrigin(mk(h), open), h);
  for (const h of ['evil.test:3000', '192.168.1.5:3000', 'localhost.evil.test', '127.0.0.1.evil.test']) {
    assert.throws(() => assertSameOrigin(mk(h), open), /not allowed/, h);
  }
  const allowed = readConfig({ ALLOWED_HOSTS: 'fx.lan, other.example:8443' });
  assert.doesNotThrow(() => assertSameOrigin(mk('fx.lan:3000'), allowed));
  assert.doesNotThrow(() => assertSameOrigin(mk('other.example:8443'), allowed));
  assert.throws(() => assertSameOrigin(mk('other.example:9'), allowed), /not allowed/);
  assert.doesNotThrow(() => assertSameOrigin(mk('evil.test:3000'), readConfig({ APP_PASSWORD: 'x' })));
  assert.doesNotThrow(() => assertSameOrigin(mk('demo.example.com'), readConfig({ DEMO_MODE: 'true' })));
  // Origin must still match the Host even when the Host is allowed.
  const cross = new Request('http://x/api/x', { method: 'POST', headers: { host: 'localhost:3000', origin: 'http://localhost:4000' } });
  assert.throws(() => assertSameOrigin(cross, open), /Cross-site/);
});

test('DEMO_MODE fails closed', () => {
  for (const v of ['true', '1', 'yes', 'on', 'enabled', 'ture', 'banana', ' TRUE ']) assert.equal(readConfig({ DEMO_MODE: v }).demoMode, true, v);
  for (const v of ['false', '0', 'no', 'off', 'FALSE', ' Off ', '', '  ']) assert.equal(readConfig({ DEMO_MODE: v }).demoMode, false, JSON.stringify(v));
  assert.equal(readConfig({}).demoMode, false);
});

test('handle sanitises unexpected errors and keeps HttpError messages', async () => {
  const origErr = console.error;
  console.error = () => undefined;
  try {
    const boom = handle(async (_r: Request) => {
      throw new Error('secret path /home/x/key=abc');
    });
    const r1 = await boom(new Request('http://localhost/x'));
    assert.equal(r1.status, 500);
    const b1 = (await r1.json()) as { error: string };
    assert.ok(!b1.error.includes('secret'));
    const nope = handle(async (_r: Request) => {
      throw new HttpError(404, 'Case not found.');
    });
    const r2 = await nope(new Request('http://localhost/x'));
    assert.equal(r2.status, 404);
    assert.deepEqual(await r2.json(), { error: 'Case not found.' });
  } finally {
    console.error = origErr;
  }
});

test('routeId decodes percent-encoding and survives bad input', () => {
  assert.equal(routeId('ld-1%3ALATE-PU'), 'ld-1:LATE-PU');
  assert.equal(routeId('ld-1:LATE-PU'), 'ld-1:LATE-PU');
  assert.equal(routeId('%E0%A4%A'), '%E0%A4%A');
});
