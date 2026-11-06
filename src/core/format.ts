// Display formatting. Deterministic, locale-independent (no Intl).

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;

function pad(n: number, width = 2): string {
  return String(Math.abs(Math.trunc(n))).padStart(width, '0');
}

/** ISO 8601 with an explicit offset, e.g. 2026-11-06T14:00:00-05:00 (UTC is written +00:00). */
export function formatInstant(ms: number, offsetMinutes = 0): string {
  const local = new Date(ms + offsetMinutes * MINUTE_MS);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return (
    `${pad(local.getUTCFullYear(), 4)}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Display time for people and drafts: always UTC, "YYYY-MM-DD HH:mm UTC", seconds dropped. */
export function formatUtc(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/**
 * 45 -> "45m", 300 -> "5h", 312 -> "5h 12m", 3100 -> "2d 3h" (from 48h up: days and hours, minutes dropped).
 */
export function formatDuration(totalMinutes: number): string {
  const m = Math.max(0, Math.floor(totalMinutes));
  if (m < 60) return `${m}m`;
  if (m >= 48 * 60) {
    const d = Math.floor(m / 1440);
    const h = Math.floor((m % 1440) / 60);
    return h === 0 ? `${d}d` : `${d}d ${h}h`;
  }
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

/** Floating major units -> integer cents (half-up on the decimal representation, sign-symmetric). */
export function toCents(amount: number): number {
  const sign = amount < 0 ? -1 : 1;
  return sign * Math.round((Math.abs(amount) + 1e-9) * 100);
}

/** 125000 cents -> "1,250.00 USD". With signed, positive values get a leading "+". */
export function formatCents(cents: number, currency: string, signed = false): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = cents < 0 ? '-' : signed && cents > 0 ? '+' : '';
  return `${sign}${grouped}.${pad(frac)} ${currency}`;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

/** Elapsed whole minutes, never negative. */
export function wholeMinutes(ms: number): number {
  return Math.max(0, Math.floor(ms / MINUTE_MS));
}
