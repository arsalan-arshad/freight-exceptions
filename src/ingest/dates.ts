// Strict date-time parsing. Never guesses: anything not recognised returns an error string.

export interface IsoParts {
  /** Canonical ISO 8601 string, offset preserved ("Z" when UTC or when none was given). */
  iso: string;
  /** Epoch milliseconds of the instant. */
  ms: number;
  /** True when the input had no offset and UTC was assumed. */
  assumedUtc: boolean;
}

export type DateParse = ({ ok: true } & IsoParts) | { ok: false; reason: string };

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Parses "+05:30", "-0500", "-05", "Z" into minutes east of UTC. Returns null if not valid. */
export function parseOffsetMinutes(s: string): number | null {
  const t = s.trim().replace(/−/g, '-');
  if (/^(Z|UTC|GMT)$/i.test(t)) return 0;
  const m = /^([+-])(\d{2})(?::?(\d{2}))?$/.exec(t);
  if (!m) return null;
  const h = Number(m[2]);
  const mi = m[3] ? Number(m[3]) : 0;
  if (h > 14 || mi > 59) return null;
  const v = h * 60 + mi;
  return m[1] === '-' ? -v : v;
}

export function formatOffset(mins: number): string {
  if (mins === 0) return 'Z';
  const sign = mins < 0 ? '-' : '+';
  const a = Math.abs(mins);
  return `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ]\s*(\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3})\d*)?)?\s*(Z|z|UTC|utc|GMT|gmt|[+\-−]\d{2}(?::?\d{2})?)?)?$/;

/**
 * Accepts ISO 8601 date-times ("2026-03-04T10:00:00Z", "2026-03-04T10:00-05:00") and
 * "YYYY-MM-DD HH:mm[:ss]". A missing offset means UTC and sets assumedUtc.
 * A date without a time of day is rejected (we will not invent midnight).
 */
export function parseDateTimeStrict(raw: string): DateParse {
  const s = raw.trim();
  const m = ISO_RE.exec(s);
  if (!m) {
    if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(s)) {
      return { ok: false, reason: `ambiguous date format "${s}" (day/month order unknown); use ISO 8601, e.g. 2026-03-04 14:30` };
    }
    return { ok: false, reason: `unrecognised date-time "${s}"; use ISO 8601, e.g. 2026-03-04T14:30:00Z or "2026-03-04 14:30"` };
  }
  if (m[4] === undefined) {
    return { ok: false, reason: `date "${s}" has no time of day; a time is required` };
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const sec = m[6] ? Number(m[6]) : 0;
  const msFrac = m[7] ? Number(m[7].padEnd(3, '0')) : 0;
  if (y < 1900 || y > 2200) return { ok: false, reason: `year out of range in "${s}"` };
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return { ok: false, reason: `invalid calendar date in "${s}"` };
  if (h > 23 || mi > 59 || sec > 59) return { ok: false, reason: `invalid time of day in "${s}"` };
  let offMin = 0;
  let assumedUtc = true;
  if (m[8] !== undefined) {
    const o = parseOffsetMinutes(m[8]);
    if (o === null) return { ok: false, reason: `invalid UTC offset in "${s}"` };
    offMin = o;
    assumedUtc = false;
  }
  const ms = Date.UTC(y, mo - 1, d, h, mi, sec, msFrac) - offMin * 60000;
  const frac = msFrac ? `.${pad(msFrac, 3)}` : '';
  const iso = `${pad(y, 4)}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(sec)}${frac}${formatOffset(offMin)}`;
  return { ok: true, iso, ms, assumedUtc };
}

/** Like parseDateTimeStrict but the offset (or Z) is mandatory. Used for model values and ctx.receivedAt. */
export function parseIsoInstant(raw: string): number | null {
  const r = parseDateTimeStrict(raw);
  if (!r.ok || r.assumedUtc) return null;
  return r.ms;
}

export function msToIso(ms: number): string {
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}
