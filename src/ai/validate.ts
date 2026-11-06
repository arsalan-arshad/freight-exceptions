// Deterministic gate for drafted text. See "HOW IT DECIDES" and "NOT GUARANTEED" below. Word lists live in phrases.ts.
//
// HOW IT DECIDES
//  1. Everything is NFKC-normalised first (full-width digits become ASCII). Any remaining numeric glyph that is not an
//     ASCII digit (\p{N}: Arabic-Indic digits, dingbat/circled digits, ...), invisible/bidi characters, and any letter
//     from a non-Latin script (CJK, Cyrillic, Arabic, Greek, ...) is rejected, unless that exact string is in a fact.
//  2. Free-text facts (carrier, customer, names, notes: anything that is not a rule-computed value, see factKind) are
//     only trusted if they are short, Latin-script and plain (isSafeFreeText). A trusted free-text value may be quoted
//     verbatim; it is cut out of the text before the other checks, and its digits are NEVER allowed elsewhere. Digits
//     are allowed only from the reference and from rule-computed facts (times, amounts, durations, counts).
//  3. Digit tokens: split on whitespace and en/em dashes, trim edge punctuation; every token with a digit must match a
//     token of an allowed fact value. Matching ignores case, treats '-', '/' and '_' alike, drops thousands commas and
//     trailing decimal zeros ("1,250.00" == "1250"); leading zeros matter. ISO datetimes also allow their date, HH:MM,
//     HH:MM:SS and offset as written; the display format "2026-11-05 16:57 UTC" and durations like "5h 12m" work because
//     their space-separated pieces are tokens. Nothing is converted ("2:00pm", "Nov 5" are rejected).
//  4. Spelled-out numbers: every run of English number words ("twelve", "twenty-four", "one thousand", "fourteen
//     thirty") must be well-formed and equal a number present in the facts, with or without a unit; a lone "one"
//     without a unit is allowed ("no one"). "a/an" + hour/day/... and ordinals from "fourth" up are blocked. Number words
//     of Spanish/French/German/Portuguese/Italian (phrases.ts) are blocked unless the word is in a fact.
//  5. Vague or relative quantity/timing without digits ("a couple of", "a dozen", "a few hours", "next week", "later
//     today", "by end of day", "within the hour") and invented time words (noon, tomorrow, weekdays) are blocked.
//  6. URLs, bare domains and emails unless the exact string is in a fact. Placeholder junk. Empty / over-long text
//     (only the first maxLength chars are analysed further).
//  7. Promises, threats, blame, insults, profanity, commitments (payment, costs, charges, rights, contract), unverified
//     incident claims ("arrested", "we confirm"), prompt-injection echoes.
//  8. Party: carrier-facing rules reject words that address someone else (customer, shipper, consignee) and any
//     greeting that is not at the very start; DETENTION is an internal note and rejects any greeting.
//  All violations are returned, not just the first.
//
// NOT GUARANTEED (documented limits; a person approves every message)
//  - Wrong-party or false-status sentences that use none of the words above ("The truck is at the Springfield dock.",
//    "Your colleague already agreed to this.") cannot be detected deterministically. See validate.limits.test.ts.
//  - Names and references without digits: a wrong carrier name is not verified.
//  - Number words in languages other than the five listed, misspellings, or numbers hidden in other Latin-script words.
//  - A number can be reused in the wrong place (a real fact in a false sentence).
import type { ExceptionCase } from '../core/types';
import type { DraftValidation } from './types';
import {
  BIG, CLAIM_PATTERNS, FOREIGN_COMPOUND_RE, FOREIGN_NUMBER_WORDS, GREETING_RE, INJECTION_PATTERNS, INSULT_PATTERNS, ONES,
  ORDINAL_RE, PAYMENT_INSTRUCTION_RE, PLACEHOLDER_PATTERNS, PROMISE_PATTERNS, SINGULAR_UNITS, TEENS, TENS, TIMEISH_RE, UNITS,
  VAGUE_PATTERNS, WRONG_PARTY_RE,
} from './phrases';

export const MAX_DRAFT_LENGTH = 2000;

