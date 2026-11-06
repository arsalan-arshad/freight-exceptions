// Deterministic resolution of date-times written in free text (an email quote).
// Used ONLY to verify what a model claims: the model's value must equal an instant resolved here.
// Anything unclear is rejected with a reason; nothing is guessed.
import { daysInMonth, msToIso, parseIsoInstant, parseOffsetMinutes } from './dates';

export interface TimeCandidate {
  ms: number;
  iso: string;
}

export interface TimeResolution {
  candidates: TimeCandidate[];
  /** Reasons why other time-like pieces of the quote could not be resolved. */
  errors: string[];
}

export interface TimeResolveOptions {
  receivedAt?: string;
  assumeOffset?: string;
  /** true for arrived/departed/delivered/picked up (must not be in the future of receipt); false for ETA. */
  pastEvent: boolean;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const TZ_ABBR: Record<string, number> = { EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420 };
const UNSUPPORTED_TZ =
  /^\s*(AKST|AKDT|HST|IST|BST|CET|CEST|EET|EEST|WET|WEST|JST|KST|AEST|AEDT|ACST|NZST|NZDT|SGT|HKT|MSK|SAST|EAT|WAT|PKT|NST|AST|ADT|ET|CT|MT|PT)(?![A-Za-z])/;

const GRACE_MS = 5 * 60 * 1000;

interface DateTok {
  start: number;
  end: number;
  kind: 'iso' | 'named' | 'slash' | 'rel';
  y?: number;
  m?: number;
  d?: number;
  a?: number;
  b?: number;
  word?: string;
}
interface TimeTok {
  start: number;
  end: number;
  h: number;
  mi: number;
  s: number;
  error?: string;
}

function dropOverlaps<T extends { start: number; end: number }>(toks: T[]): T[] {
  const sorted = [...toks].sort((x, y) => x.start - y.start || y.end - y.start - (x.end - x.start));
  const out: T[] = [];
  let lastEnd = -1;
  for (const t of sorted) {
    if (t.start >= lastEnd) {
      out.push(t);
      lastEnd = t.end;
    }
  }
  return out;
}

function findDates(q: string): DateTok[] {
  const toks: DateTok[] = [];
  let m: RegExpExecArray | null;
  const iso = /(?<![\d-])(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?!\d)/g;
  while ((m = iso.exec(q))) toks.push({ start: m.index, end: m.index + m[0].length, kind: 'iso', y: +(m[1] as string), m: +(m[2] as string), d: +(m[3] as string) });
  const md = new RegExp(`\\b${MON}\\.?(?![a-z])\\s+(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?(?:,?\\s+(\\d{4})(?!\\d))?`, 'gi');
  while ((m = md.exec(q))) {
    const tok: DateTok = { start: m.index, end: m.index + m[0].length, kind: 'named', m: MONTHS[(m[1] as string).slice(0, 3).toLowerCase()] as number, d: +(m[2] as string) };
    if (m[3]) tok.y = +m[3];
    toks.push(tok);
  }
  const dm = new RegExp(`(?<![\\d:/.])(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?[\\s-]+${MON}\\.?(?![a-z])(?:,?[\\s-]+(\\d{4})(?!\\d))?`, 'gi');
  while ((m = dm.exec(q))) {
    const tok: DateTok = { start: m.index, end: m.index + m[0].length, kind: 'named', m: MONTHS[(m[2] as string).slice(0, 3).toLowerCase()] as number, d: +(m[1] as string) };
    if (m[3]) tok.y = +m[3];
    toks.push(tok);
  }
  const sl = /(?<![\d/.])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/g;
  while ((m = sl.exec(q))) {
    const tok: DateTok = { start: m.index, end: m.index + m[0].length, kind: 'slash', a: +(m[1] as string), b: +(m[2] as string) };
    if (m[3]) tok.y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    toks.push(tok);
  }
  const rel = /\b(today|tomorrow|tmrw|yesterday|tonight)\b/gi;
  while ((m = rel.exec(q))) toks.push({ start: m.index, end: m.index + m[0].length, kind: 'rel', word: (m[1] as string).toLowerCase() });
  return dropOverlaps(toks);
}

function findTimes(q: string): TimeTok[] {
  const toks: TimeTok[] = [];
  let m: RegExpExecArray | null;
  const full = /(?<![\d:.+\-\u2212])(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?(?!\d)(?:\s*([ap])\.?m\b\.?)?/gi;
  while ((m = full.exec(q))) toks.push(mkTime(m.index, m[0].length, +(m[1] as string), +(m[2] as string), m[3] ? +m[3] : 0, m[4]));
  const hourOnly = /(?<![\d:.\/+\-\u2212])(\d{1,2})\s*([ap])\.?m\b\.?/gi;
  while ((m = hourOnly.exec(q))) toks.push(mkTime(m.index, m[0].length, +(m[1] as string), 0, 0, m[2]));
  return dropOverlaps(toks);
}

function mkTime(start: number, len: number, h: number, mi: number, s: number, ap: string | undefined): TimeTok {
  const tok: TimeTok = { start, end: start + len, h, mi, s };
  if (ap) {
    if (h < 1 || h > 12) tok.error = `invalid 12-hour time "${h}:${String(mi).padStart(2, '0')}"`;
    else tok.h = ap.toLowerCase() === 'p' ? (h % 12) + 12 : h % 12;
  } else if (h > 23) tok.error = `invalid hour ${h}`;
  if (mi > 59 || s > 59) tok.error = 'invalid minutes or seconds';
  return tok;
}

interface TzTok {
  len: number;
  offsetMin?: number;
  error?: string;
}

function findTz(q: string, after: number, isoStyle: boolean): TzTok | undefined {
  const rest = q.slice(after);
  let m = /^\s*\(?\s*(?:UTC|GMT)\s?([+\-\u2212])(\d{1,2})(?::?(\d{2}))?(?!\d)/.exec(rest);
  if (m) {
    const off = parseOffsetMinutes(`${m[1]}${(m[2] as string).padStart(2, '0')}${m[3] ?? '00'}`);
    return off === null ? { len: m[0].length, error: `invalid UTC offset "${m[0].trim()}"` } : { len: m[0].length, offsetMin: off };
  }
  m = /^\s*\(?\s*(?:UTC|GMT)(?![A-Za-z])/.exec(rest);
  if (m) return { len: m[0].length, offsetMin: 0 };
  m = /^\s*(Z)(?![A-Za-z0-9])/.exec(rest);
  if (m) return { len: m[0].length, offsetMin: 0 };
  m = /^\s*\(?\s*(EST|EDT|CST|CDT|MST|MDT|PST|PDT)(?![A-Za-z])/.exec(rest);
  if (m) return { len: m[0].length, offsetMin: TZ_ABBR[m[1] as string] as number };
  m = /^(\s*)([+\-\u2212])(\d{2})(:?)(\d{2})(?!\d)/.exec(rest);
  if (m) {
    const spaced = (m[1] as string).length > 0;
    const colon = m[4] === ':';
    // ISO-style stamps may carry any offset form; free text only "+hhmm"/"-hhmm" after a space (RFC 2822 style).
    const allowed = isoStyle || (spaced && !colon);
    if (allowed) {
      const off = parseOffsetMinutes(`${m[2]}${m[3]}${m[5]}`);
      if (off !== null) return { len: m[0].length, offsetMin: off };
    }
  }
  m = /^([+\-\u2212])(\d{2})(?![\d:])/.exec(rest);
  if (m && isoStyle) {
    const off = parseOffsetMinutes(`${m[1]}${m[2]}`);
    if (off !== null) return { len: m[0].length, offsetMin: off };
  }
  m = UNSUPPORTED_TZ.exec(rest);
  if (m) return { len: m[0].length, error: `time zone "${m[1]}" is ambiguous or unsupported; the quote must give UTC/GMT, a numeric offset, or EST/EDT/CST/CDT/MST/MDT/PST/PDT` };
  return undefined;
}

function localYmd(ms: number, offsetMin: number): { y: number; m: number; d: number } {
  const dt = new Date(ms + offsetMin * 60000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

const BEFORE_GAP = /^[\s,T@\-\u2013]*(?:(?:at|on|by|around|about|approx\.?|circa)[\s,]+)?$/i;
const AFTER_GAP = /^[\s,]*(?:on|@)?[\s,]*$/i;

/** Resolves every date-time found in `quote` that has a time of day. */
export function resolveTimesFromQuote(quote: string, opts: TimeResolveOptions): TimeResolution {
  const candidates: TimeCandidate[] = [];
  const errors: string[] = [];
  const addErr = (e: string) => {
    if (!errors.includes(e)) errors.push(e);
  };
  const dates = findDates(quote);
  const times = findTimes(quote);
  const assume = opts.assumeOffset !== undefined ? parseOffsetMinutes(opts.assumeOffset) : null;

  let receivedMs: number | null = null;
  let receivedErr: string | undefined;
  if (opts.receivedAt !== undefined) {
    receivedMs = parseIsoInstant(opts.receivedAt);
    if (receivedMs === null) receivedErr = 'ctx.receivedAt is not a valid ISO 8601 instant with an offset';
  }

  if (times.length === 0) {
    addErr(dates.length > 0 ? 'the quote has a date but no time of day' : 'the quote contains no date or time');
    return { candidates, errors };
  }

  for (const t of times) {
    const label = `${String(t.h).padStart(2, '0')}:${String(t.mi).padStart(2, '0')}`;
    if (t.error) {
      addErr(t.error);
      continue;
    }
    // date before the time
    let date: DateTok | undefined;
    for (let i = dates.length - 1; i >= 0; i--) {
      const d = dates[i] as DateTok;
      if (d.end <= t.start && BEFORE_GAP.test(quote.slice(d.end, t.start))) {
        date = d;
        break;
      }
    }
    const isoStyle = date?.kind === 'iso';
    const tz = findTz(quote, t.end, isoStyle);
    if (!date) {
      const tzEnd = t.end + (tz?.len ?? 0);
      const next = dates.find((d) => d.start >= tzEnd && AFTER_GAP.test(quote.slice(tzEnd, d.start)));
      if (next) {
        date = next;
      }
    }
    if (!date && dates.length > 0) {
      if (dates.length === 1 && times.length === 1) date = dates[0];
      else {
        addErr(`cannot tell which date belongs to the time ${label}`);
        continue;
      }
    }

    if (tz?.error) {
      addErr(tz.error);
      continue;
    }
    let offsetMin: number;
    if (tz?.offsetMin !== undefined) offsetMin = tz.offsetMin;
    else if (assume !== null) offsetMin = assume;
    else {
      addErr(`time ${label} has no time zone in the quote and ctx.assumeOffset is not set`);
      continue;
    }

    let y: number | undefined;
    let mo: number | undefined;
    let d: number | undefined;
    let inferred = false;
    const needReceived = (why: string): boolean => {
      if (receivedMs === null) {
        addErr(receivedErr ?? `${why} needs ctx.receivedAt, which is not set`);
        return false;
      }
      return true;
    };

    if (!date) {
      if (!needReceived(`time ${label} without a date`)) continue;
      ({ y, m: mo, d } = localYmd(receivedMs as number, offsetMin));
      inferred = true;
    } else if (date.kind === 'iso' || date.kind === 'named') {
      mo = date.m;
      d = date.d;
      y = date.y;
      if (y === undefined) {
        if (!needReceived('a date without a year')) continue;
        y = localYmd(receivedMs as number, offsetMin).y;
        inferred = true;
      }
    } else if (date.kind === 'slash') {
      const a = date.a as number;
      const b = date.b as number;
      let mm: number;
      let dd: number;
      if (a > 12 && b <= 12) [dd, mm] = [a, b];
      else if (b > 12 && a <= 12) [mm, dd] = [a, b];
      else if (a <= 12 && b <= 12 && a === b) [mm, dd] = [a, b];
      else if (a <= 12 && b <= 12) {
        addErr(`ambiguous numeric date ${a}/${b}${date.y ? `/${date.y}` : ''} (day/month order unknown)`);
        continue;
      } else {
        addErr(`invalid numeric date ${a}/${b}`);
        continue;
      }
      mo = mm;
      d = dd;
      y = date.y;
      if (y === undefined) {
        if (!needReceived('a date without a year')) continue;
        y = localYmd(receivedMs as number, offsetMin).y;
        inferred = true;
      }
    } else {
      // relative word
      const w = date.word as string;
      if (w === 'tonight') {
        addErr('relative word "tonight" is not supported; give an explicit date');
        continue;
      }
      if (!needReceived(`relative date "${w}"`)) continue;
      const base = localYmd(receivedMs as number, offsetMin);
      const delta = w === 'tomorrow' || w === 'tmrw' ? 1 : w === 'yesterday' ? -1 : 0;
      const shifted = new Date(Date.UTC(base.y, base.m - 1, base.d + delta));
      y = shifted.getUTCFullYear();
      mo = shifted.getUTCMonth() + 1;
      d = shifted.getUTCDate();
      inferred = true;
    }

    if (y === undefined || mo === undefined || d === undefined || y < 2000 || y > 2100) {
      addErr('year out of the supported range 2000-2100');
      continue;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) {
      addErr(`invalid calendar date ${y}-${mo}-${d}`);
      continue;
    }
    const ms = Date.UTC(y, mo - 1, d, t.h, t.mi, t.s) - offsetMin * 60000;
    if (opts.pastEvent) {
      // A past event cannot be later than the email that reports it (small skew allowed).
      const limit = receivedMs ?? Date.now(); // without ctx.receivedAt the wall clock is the only bound available
      if (ms > limit + GRACE_MS) {
        addErr(
          inferred
            ? `date/time inferred from the email's received time would be in the future of that email; the quote must state the full date (time ${label})`
            : `time ${label} on ${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')} is in the future of ${receivedMs !== null ? 'the email' : 'now'}; a past event cannot be later than the message that reports it`,
        );
        continue;
      }
    } else if (inferred && receivedMs !== null && ms < receivedMs - GRACE_MS) {
      addErr(`date/time inferred from the email's received time would be before that email; the quote must state the full date (time ${label})`);
      continue;
    }
    if (!candidates.some((c) => c.ms === ms)) candidates.push({ ms, iso: msToIso(ms) });
  }
  return { candidates, errors };
}
