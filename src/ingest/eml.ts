// Minimal RFC 5322 / MIME reader. Never throws on odd input; returns what it can.

export interface ParsedEmail {
  subject?: string;
  from?: string;
  /** Raw Date header value (use parseEmailDate to turn it into an ISO instant). */
  date?: string;
  /** Plain text body, control characters removed, capped at MAX_BODY_CHARS. */
  body: string;
  /** True when the body was cut at MAX_BODY_CHARS. */
  truncated?: boolean;
}

export const MAX_BODY_CHARS = 100_000;
const MAX_RAW_CHARS = 8_000_000;
const MAX_PART_CHARS = 1_000_000;
const MAX_DEPTH = 8;
const MAX_PARTS = 200;

function decodeBytes(bytes: Uint8Array, charset?: string): string {
  const label = (charset ?? 'utf-8').trim().toLowerCase().replace(/^"|"$/g, '') || 'utf-8';
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

function qpToBytes(s: string): Uint8Array {
  const joined = s.replace(/=[ \t]*\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    const c = joined[i] as string;
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
      out.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (c.charCodeAt(0) < 128) {
      out.push(c.charCodeAt(0));
    } else {
      for (const b of Buffer.from(c, 'utf8')) out.push(b);
    }
  }
  return Uint8Array.from(out);
}

/** RFC 2047 encoded-words in header values. */
export function decodeEncodedWords(s: string): string {
  const collapsed = s.replace(/(\?=)\s+(?==\?)/g, '$1');
  return collapsed.replace(/=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, cs: string, enc: string, data: string) => {
    try {
      const charset = cs.split('*')[0];
      if (enc.toLowerCase() === 'b') return decodeBytes(Buffer.from(data, 'base64'), charset);
      return decodeBytes(qpToBytes(data.replace(/_/g, ' ')), charset);
    } catch {
      return _m;
    }
  });
}

interface Headers {
  get(name: string): string | undefined;
}

function parseHeaderBlock(block: string): Headers {
  const lines = block.split('\n');
  const unfolded: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length > 0) unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    else if (line.trim() !== '') unfolded.push(line);
  }
  const map = new Map<string, string>();
  for (const l of unfolded) {
    const idx = l.indexOf(':');
    if (idx <= 0) continue;
    const name = l.slice(0, idx).trim().toLowerCase();
    if (!/^[\x21-\x39\x3b-\x7e]+$/.test(name)) continue;
    if (!map.has(name)) map.set(name, l.slice(idx + 1).trim());
  }
  return { get: (n) => map.get(n.toLowerCase()) };
}

const HEADER_LIKE = /^[\x21-\x39\x3b-\x7e]+:/;

function splitHeadBody(text: string): { head: string; body: string } {
  let t = text;
  const mbox = /^From \S+[^\n]*\n([^\n]*)/.exec(t); // mbox "From " separator line, only if headers follow
  if (mbox && HEADER_LIKE.test(mbox[1] ?? '')) t = t.replace(/^[^\n]*\n/, '');
  if (t.startsWith('\n')) return { head: '', body: t.slice(1) };
  const firstLine = t.split('\n', 1)[0] ?? '';
  if (!HEADER_LIKE.test(firstLine)) return { head: '', body: t };
  const idx = t.indexOf('\n\n');
  if (idx === -1) return { head: t, body: '' };
  return { head: t.slice(0, idx), body: t.slice(idx + 2) };
}

function parseParams(v: string | undefined): { value: string; params: Record<string, string> } {
  const out: Record<string, string> = {};
  if (!v) return { value: '', params: out };
  const semi = v.indexOf(';');
  const value = (semi === -1 ? v : v.slice(0, semi)).trim().toLowerCase();
  const re = /;\s*([\w*-]+)\s*=\s*(?:"([^"]*)"|([^;\s]*))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(v)) !== null) out[(m[1] as string).toLowerCase()] = (m[2] ?? m[3] ?? '').trim();
  return { value, params: out };
}

