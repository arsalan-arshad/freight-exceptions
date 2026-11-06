import { createHash, timingSafeEqual } from 'node:crypto';

/** Constant-time equality for two strings of any length (compares SHA-256 digests). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/** Extract the password from an HTTP Basic Authorization header. The username is ignored. */
export function passwordFromBasic(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header);
  if (!m || !m[1]) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(m[1], 'base64').toString('utf8');
  } catch {
    return null;
  }
  const i = decoded.indexOf(':');
  return i === -1 ? null : decoded.slice(i + 1);
}

/** True when no password is configured, or the header carries the right one. */
export function isAuthorized(header: string | null | undefined, expectedPassword: string | null): boolean {
  if (expectedPassword === null) return true;
  const given = passwordFromBasic(header);
  // Always run one comparison so timing does not reveal whether a password was supplied.
  const ok = safeEqual(given ?? '', expectedPassword);
  return given !== null && ok;
}