export interface ValidateOptions {
  /** Maximum characters. Default MAX_DRAFT_LENGTH. Use a smaller value for subjects. */
  maxLength?: number;
}

// ---- fact classification ----------------------------------------------------------------------------------------
export type FactKind = 'reference' | 'computed' | 'free';

const REFERENCE_KEYS = new Set(['reference', 'ref', 'loadnumber', 'loadref', 'shipmentreference']);
const DENY_KEY = /(carrier|customer|shipper|consignee|broker|driver|company|name|note|comment|descr|memo|message|excerpt|address|contact|label|title|summary|subject|body|email|phone|url|link)/;
const ALLOW_EXACT = new Set(['asof', 'stop', 'direction', 'stillonsite']);
const ALLOW_SUFFIX = /(?:at|start|end|eta|text|minutes|hours|amount|rate|currency|percent|threshold|time|late|overdue|delivered|update|pickup|delivery|dwell|difference|since)$/;
const ALLOW_PREFIX = /^(?:arrived|departed|delivered|picked|invoice|agreed|tolerance|difference|projected|hours|minutes|detention|dwell|free|overdue|latest|last|pickup|delivery|noupdate|nopod|eta)/;

function normKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * 'reference': the load reference (digits allowed). 'computed': values the rules engine produced (times, amounts,
 * durations, counts, enums). 'free': everything else (names, notes, anything a person or sender typed).
 * Numbers are always computed. Unknown string keys default to 'free' (the cautious side).
 */
export function factKind(key: string, value: unknown): FactKind {
  if (typeof value === 'number') return 'computed';
  const k = normKey(key);
  if (REFERENCE_KEYS.has(k)) return 'reference';
  if (DENY_KEY.test(k)) return 'free';
  if (ALLOW_EXACT.has(k) || ALLOW_SUFFIX.test(k) || ALLOW_PREFIX.test(k)) return 'computed';
  return 'free';
}

const FREE_TEXT_CHARS = /^[\p{Script=Latin}\p{M}0-9 .,&'()/#-]+$/u;
const LINKISH = /@|https?:|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|us|biz|info|ru|cn|xyz|app|dev|ly|gl|me|tk|top|site|online|link|click)\b/i;

/**
 * Conservative gate for typed text that may be quoted in a draft or shown to a model (carrier, customer, reference...):
 * <= 60 chars, Latin letters (accents ok), digits, space and . , & ' ( ) / # - only; no links, no payment-instruction words,
 * no long digit runs, and none of the junk/threat/insult/number-word patterns.
 */
export function isSafeFreeText(v: string): boolean {
  if (typeof v !== 'string') return false;
  const s = nfkc(v).replace(/[\u2018\u2019]/g, "'").trim();
  if (s.length === 0 || s.length > 60) return false;
  if (!FREE_TEXT_CHARS.test(s)) return false;
  if (/\d{7,}/.test(s) || (s.match(/\d/g)?.length ?? 0) > 10) return false;
  if (LINKISH.test(s) || PAYMENT_INSTRUCTION_RE.test(s)) return false;
  return patternViolations(s, EMPTY_INDEX).length === 0;
}

// ---- tokens and keys --------------------------------------------------------------------------------------------
const EDGE_START = /^[\s"'`\u201c\u201d\u2018\u2019()[\]{}<>.,;:!?*_#$\u20ac\u00a3\u00a5~|\\]+/;
const EDGE_END = /[\s"'`\u201c\u201d\u2018\u2019()[\]{}<>.,;:!?*_#~|\\]+$/;

function nfkc(s: string): string {
  return s.normalize('NFKC').replace(/\u2212/g, '-');
}

export function tokenize(s: string): string[] {
  return nfkc(s)
    .split(/[\s\u2013\u2014]+/)
    .map((t) => t.replace(EDGE_START, '').replace(EDGE_END, ''))
    .filter((t) => t !== '');
}

export function tokenKey(tok: string): string {
  let k = tok.toLowerCase().replace(/[/_]/g, '-');
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(k)) k = k.replace(/,/g, '');
  if (/^\d+\.\d+$/.test(k)) k = k.replace(/0+$/, '').replace(/\.$/, '');
  return k;
}

interface FactIndex {
  keys: Set<string>;
  numbers: Set<string>;
  words: Set<string>;
  lowerText: string;
  /** Trusted free-text values that may be quoted verbatim (cut out before checking). */
  freeValues: string[];
}

const EMPTY_INDEX: FactIndex = { keys: new Set(), numbers: new Set(), words: new Set(), lowerText: '', freeValues: [] };

function factString(v: unknown): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return typeof v === 'string' ? v : '';
}

