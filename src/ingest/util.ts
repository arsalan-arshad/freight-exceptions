// Small shared helpers for the ingest module. Pure functions, no dependencies.

const DASH_GLYPHS = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;
const isAlnumChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/**
 * Normalises a load/reference number for matching: NFKC, upper case, whitespace / underscores / every dash glyph
 * unified to a single "-" separator, leading and trailing punctuation trimmed. Separator POSITIONS are kept, so
 * "LD-12-34" and "LD-1-234" differ, while "ld 1001", "LD_1001" and "LD\u20101001" all equal "LD-1001".
 * (Consequence: "LD1001" and "LD-1001" are different references.)
 */
export function normalizeReference(ref: string): string {
  const s = ref.normalize('NFKC').toUpperCase().replace(DASH_GLYPHS, '-').replace(/[\s_-]+/g, '-');
  let a = 0;
  let b = s.length;
  while (a < b && !isAlnumChar(s[a])) a++;
  while (b > a && !isAlnumChar(s[b - 1])) b--;
  return s.slice(a, b);
}

/** Number of letters/digits in a string (separators ignored). */
export function alnumLength(s: string): number {
  let n = 0;
  for (const c of s) if (isAlnumChar(c)) n++;
  return n;
}

/** Stable, readable id for a shipment: lower case, runs of non-alphanumerics become one hyphen. */
export function slugifyReference(ref: string): string {
  return ref
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

export function truncate(s: string, max = 80): string {
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}

export type AmountParse = { ok: true; value: number } | { ok: false; reason: string };

function thousandsPattern(sep: string): RegExp {
  const esc = sep === '.' ? '\\.' : ',';
  return new RegExp(`^\\d{1,3}(?:${esc}\\d{3})+$`);
}

/**
 * Parses a plain numeric string (digits plus , and . only) into a number.
 * Only unambiguous forms are accepted:
 *   1250 | 1250.5 | 1,250 | 1,250.00 | 1.250,00 | 1,250,000 | 1.250.000 | 850,50
 * ONE rule for a lone separator followed by exactly three digits ("1.250", "1,250"): it is ambiguous and rejected,
 * except "1,250" when opts.groupingComma is true (the caller knows the amount is in a dot-decimal currency such as
 * USD/GBP/CAD, so the comma can only be a thousands separator). "1.250" is always rejected.
 * Also rejected: "1,2,3", "12,345,6", "1,250.000".
 */
export function parseAmountNumber(raw: string, opts: { groupingComma?: boolean } = {}): AmountParse {
  const s = raw.trim();
  if (!/^[0-9.,]+$/.test(s) || !/\d/.test(s)) return { ok: false, reason: 'not a plain number' };
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  let digits: string;
  let frac = '';
  if (hasDot && hasComma) {
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    const idx = s.lastIndexOf(dec);
    const intPart = s.slice(0, idx);
    frac = s.slice(idx + 1);
    if (intPart.includes(dec)) return { ok: false, reason: 'mixed separators' };
    if (!thousandsPattern(thou).test(intPart)) return { ok: false, reason: 'invalid thousands grouping' };
    if (!/^\d{1,2}$/.test(frac)) return { ok: false, reason: 'invalid decimals' };
    digits = intPart.split(thou).join('');
  } else if (hasDot || hasComma) {
    const sep = hasDot ? '.' : ',';
    const parts = s.split(sep);
    if (parts.length > 2) {
      if (!thousandsPattern(sep).test(s)) return { ok: false, reason: 'invalid thousands grouping' };
      digits = parts.join('');
    } else {
      const i = parts[0] ?? '';
      const f = parts[1] ?? '';
      if (i === '' || f === '') return { ok: false, reason: 'malformed number' };
      if (f.length <= 2) {
        digits = i;
        frac = f;
      } else if (f.length === 3 && sep === ',' && i.length <= 3 && opts.groupingComma === true) {
        digits = i + f; // "1,250" = 1250 ONLY when the caller knows the currency uses "." for decimals ($, USD, GBP ...)
      } else if (f.length === 3 && i.length <= 3) {
        return { ok: false, reason: `ambiguous number "${s}" (thousands separator or decimals?)` };
      } else {
        return { ok: false, reason: 'malformed number' };
      }
    }
  } else {
    digits = s;
  }
  const n = Number(frac ? `${digits}.${frac}` : digits);
  if (!Number.isFinite(n)) return { ok: false, reason: 'not finite' };
  return { ok: true, value: n };
}

// ---------------------------------------------------------------------------------------------
// Currencies
// ---------------------------------------------------------------------------------------------

const ISO_4217 = new Set(
  (
    'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK ' +
    'DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR ' +
    'KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN ' +
    'PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH ' +
    'UGX USD UYU UZS VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWL'
  ).split(' '),
);

export function isIsoCurrency(code: string): boolean {
  return ISO_4217.has(code.toUpperCase());
}

/** Currencies written with "." as the decimal mark and "," for thousands (so "1,250" can only mean 1250). */
const DOT_DECIMAL = new Set('USD CAD AUD NZD MXN GBP SGD HKD JPY CNY INR KRW TWD THB PHP ILS'.split(' '));

export function usesDotDecimal(code: string | undefined): boolean {
  return code !== undefined && DOT_DECIMAL.has(code.toUpperCase());
}
