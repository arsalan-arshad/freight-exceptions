// BYOK LLM clients over plain fetch. No SDKs, no logging, no shared key.
// Errors thrown from here are sanitised: they never contain the API key, request headers,
// the request body (prompt) or the provider's response body.
import type { LlmClient, LlmRequest } from './types';

export type LlmProvider = 'anthropic' | 'openai';
type Env = Record<string, string | undefined>;

export interface LlmClientOptions {
  /** Inject a fetch implementation (tests). Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Per-request timeout. Default 30000. */
  timeoutMs?: number;
  /** Wait before the single retry on 429/5xx. Default 500 (a numeric Retry-After header, capped at 5s, wins). */
  retryDelayMs?: number;
}

export class LlmError extends Error {
  readonly kind: 'http' | 'timeout' | 'network' | 'response';
  readonly status?: number;
  constructor(kind: LlmError['kind'], message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
    if (status !== undefined) this.status = status;
  }
}

interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
  /** True when LLM_BASE_URL was not set (official endpoint). */
  officialBase: boolean;
}

type ConfigResult =
  | { kind: 'unset' }
  | { kind: 'invalid'; problem: string; provider?: string }
  | { kind: 'ok'; config: LlmConfig };

const DEFAULT_BASE: Record<LlmProvider, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
};

function readConfig(env: Env): ConfigResult {
  const get = (k: string): string | undefined => {
    const v = env[k];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  };
  const providerRaw = get('LLM_PROVIDER');
  const apiKey = get('LLM_API_KEY');
  const model = get('LLM_MODEL');
  const baseRaw = get('LLM_BASE_URL');

  // Nothing set: the model is optional, templates are used. Not an error.
  if (!providerRaw && !apiKey && !model) return { kind: 'unset' };

  const missing: string[] = [];
  if (!providerRaw) missing.push('LLM_PROVIDER');
  if (!apiKey) missing.push('LLM_API_KEY');
  if (!model) missing.push('LLM_MODEL');
  if (missing.length > 0) {
    return { kind: 'invalid', problem: `Missing ${missing.join(', ')}. Set all of LLM_PROVIDER, LLM_API_KEY and LLM_MODEL to enable model drafts, or none to use templates.` };
  }
  const provider = providerRaw!.toLowerCase();
  if (provider !== 'anthropic' && provider !== 'openai') {
    return { kind: 'invalid', problem: "LLM_PROVIDER must be 'anthropic' or 'openai'." };
  }
  if (!/^[\x21-\x7e]{1,512}$/.test(apiKey!)) {
    return { kind: 'invalid', provider, problem: 'LLM_API_KEY contains characters that are not allowed in an HTTP header (spaces, line breaks or non-ASCII).' };
  }
  if (!/^[^\s\u0000-\u001f\u007f]{1,200}$/u.test(model!)) {
    return { kind: 'invalid', provider, problem: 'LLM_MODEL looks invalid (spaces or control characters).' };
  }
  let baseUrl = DEFAULT_BASE[provider];
  if (baseRaw) {
    let u: URL;
    try {
      u = new URL(baseRaw);
    } catch {
      return { kind: 'invalid', provider, problem: 'LLM_BASE_URL is not a valid URL.' };
    }
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
      return { kind: 'invalid', provider, problem: 'LLM_BASE_URL must use https (http is allowed only for localhost).' };
    }
    if (u.username || u.password) {
      return { kind: 'invalid', provider, problem: 'LLM_BASE_URL must not contain credentials; put the key in LLM_API_KEY.' };
    }
    baseUrl = (u.origin + u.pathname).replace(/\/+$/, '');
  }
  return { kind: 'ok', config: { provider, apiKey: apiKey!, model: model!, baseUrl, officialBase: !baseRaw } };
}

/** For the UI. Never includes the key. `problem` is set when the config is partial or invalid. */
export function describeLlmConfig(env: Env): { configured: boolean; provider?: string; problem?: string } {
  const r = readConfig(env);
  if (r.kind === 'unset') return { configured: false };
  if (r.kind === 'invalid') return r.provider ? { configured: false, provider: r.provider, problem: r.problem } : { configured: false, problem: r.problem };
  return { configured: true, provider: r.config.provider };
}

/** Returns null when the model is not fully and validly configured (use templates). */
export function createLlmClient(env: Env, opts: LlmClientOptions = {}): LlmClient | null {
  const r = readConfig(env);
  if (r.kind !== 'ok') return null;
  return new HttpLlmClient(r.config, opts);
}