function indexFacts(facts: Record<string, string | number> | undefined): FactIndex {
  const keys = new Set<string>();
  const numbers = new Set<string>();
  const words = new Set<string>();
  const freeValues: string[] = [];
  const texts: string[] = [];
  for (const [fk, v] of Object.entries(facts ?? {})) {
    const s = nfkc(factString(v));
    texts.push(s.toLowerCase()); // URLs/emails may match any fact text; digits and words only come from trusted facts
    const kind = factKind(fk, v);
    if (kind === 'free') {
      if (isSafeFreeText(s)) freeValues.push(s.trim());
      continue;
    }
    if (kind === 'reference' && !isSafeFreeText(s)) continue;
    for (const w of s.toLowerCase().match(/[a-z]+/g) ?? []) words.add(w);
    for (const t of tokenize(s)) {
      keys.add(tokenKey(t));
      const iso = /^(\d{4}-\d{2}-\d{2})[tT](\d{2}:\d{2})(:\d{2})?(?:\.\d+)?(z|[+-]\d{2}:?\d{2})?$/i.exec(t);
      if (iso) {
        keys.add(iso[1]!);
        keys.add(iso[2]!);
        if (iso[3]) keys.add(iso[2]! + iso[3]);
        const off = iso[4];
        if (off && off.toLowerCase() !== 'z') {
          const compact = off.replace(':', '');
          keys.add(compact);
          keys.add(`${compact.slice(0, 3)}:${compact.slice(3)}`);
        }
      }
      const clock = /^(\d{2}:\d{2}):\d{2}$/.exec(t);
      if (clock) keys.add(clock[1]!);
      const unit = /^(\d+(?:\.\d+)?)(?:h|hr|hrs|m|min|mins|d)$/i.exec(t);
      if (unit) keys.add(tokenKey(unit[1]!));
    }
  }
  for (const k of keys) if (/^\d+(\.\d+)?$/.test(k)) numbers.add(String(Number(k)));
  freeValues.sort((a, b) => b.length - a.length);
  return { keys, numbers, words, lowerText: texts.join('\n'), freeValues };
}

function tokenAllowed(tok: string, idx: FactIndex): boolean {
  if (idx.keys.has(tokenKey(tok))) return true;
  const range = /^(\d{1,2}:\d{2}(?::\d{2})?)-(\d{1,2}:\d{2}(?::\d{2})?)$/.exec(tok);
  return !!range && idx.keys.has(range[1]!) && idx.keys.has(range[2]!);
}

// ---- spelled-out numbers ----------------------------------------------------------------------------------------
type Kind = 'o' | 't' | 'T' | 'h' | 'b' | 'z';
const NEXT_OK: Record<Kind, string> = { o: 'hb', t: 'b', T: 'ob', h: 'otTb', b: 'otThb', z: '' };

function numKind(w: string | undefined): Kind | undefined {
  if (w === undefined) return undefined;
  if (w === 'zero') return 'z';
  if (w in ONES) return 'o';
  if (w in TEENS) return 't';
  if (w in TENS) return 'T';
  if (w === 'hundred') return 'h';
  if (w in BIG) return 'b';
  return undefined;
}

interface SpelledRun {
  phrase: string;
  value: number;
  wellFormed: boolean;
  unit: boolean;
  lone: string | undefined;
}

