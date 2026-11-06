import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createLlmClient, describeLlmConfig, LlmError } from './llm';

const KEY = 'sk-test-SECRETKEY1234567890';

interface Seen { url: string; init: RequestInit & { headers: Record<string, string> } }
function fakeFetch(responses: Array<Response | Error | ((init: RequestInit) => Promise<Response>)>) {
  const seen: Seen[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init as Seen['init'] });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(init as RequestInit);
    return next;
  }) as unknown as typeof fetch;
  return { f, seen };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const ANTH = { LLM_PROVIDER: 'anthropic', LLM_API_KEY: KEY, LLM_MODEL: 'test-model-a' };
const OAI = { LLM_PROVIDER: 'openai', LLM_API_KEY: KEY, LLM_MODEL: 'test-model-o' };

// ---------- config matrix ----------
test('createLlmClient: not configured -> null, describe says so without a problem', () => {
  assert.equal(createLlmClient({}), null);
  assert.deepEqual(describeLlmConfig({}), { configured: false });
  assert.equal(createLlmClient({ LLM_PROVIDER: '  ', LLM_API_KEY: '', LLM_MODEL: undefined }), null);
});

test('createLlmClient: partial config -> null with a problem naming the missing variables', () => {
  for (const [env, missing] of [
    [{ LLM_PROVIDER: 'anthropic' }, ['LLM_API_KEY', 'LLM_MODEL']],
    [{ LLM_API_KEY: KEY }, ['LLM_PROVIDER', 'LLM_MODEL']],
    [{ LLM_PROVIDER: 'openai', LLM_API_KEY: KEY }, ['LLM_MODEL']],
    [{ LLM_PROVIDER: 'openai', LLM_MODEL: 'm' }, ['LLM_API_KEY']],
  ] as const) {
    assert.equal(createLlmClient(env), null);
    const d = describeLlmConfig(env);
    assert.equal(d.configured, false);
    for (const m of missing) assert.match(d.problem ?? '', new RegExp(m));
  }
});

test('createLlmClient: invalid provider / key / model / base url', () => {
  assert.equal(createLlmClient({ ...ANTH, LLM_PROVIDER: 'gemini' }), null);
  assert.match(describeLlmConfig({ ...ANTH, LLM_PROVIDER: 'gemini' }).problem ?? '', /anthropic.*openai/);
  const badKey = { ...ANTH, LLM_API_KEY: 'abc\ndef' };
  assert.equal(createLlmClient(badKey), null);
  assert.match(describeLlmConfig(badKey).problem ?? '', /LLM_API_KEY/);
  assert.ok(!JSON.stringify(describeLlmConfig(badKey)).includes('abc'));
  assert.equal(createLlmClient({ ...ANTH, LLM_API_KEY: 'has space' }), null);
  assert.equal(createLlmClient({ ...ANTH, LLM_MODEL: 'two words' }), null);
  assert.equal(createLlmClient({ ...ANTH, LLM_BASE_URL: 'not a url' }), null);
  assert.equal(createLlmClient({ ...ANTH, LLM_BASE_URL: 'http://example.com' }), null);
  assert.equal(createLlmClient({ ...ANTH, LLM_BASE_URL: 'ftp://example.com' }), null);
  assert.equal(createLlmClient({ ...ANTH, LLM_BASE_URL: 'https://user:pw@example.com' }), null);
});

test('createLlmClient: valid configs, case-insensitive provider, trimmed values, http allowed for localhost', () => {
  assert.ok(createLlmClient(ANTH));
  assert.ok(createLlmClient(OAI));
  assert.ok(createLlmClient({ ...ANTH, LLM_PROVIDER: ' Anthropic ', LLM_MODEL: ' m ' }));
  assert.ok(createLlmClient({ ...OAI, LLM_BASE_URL: 'http://localhost:11434/v1' }));
  assert.ok(createLlmClient({ ...OAI, LLM_BASE_URL: 'https://proxy.example.com/v1' }));
  assert.deepEqual(describeLlmConfig(ANTH), { configured: true, provider: 'anthropic' });
  assert.deepEqual(describeLlmConfig(OAI), { configured: true, provider: 'openai' });
});

test('describeLlmConfig never contains the key', () => {
  for (const env of [ANTH, OAI, { ...ANTH, LLM_MODEL: '' }, { ...ANTH, LLM_BASE_URL: 'bad' }, { ...ANTH, LLM_PROVIDER: 'x' }]) {
    assert.ok(!JSON.stringify(describeLlmConfig(env)).includes(KEY));
  }
});

