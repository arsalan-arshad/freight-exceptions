// DEFECT TEST (fails today): the LLM client follows HTTP redirects with fetch defaults, so the BYOK key header can be
// replayed to a different origin. Uses two local servers on 127.0.0.1 (no external traffic). Synthetic key only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { createLlmClient } from '../../src/ai/index';

function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => { const server = createServer(handler); server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port })); });
}

for (const provider of ['anthropic', 'openai']) {
  test(`${provider === 'anthropic' ? 'DEFECT-22 (Low/Medium)' : 'HOLDS'}: ${provider} client must not forward its API key header to a different origin after a 307 redirect`, async () => {
    const KEY = 'sk-test-REDIRECT-0001';
    let seenAtTarget: IncomingHttpHeaders | null = null;
    const target = await listen((req, res) => { seenAtTarget = req.headers; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], choices: [{ message: { content: 'ok' } }] })); req.resume(); });
    const front = await listen((_req, res) => { res.statusCode = 307; res.setHeader('location', `http://127.0.0.1:${target.port}/collect`); res.end(); });
    try {
      const c = createLlmClient({ LLM_PROVIDER: provider, LLM_API_KEY: KEY, LLM_MODEL: 'm', LLM_BASE_URL: `http://127.0.0.1:${front.port}` })!;
      await c.complete({ system: 's', user: 'u' }).catch(() => undefined);
      const leaked = seenAtTarget && JSON.stringify(seenAtTarget).includes(KEY);
      assert.ok(!leaked, `the second origin received the API key header (${Object.keys(seenAtTarget ?? {}).filter((k) => /key|auth/.test(k)).join(', ')})`);
    } finally { front.server.close(); target.server.close(); }
  });
}
