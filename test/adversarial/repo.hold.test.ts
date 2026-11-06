// ADVERSARIAL (properties that HOLD today): no send path, web helpers, SQL, secrets hygiene. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLlmClient, LlmError } from '../../src/ai/index';
import { safeEqual, isAuthorized, passwordFromBasic } from '../../src/app/lib/auth';
import { readTextBody, readJsonBody, assertSameOrigin, HttpError, str } from '../../src/app/lib/http';
import { openSqliteStore } from '../../src/db/index';
import { parseShipmentsCsv } from '../../src/ingest/index';

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) { if (n === 'node_modules' || n === '.next') continue; const p = join(dir, n); statSync(p).isDirectory() ? walk(p, out) : out.push(p); }
  return out;
}
const prod = walk('src').filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f));
const src = (f: string) => readFileSync(f, 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('NO SEND PATH: no mail/SMS/webhook/socket/process/eval primitives anywhere in production source', () => {
  const forbidden = /nodemailer|smtp|sendmail|mailto:|child_process|node:http|node:https|node:net|node:tls|node:dgram|node:dns|node:vm|worker_threads|\beval\s*\(|new Function|XMLHttpRequest|WebSocket|EventSource|sendBeacon|dangerouslySetInnerHTML|innerHTML|document\.write|window\.open|\bimport\s*\(|\brequire\s*\(/;
  assert.ok(prod.length > 40);
  for (const f of prod) assert.ok(!forbidden.test(code(f)), `${f} contains a forbidden primitive`);
});

test('NO SEND PATH: the only server-side network call is the LLM client; browser fetches target same-origin /api only', () => {
  const withFetch = prod.filter((f) => /\bfetch\s*\(/.test(src(f)));
  const server = withFetch.filter((f) => !f.endsWith('.tsx'));
  assert.deepEqual(server, ['src/ai/llm.ts']);
  for (const f of withFetch.filter((x) => x.endsWith('.tsx'))) {
    for (const m of src(f).matchAll(/fetch\(\s*([^,)]+)/g)) assert.ok(/^(`\/api\/|'\/api\/|url\b)/.test(m[1]!.trim()), `${f}: fetch(${m[1]})`);
  }
  // external URLs in production source are only the two official provider bases
  const urls = new Set<string>();
  for (const f of prod) for (const m of src(f).matchAll(/https?:\/\/[^\s'"`)<>]+/g)) urls.add(m[0]);
  const allowed = new Set(['https://api.anthropic.com', 'https://api.openai.com/v1']);
  const unexpected = [...urls].filter((u) => !allowed.has(u) && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(u));
  assert.deepEqual(unexpected, []);
});

test('LLM client: provider error bodies echoing the key / prompt never reach the thrown error', async () => {
  const KEY = 'sk-test-ADVERSARIAL-KEY-0001';
  const body = JSON.stringify({ error: { type: 'authentication_error', message: `Invalid key ${KEY}; prompt was: SECRET-PROMPT`, code: KEY } });
  const fetchImpl = (async () => new Response(body, { status: 401, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
  for (const provider of ['anthropic', 'openai']) {
    const c = createLlmClient({ LLM_PROVIDER: provider, LLM_API_KEY: KEY, LLM_MODEL: 'm' }, { fetch: fetchImpl })!;
    await assert.rejects(c.complete({ system: 's', user: 'SECRET-PROMPT' }), (e: unknown) => {
      const dump = JSON.stringify(e, Object.getOwnPropertyNames(e as object)) + String((e as Error).stack) + String((e as Error).message);
      assert.ok(e instanceof LlmError);
      assert.ok(!dump.includes(KEY) && !dump.includes('SECRET-PROMPT') && !/x-api-key|authorization|bearer/i.test(dump), dump);
      return true;
    });
  }
  const netFail = (async () => { throw new TypeError(`connect ECONNREFUSED https://x?key=${KEY}`); }) as unknown as typeof fetch;
  const c = createLlmClient({ LLM_PROVIDER: 'openai', LLM_API_KEY: KEY, LLM_MODEL: 'm' }, { fetch: netFail })!;
  await assert.rejects(c.complete({ system: 's', user: 'u' }), (e: unknown) => !String((e as Error).message + (e as Error).stack).includes(KEY));
});

test('LLM client: config refuses plain http (non-localhost), credentials in the base URL, header-injecting keys', () => {
  const base = { LLM_PROVIDER: 'openai', LLM_API_KEY: 'sk-test-k', LLM_MODEL: 'm' };
  assert.equal(createLlmClient({ ...base, LLM_BASE_URL: 'http://evil.example/v1' }), null);
  assert.equal(createLlmClient({ ...base, LLM_BASE_URL: 'https://user:pw@evil.example/v1' }), null);
  assert.equal(createLlmClient({ ...base, LLM_API_KEY: 'sk-test\r\nX-Evil: 1' }), null);
  assert.equal(createLlmClient({ ...base, LLM_API_KEY: 'sk test' }), null);
  assert.equal(createLlmClient({ ...base, LLM_PROVIDER: 'ftp' }), null);
  assert.ok(createLlmClient({ ...base, LLM_BASE_URL: 'http://localhost:11434/v1' }));
});

test('auth: constant-time compare, Basic parsing edge cases', () => {
  assert.equal(safeEqual('a', 'a'), true);
  assert.equal(safeEqual('a', 'a '), false);
  assert.equal(safeEqual('', ''), true);
  const h = (u: string, p: string) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
  assert.equal(isAuthorized(h('any', 'pw:with:colons'), 'pw:with:colons'), true);
  assert.equal(isAuthorized(h('any', 'pw'), 'PW'), false);
  assert.equal(isAuthorized(h('any', ''), 'pw'), false);
  assert.equal(isAuthorized(null, 'pw'), false);
  assert.equal(isAuthorized('Bearer pw', 'pw'), false);
  assert.equal(isAuthorized('Basic !!!', 'pw'), false);
  assert.equal(isAuthorized('Basic ' + Buffer.from('nocolon').toString('base64'), 'pw'), false);
  assert.equal(isAuthorized('anything', null), true);
  assert.equal(passwordFromBasic('Basic'), null);
  assert.equal(isAuthorized(h('u', 'pw\u0000'), 'pw'), false);
});

test('http helpers: body size limit counts streamed bytes (no Content-Length), JSON must be an object, cross-origin writes refused', async () => {
  const stream = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < 8; i++) c.enqueue(new Uint8Array(1024)); c.close(); } });
  const req = new Request('http://localhost/x', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
  await assert.rejects(readTextBody(req, 4096), (e: unknown) => e instanceof HttpError && e.status === 413);
  await assert.rejects(readJsonBody(new Request('http://x/', { method: 'POST', body: '[1]' })), (e: unknown) => e instanceof HttpError && e.status === 400);
  await assert.rejects(readJsonBody(new Request('http://x/', { method: 'POST', body: '{"a":' + '['.repeat(200000) })), (e: unknown) => e instanceof HttpError && e.status === 400);
  const o = (origin: string | null, method = 'POST') => new Request('http://app.test/api/reset', { method, headers: { host: 'app.test', ...(origin ? { origin } : {}) } });
  assert.throws(() => assertSameOrigin(o('https://evil.test')), HttpError);
  assert.throws(() => assertSameOrigin(o('null')), HttpError);
  assert.throws(() => assertSameOrigin(o('http://app.test.evil.test')), HttpError);
  // Same-origin writes are accepted only for an allowed host (DEFECT-26): localhost by default, never an arbitrary name.
  const local = (origin: string | null) => new Request('http://localhost:3000/api/reset', { method: 'POST', headers: { host: 'localhost:3000', ...(origin ? { origin } : {}) } });
  assert.doesNotThrow(() => assertSameOrigin(local('http://localhost:3000')));
  assert.throws(() => assertSameOrigin(o('http://app.test')), HttpError);
  assert.throws(() => str(5, 'f', 10), HttpError);
  assert.throws(() => str('x'.repeat(11), 'f', 10), HttpError);
});

test('SQL: hostile ids, references and filters are bound as parameters; no string concatenation of user data', async () => {
  const text = src('src/db/sqlite.ts').split('\n').filter((l) => !/new Error\(/.test(l)).join('\n');
  const interpolations = [...text.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(interpolations)].sort(), ['SCHEMA_VERSION', "list.map(() => '?').join(', ')", "where.length ? ' WHERE ' + where.join(' AND ') : ''"].sort());
  const store = openSqliteStore(':memory:');
  const evil = "x'; DROP TABLE cases;--";
  await store.upsertShipments([{ id: evil, reference: evil, events: [], documents: [] }]);
  assert.equal((await store.getShipment(evil))?.reference, evil);
  assert.deepEqual(await store.listCases({ ruleId: evil, shipmentId: evil, status: ['open'] }), []);
  assert.equal(await store.getCase(evil), null);
  assert.equal((await store.listShipments()).length, 1);
  await assert.rejects(store.setCaseStatus('nope', 'open'));
  await assert.rejects(store.setCaseStatus('nope', "open'; --" as never));
});

test('CSV: formula / HTML / script cells are kept as inert text with a warning, never evaluated or dropped silently', () => {
  const r = parseShipmentsCsv('reference,carrier,customer\n"=HYPERLINK(""http://evil.example"")","<img src=x onerror=alert(1)>","@SUM(1)"\n');
  assert.equal(r.shipments.length, 1);
  assert.ok(r.issues.some((i) => /never evaluated/.test(i.message)));
  assert.equal(r.shipments[0]!.carrier, '<img src=x onerror=alert(1)>');
});

test('UI source: no dangerouslySetInnerHTML, no href/src built from data except encoded internal links', () => {
  for (const f of prod.filter((x) => x.endsWith('.tsx'))) {
    const t = src(f);
    assert.ok(!/dangerouslySetInnerHTML|javascript:/.test(t), f);
    for (const m of t.matchAll(/\b(?:href|src|action)=\{(`[^`]*`|[^}`]+)\}/g)) assert.ok(/^`\/cases\/\$\{encodeURIComponent\([^)]*\)\}`$|^l\.href$/.test(m[1]!.trim()), `${f}: ${m[0]}`);
  }
});

test('repo hygiene: .env ignored in git and docker, .env.example has names only, Docker runs as non-root', () => {
  const gi = readFileSync('.gitignore', 'utf8').split('\n');
  assert.ok(gi.includes('.env') && gi.includes('.env.*') && gi.includes('!.env.example') && gi.includes('*.sqlite'));
  const di = readFileSync('.dockerignore', 'utf8').split('\n');
  assert.ok(di.includes('.env') && di.includes('.env.*'));
  for (const line of readFileSync('.env.example', 'utf8').split('\n')) if (/^[A-Z_]+=/.test(line)) assert.match(line, /^[A-Z_]+=$/, `value present in .env.example: ${line.split('=')[0]}`);
  const df = readFileSync('Dockerfile', 'utf8');
  assert.match(df, /^USER node$/m);
  assert.ok(df.indexOf('USER node') > df.lastIndexOf('COPY'));
  assert.ok(!/ENV[^\n]*(KEY|PASSWORD|SECRET|TOKEN)/i.test(df));
  assert.equal(existsSync('.env'), false);
});

test('logging: the only console calls never print env values, keys or request bodies', () => {
  const calls = prod.flatMap((f) => [...src(f).matchAll(/console\.\w+\([^;]*\);/g)].map((m) => `${f}: ${m[0]}`));
  assert.ok(calls.length <= 3, calls.join('\n'));
  for (const c of calls) assert.ok(!/process\.env|apiKey|LLM_API_KEY|body|raw|text\b/.test(c), c);
});
