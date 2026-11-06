// Strict instant parsing. Rules compare INSTANTS (epoch ms), never strings.
// A timestamp without an explicit offset is rejected (null): the core never guesses a timezone.

export interface ParsedInstant {
  /** Epoch milliseconds (the instant). */
  ms: number;
  /** Offset the source string was written in, in minutes east of UTC. Used only for display. */
  offsetMinutes: number;
}

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|z|[+-]\d{2}(?::?\d{2})?)$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Parse an ISO 8601 date-time that carries an offset (or Z). Anything else returns null. Never throws. */
export function parseInstant(value: unknown): ParsedInstant | null {
  if (typeof value !== 'string') return null;
  const m = ISO_RE.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const millis = m[7] === undefined ? 0 : Number(m[7].padEnd(3, '0').slice(0, 3));
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  let offsetMinutes = 0;
  const off = m[8] ?? 'Z';
  if (off !== 'Z' && off !== 'z') {
    const sign = off.startsWith('-') ? -1 : 1;
    const digits = off.slice(1).replace(':', '');
    const oh = Number(digits.slice(0, 2));
    const om = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
    if (oh > 23 || om > 59) return null;
    offsetMinutes = sign * (oh * 60 + om);
  }

  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, second, millis);
  const ms = d.getTime() - offsetMinutes * 60_000;
  if (!Number.isFinite(ms)) return null;
  return { ms, offsetMinutes };
}

export interface ParsedWindow {
  startMs?: number;
  startOffset?: number;
  endMs: number;
  endOffset: number;
}

/**
 * A window is usable when its END parses. A start that does not parse is ignored.
 * If both parse and start is after end the window is contradictory and treated as unusable.
 */
export function parseWindow(w: unknown): ParsedWindow | null {
  if (!w || typeof w !== 'object') return null;
  const o = w as { start?: unknown; end?: unknown };
  const end = parseInstant(o.end);
  if (!end) return null;
  const start = parseInstant(o.start);
  if (start && start.ms > end.ms) return null;
  const out: ParsedWindow = { endMs: end.ms, endOffset: end.offsetMinutes };
  if (start) {
    out.startMs = start.ms;
    out.startOffset = start.offsetMinutes;
  }
  return out;
}