// ---------- anthropic ----------
test('anthropic: correct URL, headers, body; returns joined text blocks', async () => {
  const { f, seen } = fakeFetch([json({ content: [{ type: 'text', text: 'Hello ' }, { type: 'tool_use', id: 'x' }, { type: 'text', text: 'world' }] })]);
  const c = createLlmClient(ANTH, { fetch: f })!;
  assert.equal(c.name, 'anthropic:test-model-a');
  const out = await c.complete({ system: 'SYS', user: 'USR', maxTokens: 321 });
  assert.equal(out, 'Hello world');
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen[0]!.init.method, 'POST');
  assert.equal(seen[0]!.init.headers['x-api-key'], KEY);
  assert.equal(seen[0]!.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(seen[0]!.init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(String(seen[0]!.init.body)), {
    model: 'test-model-a',
    max_tokens: 321,
    system: 'SYS',
    messages: [{ role: 'user', content: 'USR' }],
  });
  assert.ok(seen[0]!.init.signal instanceof AbortSignal);
});

test('anthropic: custom base URL, with or without /v1', async () => {
  for (const base of ['https://gw.example.com', 'https://gw.example.com/', 'https://gw.example.com/v1']) {
    const { f, seen } = fakeFetch([json({ content: [{ type: 'text', text: 'ok' }] })]);
    await createLlmClient({ ...ANTH, LLM_BASE_URL: base }, { fetch: f })!.complete({ system: 's', user: 'u' });
    assert.equal(seen[0]!.url, 'https://gw.example.com/v1/messages');
  }
});