interface RawResponse {
  status: number;
  ok: boolean;
  text: string;
  retryAfterMs?: number;
}

class HttpLlmClient implements LlmClient {
  readonly name: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;

  constructor(private readonly cfg: LlmConfig, opts: LlmClientOptions) {
    this.name = `${cfg.provider}:${cfg.model}`;
    this.fetchImpl = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.retryDelayMs = opts.retryDelayMs ?? 500;
  }

  async complete(req: LlmRequest): Promise<string> {
    const { url, headers, body } = this.build(req);
    for (let attempt = 1; ; attempt++) {
      const res = await this.once(url, headers, body);
      if (res.ok) return this.extract(res.text);
      if (attempt === 1 && (res.status === 429 || res.status >= 500)) {
        await sleep(res.retryAfterMs ?? this.retryDelayMs);
        continue;
      }
      throw this.httpError(res);
    }
  }

  private build(req: LlmRequest): { url: string; headers: Record<string, string>; body: string } {
    const maxTokens = req.maxTokens ?? 1024;
    if (this.cfg.provider === 'anthropic') {
      const base = this.cfg.baseUrl;
      return {
        url: base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.cfg.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.cfg.model,
          max_tokens: maxTokens,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
        }),
      };
    }
    // OpenAI Chat Completions. The official endpoint wants max_completion_tokens (newer models reject max_tokens);
    // OpenAI-compatible servers behind LLM_BASE_URL generally only know max_tokens.
    const limit = this.cfg.officialBase ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
    return {
      url: `${this.cfg.baseUrl}/chat/completions`,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.model,
        ...limit,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      }),
    };
  }

  private async once(url: string, headers: Record<string, string>, body: string): Promise<RawResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { method: 'POST', headers, body, signal: controller.signal, redirect: 'error' });
      const text = await res.text();
      const ra = Number(res.headers?.get?.('retry-after'));
      const out: RawResponse = { status: res.status, ok: res.status >= 200 && res.status < 300, text };
      if (Number.isFinite(ra) && ra >= 0) out.retryAfterMs = Math.min(ra * 1000, 5000);
      return out;
    } catch (e) {
      if (controller.signal.aborted) {
        throw new LlmError('timeout', `${this.cfg.provider} request timed out after ${this.timeoutMs} ms`);
      }
      // Name only: the message of a low-level error can contain URLs or other request details.
      // `redirect: 'error'` also lands here: a redirect is refused (never followed), so the key header cannot be replayed
      // to another origin; the caller falls back to the template.
      const name = e instanceof Error && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : 'Error';
      throw new LlmError('network', `${this.cfg.provider} request failed (network error or refused redirect: ${name})`);
    } finally {
      clearTimeout(timer);
    }
  }

  private httpError(res: RawResponse): LlmError {
    // Provider error bodies can echo parts of the key or the prompt. Only a short machine-readable type is kept.
    let type = '';
    try {
      const j = JSON.parse(res.text) as { error?: { type?: unknown; code?: unknown } };
      const t = j?.error?.type ?? j?.error?.code;
      if (typeof t === 'string' && /^[A-Za-z0-9_.-]{1,60}$/.test(t)) type = ` (${t})`;
    } catch {
      /* ignore */
    }
    return new LlmError('http', this.scrub(`${this.cfg.provider} request failed: HTTP ${res.status}${type}`), res.status);
  }

  private extract(text: string): string {
    let j: unknown;
    try {
      j = JSON.parse(text);
    } catch {
      throw new LlmError('response', `${this.cfg.provider} returned a response that is not JSON`);
    }
    let out = '';
    if (this.cfg.provider === 'anthropic') {
      const content = (j as { content?: unknown })?.content;
      if (Array.isArray(content)) {
        out = content
          .filter((b): b is { type: string; text: string } => !!b && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string')
          .map((b) => b.text)
          .join('');
      }
    } else {
      const msg = (j as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
      if (typeof msg === 'string') out = msg;
      else if (Array.isArray(msg)) out = msg.map((p) => (p && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : '')).join('');
    }
    if (out.trim() === '') throw new LlmError('response', `${this.cfg.provider} returned no text`);
    return out;
  }

  /** Belt and braces: remove the key if it somehow ended up in a message. */
  private scrub(msg: string): string {
    return this.cfg.apiKey ? msg.split(this.cfg.apiKey).join('***') : msg;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