function spelledRuns(text: string): SpelledRun[] {
  const words = text.toLowerCase().replace(/(?<=[a-z])-(?=[a-z])/g, ' ').match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
  const out: SpelledRun[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if ((w === 'a' || w === 'an') && SINGULAR_UNITS.has(words[i + 1] ?? '')) {
      out.push({ phrase: `${w} ${words[i + 1]}`, value: 1, wellFormed: true, unit: true, lone: undefined });
      continue;
    }
    if (numKind(w) === undefined) continue;
    let j = i;
    let total = 0;
    let cur = 0;
    let well = true;
    let prev: Kind | undefined;
    while (numKind(words[j]) !== undefined) {
      const x = words[j]!;
      const k = numKind(x)!;
      if (prev !== undefined && !NEXT_OK[prev].includes(k)) well = false;
      prev = k;
      if (k === 'h') cur = (cur || 1) * 100;
      else if (k === 'b') {
        total += (cur || 1) * (BIG[x] ?? 1);
        cur = 0;
      } else cur += ONES[x] ?? TEENS[x] ?? TENS[x] ?? 0;
      j++;
    }
    const unit = UNITS.has(words[j] ?? '');
    out.push({ phrase: words.slice(i, unit ? j + 1 : j).join(' '), value: total + cur, wellFormed: well, unit, lone: j - i === 1 ? w : undefined });
    i = j - 1;
  }
  return out;
}

function deaccent(s: string): string {
  return s.toLowerCase().replace(/\u00df/g, 'ss').normalize('NFD').replace(/\p{M}/gu, '');
}

// ---- pattern checks that do not depend on digits ------------------------------------------------------------------
const CURRENCY_SYMBOLS: Array<[string, string[]]> = [
  ['$', ['usd', 'cad', 'aud', 'mxn', 'nzd']],
  ['\u20ac', ['eur']],
  ['\u00a3', ['gbp']],
];

