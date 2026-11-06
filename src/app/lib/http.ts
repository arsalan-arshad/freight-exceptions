import { NextResponse } from 'next/server';
import { hostCheckApplies, isHostAllowed, readConfig } from './env';
import type { AppConfig } from './env';

export const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB

/** An error whose message is safe to show to the caller. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Read a request body as text with a hard byte limit (checks Content-Length, then counts streamed bytes). */
export async function readTextBody(req: Request, maxBytes = MAX_BODY_BYTES): Promise<string> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, `Body too large (limit ${Math.floor(maxBytes / 1024)} KB).`);
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, `Body too large (limit ${Math.floor(maxBytes / 1024)} KB).`);
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

export async function readJsonBody(req: Request, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const text = await readTextBody(req, maxBytes);
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new HttpError(400, 'Request body must be a JSON object.');
  return v as Record<string, unknown>;
}

export function str(v: unknown, field: string, max: number, opts: { allowEmpty?: boolean } = {}): string {
  if (typeof v !== 'string') throw new HttpError(400, `"${field}" must be a string.`);
  if (v.length > max) throw new HttpError(400, `"${field}" is too long (max ${max} characters).`);
  if (!opts.allowEmpty && v.trim() === '') throw new HttpError(400, `"${field}" must not be empty.`);
  return v;
}

/**
 * Reject cross-site and rebinding writes.
 * 1. If the browser sent an Origin header it must name the same host the request was addressed to.
 * 2. When the server is unprotected (no APP_PASSWORD) and not a demo, that host must also be a local name
 *    (localhost, 127.0.0.1, [::1]) or listed in ALLOWED_HOSTS. A DNS-rebinding page makes Origin and Host
 *    agree on an attacker's name, so (1) alone is not enough.
 */
export function assertSameOrigin(req: Request, cfg: AppConfig = readConfig()): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (hostCheckApplies(cfg) && !isHostAllowed(host, cfg)) {
    throw new HttpError(403, 'This host name is not allowed. Use localhost, set ALLOWED_HOSTS, or set APP_PASSWORD.');
  }
  const origin = req.headers.get('origin');
  if (!origin) return; // non-browser clients (curl) send no Origin
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = null;
  }
  if (!host || originHost === null || originHost.toLowerCase() !== host.toLowerCase()) throw new HttpError(403, 'Cross-site request refused.');
}

/** Wrap a route handler: turns thrown errors into sanitised JSON. Only HttpError messages reach the caller. */
export function handle<A extends [Request, ...unknown[]]>(fn: (...args: A) => Promise<NextResponse>) {
  return async (...args: A): Promise<NextResponse> => {
    try {
      assertSameOrigin(args[0]);
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error('Unhandled API error:', e instanceof Error ? `${e.name}: ${e.message}` : 'unknown');
      return json({ error: 'Something went wrong on the server.' }, 500);
    }
  };
}

/** Route params may arrive percent-encoded (case ids contain ":"). Decode defensively. */
export function routeId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