// ---------- openai ----------
test('openai: correct URL, bearer auth, body; returns message content', async () => {
  const { f, seen } = fakeFetch([json({ choices: [{ message: { role: 'assistant', content: 'hi there' } }] })]);
  const c = createLlmClient(OAI, { fetch: f })!;
  assert.equal(await c.complete({ system: 'SYS', user: 'USR' }), 'hi there');
  assert.equal(seen[0]!.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(seen[0]!.init.headers['authorization'], `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(String(seen[0]!.init.body)), {
    model: 'test-model-o',
    max_completion_tokens: 1024,
    messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USR' }],
  });
});

test('openai-compatible base URL uses max_tokens and its own path', async () => {
  const { f, seen } = fakeFetch([json({ choices: [{ message: { content: 'x' } }] })]);
  await createLlmClient({ ...OAI, LLM_BASE_URL: 'http://localhost:11434/v1/' }, { fetch: f })!.complete({ system: 's', user: 'u', maxTokens: 50 });
  assert.equal(seen[0]!.url, 'http://localhost:11434/v1/chat/completions');
  const b = JSON.parse(String(seen[0]!.init.body));
  assert.equal(b.max_tokens, 50);
  assert.equal(b.max_completion_tokens, undefined);
});

// ---------- retry ----------
test('retries once on 429 then succeeds', async () => {
  const { f, seen } = fakeFetch([json({ error: { type: 'rate_limit_error' } }, 429), json({ content: [{ type: 'text', text: 'ok' }] })]);
  const out = await createLlmClient(ANTH, { fetch: f, retryDelayMs: 1 })!.complete({ system: 's', user: 'u' });
  assert.equal(out, 'ok');
  assert.equal(seen.length, 2);
});

test('retries once on 500, then gives up with a sanitised HTTP error', async () => {
  const { f, seen } = fakeFetch([json({}, 503), json({ error: { type: 'overloaded_error' } }, 529)]);
  await assert.rejects(createLlmClient(OAI, { fetch: f, retryDelayMs: 1 })!.complete({ system: 's', user: 'u' }), (e: unknown) => {
    assert.ok(e instanceof LlmError);
    assert.equal(e.kind, 'http');
    assert.equal(e.status, 529);
    assert.match(e.message, /HTTP 529 \(overloaded_error\)/);
    return true;
  });
  assert.equal(seen.length, 2);
});

test('does not retry on 400/401/404', async () => {
  for (const status of [400, 401, 404]) {
    const { f, seen } = fakeFetch([json({ error: { type: 'invalid_request_error' } }, status)]);
    await assert.rejects(createLlmClient(ANTH, { fetch: f, retryDelayMs: 1 })!.complete({ system: 's', user: 'u' }), /HTTP/);
    assert.equal(seen.length, 1);
  }
});

// ---------- timeout ----------
test('times out via AbortController and does not retry', async () => {
  const hang = (init: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  const { f, seen } = fakeFetch([hang, hang]);
  const started = Date.now();
  await assert.rejects(createLlmClient(ANTH, { fetch: f, timeoutMs: 30 })!.complete({ system: 's', user: 'u' }), (e: unknown) => {
    assert.ok(e instanceof LlmError);
    assert.equal(e.kind, 'timeout');
    assert.match(e.message, /timed out after 30 ms/);
    return true;
  });
  assert.ok(Date.now() - started < 2000);
  assert.equal(seen.length, 1);
});

// ---------- sanitising ----------
test('errors never contain the key, headers, prompt or provider body (401 that echoes everything)', async () => {
  const echo = json({ error: { type: 'authentication_error', message: `Incorrect API key provided: ${KEY}. Request: PROMPT-SECRET-TEXT Bearer ${KEY}` } }, 401);
  for (const env of [ANTH, OAI]) {
    const { f } = fakeFetch([echo.clone()]);
    const c = createLlmClient(env, { fetch: f })!;
    let caught: unknown;
    try {
      await c.complete({ system: 'SYSTEM-SECRET-TEXT', user: 'PROMPT-SECRET-TEXT' });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof LlmError);
    const dump = JSON.stringify(caught, Object.getOwnPropertyNames(caught)) + String((caught as Error).stack) + (caught as Error).message;
    for (const bad of [KEY, 'SECRETKEY', 'Bearer', 'x-api-key', 'PROMPT-SECRET-TEXT', 'SYSTEM-SECRET-TEXT', 'Incorrect API key']) {
      assert.ok(!dump.includes(bad), `error leaks ${bad}`);
    }
    assert.match((caught as Error).message, /HTTP 401 \(authentication_error\)/);
    assert.equal((caught as { cause?: unknown }).cause, undefined);
  }
});

test('network errors whose message contains the key are reduced to the error name', async () => {
  const { f } = fakeFetch([new TypeError(`fetch failed for https://api.example.com?key=${KEY} with header x-api-key: ${KEY}`)]);
  await assert.rejects(createLlmClient(ANTH, { fetch: f })!.complete({ system: 's', user: 'u' }), (e: unknown) => {
    assert.ok(e instanceof LlmError);
    assert.equal(e.kind, 'network');
    assert.ok(!e.message.includes(KEY));
    assert.match(e.message, /TypeError/);
    return true;
  });
});

test('non-JSON, empty and wrong-shaped success bodies are errors without leaking the body', async () => {
  const bodies = [new Response('<html>BODY-SECRET</html>', { status: 200 }), json({ content: [] }), json({ choices: [] }), json({ content: [{ type: 'text', text: '   ' }] })];
  for (const [i, r] of bodies.entries()) {
    const { f } = fakeFetch([r]);
    await assert.rejects(createLlmClient(i === 2 ? OAI : ANTH, { fetch: f })!.complete({ system: 's', user: 'u' }), (e: unknown) => {
      assert.ok(e instanceof LlmError);
      assert.equal(e.kind, 'response');
      assert.ok(!e.message.includes('BODY-SECRET'));
      return true;
    });
  }
});

test('hostile error type from a server is not echoed', async () => {
  const { f } = fakeFetch([json({ error: { type: `bad type with ${KEY} and spaces` } }, 400)]);
  await assert.rejects(createLlmClient(ANTH, { fetch: f })!.complete({ system: 's', user: 'u' }), (e: unknown) => {
    assert.ok(!(e as Error).message.includes(KEY));
    assert.match((e as Error).message, /HTTP 400$/);
    return true;
  });
});

test('the client never logs', async () => {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => mock.method(console, m, () => {}));
  try {
    const { f } = fakeFetch([json({ error: {} }, 500), json({ error: {} }, 401)]);
    await createLlmClient(ANTH, { fetch: f, retryDelayMs: 1 })!.complete({ system: 's', user: 'u' }).catch(() => {});
    createLlmClient({ ...ANTH, LLM_MODEL: '' });
    describeLlmConfig(ANTH);
  } finally {
    for (const s of spies) assert.equal(s.mock.callCount(), 0);
    mock.restoreAll();
  }
});

// ---------- redirects ----------
test('both providers refuse redirects (redirect: "error"), so the key header cannot be replayed to another origin', async () => {
  for (const env of [ANTH, OAI]) {
    const { f, seen } = fakeFetch([json({ content: [{ type: 'text', text: 'ok' }], choices: [{ message: { content: 'ok' } }] })]);
    await createLlmClient(env, { fetch: f })!.complete({ system: 's', user: 'u' });
    assert.equal(seen[0]!.init.redirect, 'error');
  }
});

test('a refused redirect is a sanitised network error, not retried, and never mentions the target or the key', async () => {
  for (const env of [ANTH, OAI]) {
    const { f, seen } = fakeFetch([Object.assign(new TypeError(`redirect mode is set to error: https://evil.example/collect?k=${KEY}`), {})]);
    await assert.rejects(createLlmClient(env, { fetch: f, retryDelayMs: 1 })!.complete({ system: 's', user: 'u' }), (e: unknown) => {
      assert.ok(e instanceof LlmError);
      assert.equal(e.kind, 'network');
      assert.match(e.message, /refused redirect/);
      assert.ok(!e.message.includes(KEY) && !e.message.includes('evil.example'));
      return true;
    });
    assert.equal(seen.length, 1);
  }
});

test('a 3xx response handed back by a custom fetch is an HTTP error, not followed', async () => {
  const { f, seen } = fakeFetch([new Response(null, { status: 307, headers: { location: 'https://evil.example/' } })]);
  await assert.rejects(createLlmClient(ANTH, { fetch: f })!.complete({ system: 's', user: 'u' }), /HTTP 307$/);
  assert.equal(seen.length, 1);
});