function clip(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n)}...` : s;
}

/** All pattern-based violations (everything except digit-token matching, URLs and party rules). `text` must be NFKC. */
function patternViolations(text: string, idx: FactIndex): string[] {
  const out: string[] = [];
  const add = (v: string) => {
    if (!out.includes(v)) out.push(v);
  };
  for (const [re, label] of PLACEHOLDER_PATTERNS) if (re.test(text)) add(`placeholder junk: ${label}`);
  for (const re of INJECTION_PATTERNS) if (re.test(text)) add('contains prompt-injection or assistant-meta text');
  for (const [re, label] of PROMISE_PATTERNS) {
    const m = re.exec(text);
    if (m) add(`${label} not made by a person: "${clip(m[0])}"`);
  }
  for (const [re, label] of INSULT_PATTERNS) {
    const m = re.exec(text);
    if (m) add(`${label} (insult or profanity): "${clip(m[0])}"`);
  }
  for (const [re, label] of CLAIM_PATTERNS) {
    const m = re.exec(text);
    if (m) add(`${label}: "${clip(m[0])}"`);
  }
  for (const [re, label] of VAGUE_PATTERNS) {
    const m = re.exec(text);
    if (m) add(`${label} not in case facts: "${clip(m[0])}"`);
  }
  const ord = ORDINAL_RE.exec(text);
  if (ord) add(`ordinal number word (possible date): "${clip(ord[0])}"`);

  for (const r of spelledRuns(text)) {
    if (r.lone === 'one' && !r.unit) continue; // "no one", "one moment"
    if (!r.wellFormed) add(`spelled-out number pair or time: "${clip(r.phrase)}"`);
    else if (!idx.numbers.has(String(r.value))) add(`spelled-out number not found in case facts: "${clip(r.phrase)}"`);
  }
  for (const w of deaccent(text).match(/[a-z]+/g) ?? []) {
    if ((FOREIGN_NUMBER_WORDS.has(w) || FOREIGN_COMPOUND_RE.test(w)) && !idx.words.has(w)) add(`number word in another language: "${clip(w)}"`);
  }
  for (const m of text.matchAll(TIMEISH_RE)) {
    const w = m[1]!.toLowerCase();
    const parts = w.match(/[a-z]+/g) ?? [];
    if (!parts.every((p) => idx.words.has(p))) add(`time or deadline wording not in case facts: "${clip(m[0])}"`);
  }
  return out;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const URL_RE =
  /(?:\b(?:https?|ftp):\/\/|\bwww\.)[^\s<>"')]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|us|biz|info|ru|cn|xyz|app|dev|ly|gl|me|tk|top|site|online|link|click)\b(?:\/[^\s<>"')]*)?/gi;
const NON_LATIN_LETTERS = /(?:(?!\p{Script=Latin})\p{L})+/gu;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function validateDraft(text: string, c: ExceptionCase, opts: ValidateOptions = {}): DraftValidation {
  const violations: string[] = [];
  const add = (v: string) => {
    if (!violations.includes(v)) violations.push(v);
  };
  const maxLength = opts.maxLength ?? MAX_DRAFT_LENGTH;

  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, violations: ['empty text'] };
  }
  if (text.length > maxLength) {
    add(`too long: ${text.length} characters (max ${maxLength})`);
    text = text.slice(0, maxLength); // keep the remaining checks cheap on hostile, huge replies
  }
  if (/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/.test(text)) add('contains invisible or bidirectional control characters');

  const norm = nfkc(text).normalize('NFC');
  const idx = indexFacts(c?.facts);

  // numeric glyphs that are not ASCII digits (NFKC already folded the foldable ones)
  for (const ch of norm) {
    if (/\p{N}/u.test(ch) && !/[0-9]/.test(ch)) {
      add('contains non-ASCII digits or numeric glyphs');
      break;
    }
  }
  // letters from non-Latin scripts: number words in other alphabets would slip past every word list
  for (const m of norm.matchAll(NON_LATIN_LETTERS)) {
    if (!idx.lowerText.includes(m[0].toLowerCase())) add(`non-Latin script text not in case facts: "${clip(m[0])}"`);
  }

  // cut out verbatim quotes of trusted free-text facts (their digits and words are not trusted elsewhere)
  let work = norm;
  for (const fv of idx.freeValues) work = work.replace(new RegExp(escapeRe(fv), 'gi'), ' ');

  for (const v of patternViolations(work, idx)) add(v);

  // emails and URLs (emails first so their domain is not reported twice)
  const lower = work.toLowerCase();
  let rest = lower;
  for (const m of lower.matchAll(EMAIL_RE)) {
    const e = m[0].replace(/[.,;:]+$/, '');
    if (!idx.lowerText.includes(e)) add(`email address not in case facts: "${clip(e)}"`);
    rest = rest.replace(m[0], ' ');
  }
  for (const m of rest.matchAll(URL_RE)) {
    const u = m[0].replace(/[.,;:]+$/, '');
    if (!idx.lowerText.includes(u)) add(`URL or domain not in case facts: "${clip(u)}"`);
  }

  // digit tokens
  for (const tok of tokenize(work)) {
    if (!/\d/.test(tok)) continue;
    if (!tokenAllowed(tok, idx)) add(`number, time or reference not found in case facts: "${clip(tok)}"`);
  }

  // currency symbols must agree with a currency code in the facts
  for (const [sym, codes] of CURRENCY_SYMBOLS) {
    if (work.includes(sym) && !codes.some((code) => idx.words.has(code))) add(`currency symbol "${sym}" does not match any currency in case facts`);
  }

  // who is being addressed
  const internal = c?.ruleId === 'DETENTION';
  const greetings = [...work.trimStart().matchAll(GREETING_RE)];
  if (internal) {
    if (greetings.length > 0) add('internal note must not greet or address the carrier');
  } else {
    const wp = WRONG_PARTY_RE.exec(work);
    if (wp && !idx.words.has(wp[0].toLowerCase())) add(`addresses or mentions another party in a carrier message: "${clip(wp[0])}"`);
    // a greeting may open the text or any line (a subject line may come first), but not appear mid-sentence
    const t = work.trimStart();
    if (greetings.some((g) => (g.index ?? 0) > 0 && !/\n[ \t]*$/.test(t.slice(0, g.index)))) add('greeting that is not at the start of a line');
  }

  return { ok: violations.length === 0, violations };
}