function decodeBody(body: string, cte: string | undefined, charset: string | undefined): string {
  const b = body.length > MAX_PART_CHARS ? body.slice(0, MAX_PART_CHARS) : body;
  const enc = (cte ?? '').trim().toLowerCase();
  if (enc === 'quoted-printable') return decodeBytes(qpToBytes(b), charset);
  if (enc === 'base64') return decodeBytes(Buffer.from(b.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64'), charset);
  return b;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026' };

/** Only this much of an HTML part is processed. */
export const MAX_HTML_CHARS = 100_000;
const MAX_TAG_CHARS = 10_000;
const BLOCK_TAGS = new Set(['p', 'div', 'tr', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'blockquote']);

function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

/**
 * HTML -> text in ONE linear pass (no backtracking regexes on markup). Input is capped at MAX_HTML_CHARS.
 * Drops comments, <script>, <style> and <head> content; <br> and closing block tags become newlines; an unterminated
 * comment/script/style drops the rest of the document (like a browser); a "<" that does not start a tag stays as text.
 */
export function htmlToText(htmlIn: string): string {
  const html = htmlIn.length > MAX_HTML_CHARS ? htmlIn.slice(0, MAX_HTML_CHARS) : htmlIn;
  const n = html.length;
  const out: string[] = [];
  let lower: string | undefined;
  let gtPos = -2; // cached position of the next '>' at or after the last search start; -1 = none left
  const nextGt = (from: number): number => {
    if (gtPos === -1) return -1;
    if (gtPos >= from) return gtPos;
    gtPos = html.indexOf('>', from);
    return gtPos;
  };
  const noClose = new Set<string>();
  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      out.push(html.slice(i));
      break;
    }
    if (lt > i) out.push(html.slice(i, lt));
    i = lt;
    if (html.startsWith('<!--', i)) {
      if (noClose.has('-->')) break;
      const end = html.indexOf('-->', i + 4);
      if (end === -1) break;
      i = end + 3;
      out.push(' ');
      continue;
    }
    const c = html[i + 1] ?? '';
    if (!/[A-Za-z/!?]/.test(c)) {
      out.push('<');
      i++;
      continue;
    }
    const g = nextGt(i + 1);
    if (g === -1 || g - i > MAX_TAG_CHARS) {
      out.push('<');
      i++;
      continue;
    }
    const head = html.slice(i + 1, Math.min(g, i + 40));
    const m = /^(\/?)([A-Za-z][A-Za-z0-9]*)/.exec(head);
    const closing = m?.[1] === '/';
    const name = m ? asciiLower(m[2] as string) : '';
    const selfClosed = html[g - 1] === '/';
    if (m && !closing && !selfClosed && (name === 'script' || name === 'style' || name === 'head')) {
      lower ??= asciiLower(html);
      const key = `</${name}`;
      const close = noClose.has(key) ? -1 : lower.indexOf(key, g);
      if (close === -1) {
        noClose.add(key);
        if (name === 'head') {
          i = g + 1;
          continue;
        }
        break; // unterminated script/style: drop the rest
      }
      const end = lower.indexOf('>', close);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    if (name === 'br' || (closing && BLOCK_TAGS.has(name))) out.push('\n');
    i = g + 1;
  }
  let s = out.join('');
  s = s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,10});/gi, (full, e: string) => {
    if (e[0] === '#') {
      const cp = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : full;
      } catch {
        return full;
      }
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? full;
  });
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

interface Collected {
  text?: string;
  html?: string;
  parts: number;
}

function collect(head: Headers, body: string, depth: number, acc: Collected): void {
  if (depth > MAX_DEPTH || acc.parts > MAX_PARTS) return;
  acc.parts++;
  const ct = parseParams(head.get('content-type'));
  const type = ct.value || 'text/plain';
  const disp = (head.get('content-disposition') ?? '').trim().toLowerCase();
  if (disp.startsWith('attachment')) return;
  if (type.startsWith('multipart/')) {
    const boundary = ct.params['boundary'];
    if (!boundary) return;
    const lines = body.split('\n');
    const parts: string[] = [];
    let cur: string[] | null = null;
    for (const line of lines) {
      const t = line.trimEnd();
      if (t === `--${boundary}`) {
        if (cur) parts.push(cur.join('\n'));
        cur = [];
      } else if (t === `--${boundary}--`) {
        if (cur) parts.push(cur.join('\n'));
        cur = null;
        break;
      } else if (cur) cur.push(line);
    }
    if (cur) parts.push(cur.join('\n'));
    for (const p of parts) {
      const { head: h, body: b } = splitHeadBody(p);
      collect(parseHeaderBlock(h), b, depth + 1, acc);
    }
    return;
  }
  if (type === 'text/plain' && acc.text === undefined) {
    acc.text = decodeBody(body, head.get('content-transfer-encoding'), ct.params['charset']);
  } else if (type === 'text/html' && acc.html === undefined) {
    acc.html = decodeBody(body, head.get('content-transfer-encoding'), ct.params['charset']);
  }
}

function clean(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/�+/g, '�');
}

function headerText(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const out = clean(decodeEncodedWords(v)).replace(/\s+/g, ' ').trim().slice(0, 1000);
  return out === '' ? undefined : out;
}

/**
 * Parses a raw RFC 5322 message (an .eml file or pasted source). If the text has no recognisable
 * headers it is treated as a plain body. Picks text/plain from multipart messages (first match,
 * attachments skipped); falls back to tag-stripped text/html. Body is capped at 100,000 chars and input at 8M chars.
 */
export function parseEml(raw: string): ParsedEmail {
  if (typeof raw !== 'string' || raw === '') return { body: '' };
  const input = raw.length > MAX_RAW_CHARS ? raw.slice(0, MAX_RAW_CHARS) : raw;
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const { head, body } = splitHeadBody(text);
  const headers = parseHeaderBlock(head);
  const acc: Collected = { parts: 0 };
  collect(headers, body, 0, acc);

  let out = acc.text !== undefined && acc.text.trim() !== '' ? acc.text : undefined;
  if (out === undefined && acc.html !== undefined) out = htmlToText(acc.html);
  if (out === undefined) out = acc.text ?? '';
  out = clean(out).trim();
  let truncated = false;
  if (out.length > MAX_BODY_CHARS) {
    out = out.slice(0, MAX_BODY_CHARS);
    truncated = true;
  }
  const res: ParsedEmail = { body: out };
  const subject = headerText(headers.get('subject'));
  const from = headerText(headers.get('from'));
  const date = headerText(headers.get('date'));
  if (subject !== undefined) res.subject = subject;
  if (from !== undefined) res.from = from;
  if (date !== undefined) res.date = date;
  if (truncated) res.truncated = true;
  return res;
}

/**
 * Converts an RFC 5322 Date header ("Wed, 04 Mar 2026 10:00:00 -0500") to an ISO instant, or undefined.
 * Values without a time zone are rejected (they would depend on the machine's local zone).
 */
export function parseEmailDate(date: string | undefined): string | undefined {
  if (!date) return undefined;
  const s = date.replace(/\([^)]*\)/g, '').trim();
  if (!/(?:[+-]\d{4}|\bGMT|\bUT|\bZ|\b[ECMP][SD]T)\s*$/i.test(s)) return undefined;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString().replace('.000Z', 'Z');
}
