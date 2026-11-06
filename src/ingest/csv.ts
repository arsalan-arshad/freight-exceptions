import type { Doc, Money, Shipment, SourceRef, StatusEvent, Window } from '../core/types';
import type { CsvParseResult, ParseIssue } from './types';
import { parseDateTimeStrict } from './dates';
import { describeConflicts, mergeTwo, sortDocs, sortEvents } from './merge';
import { isIsoCurrency, normalizeReference, parseAmountNumber, slugifyReference, truncate, usesDotDecimal } from './util';

export interface ParseCsvOptions {
  /** Used in SourceRef.ref ("<sourceName>:row N"). Default "shipments.csv". */
  sourceName?: string;
}

/**
 * Header aliases. Headers are matched case-insensitively after normalising: lower case, every run of
 * non-alphanumerics becomes "_" ("Load #" -> "load", "PU Start" -> "pu_start").
 */
export const HEADER_ALIASES: Record<string, readonly string[]> = {
  reference: ['reference', 'ref', 'ref_no', 'ref_number', 'reference_no', 'reference_number', 'load', 'load_id', 'load_no', 'load_num', 'load_number', 'shipment', 'shipment_id', 'shipment_no', 'shipment_number', 'pro', 'pro_number', 'order_number'],
  customer: ['customer', 'customer_name', 'shipper', 'client'],
  carrier: ['carrier', 'carrier_name', 'trucker'],
  pickup_start: ['pickup_start', 'pu_start', 'pickup_window_start', 'pickup_from', 'pickup_appt_start', 'pu_window_start', 'pu_from', 'pickup_start_time'],
  pickup_end: ['pickup_end', 'pu_end', 'pickup_window_end', 'pickup_to', 'pickup_by', 'pickup_appt_end', 'pu_window_end', 'pu_to', 'pickup_end_time'],
  delivery_start: ['delivery_start', 'del_start', 'dl_start', 'delivery_window_start', 'delivery_from', 'drop_start', 'del_from', 'delivery_start_time'],
  delivery_end: ['delivery_end', 'del_end', 'dl_end', 'delivery_window_end', 'delivery_to', 'delivery_by', 'drop_end', 'del_to', 'delivery_end_time'],
  free_time_minutes: ['free_time_minutes', 'free_time', 'freetime', 'free_minutes', 'free_time_min', 'free_time_mins', 'detention_free_minutes'],
  agreed_rate: ['agreed_rate', 'rate', 'carrier_rate', 'buy_rate', 'contract_rate', 'rate_agreed'],
  currency: ['currency', 'ccy', 'cur', 'currency_code'],
  pickup_arrived_at: ['pickup_arrived_at', 'pu_arrived_at', 'pu_arrival', 'pickup_arrival', 'pickup_arrived', 'pu_arrived', 'pu_in', 'pickup_in'],
  picked_up_at: ['picked_up_at', 'pickup_at', 'picked_up', 'pu_actual', 'pickup_actual', 'actual_pickup', 'loaded_at', 'pu_complete'],
  pickup_departed_at: ['pickup_departed_at', 'pu_departed_at', 'pu_departure', 'pickup_departure', 'pu_out', 'pickup_out', 'pickup_departed', 'pu_departed'],
  delivery_arrived_at: ['delivery_arrived_at', 'del_arrived_at', 'dl_arrived_at', 'del_arrival', 'delivery_arrival', 'delivery_arrived', 'del_arrived', 'del_in'],
  delivery_departed_at: ['delivery_departed_at', 'del_departed_at', 'dl_departed_at', 'del_departure', 'delivery_departure', 'delivery_departed', 'del_departed', 'del_out'],
  delivered_at: ['delivered_at', 'delivery_actual', 'actual_delivery', 'del_actual', 'delivered_on'],
  eta: ['eta', 'delivery_eta', 'current_eta', 'eta_delivery', 'new_eta'],
  last_status_at: ['last_status_at', 'last_update', 'last_update_at', 'last_status_time', 'status_at', 'last_checkcall', 'last_check_call', 'last_check_call_at'],
  last_status_note: ['last_status_note', 'last_status', 'status_note', 'last_note', 'note', 'notes', 'last_update_note'],
  pod_received_at: ['pod_received_at', 'pod_received', 'pod_date', 'pod_at'],
  invoice_amount: ['invoice_amount', 'invoice_total', 'carrier_invoice', 'invoice_amt', 'billed_amount'],
  invoice_received_at: ['invoice_received_at', 'invoice_received', 'invoice_date', 'invoice_at'],
};

const ALIAS_LOOKUP: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [canon, aliases] of Object.entries(HEADER_ALIASES)) for (const a of aliases) m.set(a, canon);
  return m;
})();

export function normalizeHeader(h: string): string {
  return h
    .normalize('NFKC')
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ---------------------------------------------------------------------------------------------
// RFC 4180 reader
// ---------------------------------------------------------------------------------------------

export interface CsvRecords {
  records: string[][];
  delimiter: string;
  unterminatedQuote: boolean;
}

function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === '"') inQ = !inQ;
    else if (!inQ) {
      if (c === '\n' || c === '\r') break;
      if (c in counts) counts[c] = (counts[c] ?? 0) + 1;
    }
  }
  let best = ',';
  for (const d of [';', '\t']) if ((counts[d] ?? 0) > (counts[best] ?? 0)) best = d;
  return best;
}

/** Minimal RFC 4180 reader: quotes, "" escapes, delimiters/newlines inside quotes, CRLF/LF/CR, BOM. */
export function parseCsvRecords(input: string, delimiter?: string): CsvRecords {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delim = delimiter ?? detectDelimiter(text);
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let afterQuote = false; // a quoted section just closed in this field
  let any = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else field += c;
      continue;
    }
    if (c === '"' && field === '' && !afterQuote) {
      inQuotes = true;
      any = true;
    } else if (c === delim) {
      row.push(field);
      field = '';
      afterQuote = false;
      any = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      records.push(row);
      row = [];
      field = '';
      afterQuote = false;
      any = false;
    } else {
      field += c;
      any = true;
    }
  }
  const unterminatedQuote = inQuotes;
  if (any || field !== '' || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  return { records, delimiter: delim, unterminatedQuote };
}

// ---------------------------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------------------------

const MAX_TEXT = 2000;
const CURRENCY_SYMBOLS: Record<string, string> = { '€': 'EUR', '£': 'GBP' };

interface MoneyCell {
  /** the numeric part, with currency words/symbols removed */
  numeric: string;
  /** currency found inside the cell itself ("EUR 1.250,00", "\u20ac850") */
  inlineCurrency?: string;
}

/** Splits an amount cell into its numeric part and an inline ISO currency. Any other word is an error (never guessed). */
function parseMoneyCell(raw: string): { ok: true; cell: MoneyCell } | { ok: false; reason: string } {
  let s = raw.trim();
  let inline: string | undefined;
  for (const w of s.match(/\p{L}+/gu) ?? []) {
    const up = w.toUpperCase();
    if (w.length === 3 && isIsoCurrency(up)) {
      if (inline && inline !== up) return { ok: false, reason: 'conflicting currency markers in amount' };
      inline = up;
    } else {
      return { ok: false, reason: `unrecognised text "${truncate(w, 20)}" in amount (not an ISO 4217 currency code)` };
    }
  }
  s = s.replace(/\p{L}+/gu, ' ');
  for (const [sym, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (s.includes(sym)) {
      if (inline && inline !== code) return { ok: false, reason: 'conflicting currency markers in amount' };
      inline = code;
      s = s.split(sym).join('');
    }
  }
  s = s.replace(/\$/g, '').replace(/\s+/g, '');
  if (s.startsWith('-') || s.startsWith('(')) return { ok: false, reason: 'negative amounts are not supported' };
  return { ok: true, cell: { numeric: s, ...(inline ? { inlineCurrency: inline } : {}) } };
}

/**
 * Parses a shipments CSV (one row per shipment). Never throws: problems are reported in `issues`.
 *
 * Behaviour (documented choices):
 * - Header names are case-insensitive and may use aliases (see HEADER_ALIASES). Delimiter `,` `;` or tab is auto-detected.
 * - Row numbers in issues and source refs are 1-based data rows (header = row 0); blank lines are skipped and not counted.
 * - Times: ISO 8601 or "YYYY-MM-DD HH:mm[:ss]". No offset => UTC (one summary issue per file). Date-only and
 *   ambiguous formats like 03/04/2026 are rejected with an issue and the field is left empty.
 * - Rows without a usable reference are skipped. Duplicate references (same normalised reference) are MERGED:
 *   the first row's values win, later rows only fill blanks; an issue lists any conflicts.
 * - Money: currency from the `currency` column, else a code/symbol inside the cell (EUR, GBP), else "USD" with a summary issue.
 * - Text cells starting with = + - @ are kept verbatim as data (never evaluated) with an informational issue.
 */
export function parseShipmentsCsv(text: string, opts: ParseCsvOptions = {}): CsvParseResult {
  const issues: ParseIssue[] = [];
  const sourceName = opts.sourceName?.trim() || 'shipments.csv';
  if (typeof text !== 'string') {
    return { shipments: [], issues: [{ message: 'input is not text' }] };
  }
  const { records, delimiter, unterminatedQuote } = parseCsvRecords(text);
  if (unterminatedQuote) issues.push({ message: 'a quoted field was never closed; the rest of the file was read as part of that field' });
  if (delimiter !== ',') issues.push({ message: `delimiter ${delimiter === '\t' ? 'TAB' : `"${delimiter}"`} detected from the header line` });

  const isBlank = (r: string[]) => r.every((c) => c.trim() === '');
  const nonBlank = records.filter((r) => !isBlank(r));
  if (nonBlank.length === 0) {
    issues.push({ message: 'file is empty (no header row)' });
    return { shipments: [], issues };
  }
  const header = nonBlank[0] as string[];
  const colIndex = new Map<string, number>();
  const unknown: string[] = [];
  header.forEach((h, idx) => {
    const norm = normalizeHeader(h);
    const canon = ALIAS_LOOKUP.get(norm);
    if (!canon) {
      if (norm !== '') unknown.push(h.trim());
      return;
    }
    if (colIndex.has(canon)) issues.push({ row: 0, message: `column "${h.trim()}" duplicates "${canon}"; the first one is used` });
    else colIndex.set(canon, idx);
  });
  if (unknown.length) issues.push({ row: 0, message: `ignored unknown column(s): ${unknown.map((u) => truncate(u, 40)).join(', ')}` });
  if (!colIndex.has('reference')) {
    issues.push({ row: 0, message: 'no reference column found (accepted: reference, ref, load, load #, load number, shipment, pro ...); nothing imported' });
    return { shipments: [], issues };
  }

  const byKey = new Map<string, Shipment>();
  const order: string[] = [];
  const firstRowOf = new Map<string, number>();
  let utcCount = 0;
  let utcFirst = '';
  let usdDefaultCount = 0;
  let usdFirst = 0;
  let etaFallbackCount = 0;

  for (let n = 1; n < nonBlank.length; n++) {
    const rec = nonBlank[n] as string[];
    const row = n;
    const issue = (message: string) => issues.push({ row, message });
    if (rec.length > header.length) issue(`row has ${rec.length} cells but the header has ${header.length}; extra cells ignored`);
    else if (rec.length < header.length) issue(`row has ${rec.length} cells but the header has ${header.length}; missing cells treated as empty`);

    const cell = (col: string): string => {
      const idx = colIndex.get(col);
      return idx === undefined ? '' : (rec[idx] ?? '').trim();
    };
    const readText = (col: string): string | undefined => {
      let v = cell(col);
      if (v === '') return undefined;
      if (v.length > MAX_TEXT) {
        issue(`${col}: text longer than ${MAX_TEXT} characters was cut`);
        v = v.slice(0, MAX_TEXT);
      }
      if (/^[=+\-@]/.test(v)) {
        issue(`${col}: value starts with "${v[0]}"; kept as plain text and never evaluated (beware if you export it to a spreadsheet)`);
      }
      return v;
    };
    const readTime = (col: string): string | undefined => {
      const v = cell(col);
      if (v === '') return undefined;
      const r = parseDateTimeStrict(v);
      if (!r.ok) {
        issue(`${col}: ${r.reason}; field left empty`);
        return undefined;
      }
      if (r.assumedUtc) {
        utcCount++;
        if (!utcFirst) utcFirst = `row ${row}, column ${col}`;
      }
      return r.iso;
    };

    const reference = readText('reference');
    if (!reference || normalizeReference(reference) === '') {
      issue('no usable reference; row skipped');
      continue;
    }
    const id = slugifyReference(reference);
    const key = normalizeReference(reference);
    const src = (): SourceRef => ({ kind: 'csv', ref: `${sourceName}:row ${row}` });

    const mkWindow = (a: string, b: string): Window | undefined => {
      const s = readTime(a);
      const e = readTime(b);
      if (s === undefined && e === undefined) return undefined;
      if (s === undefined || e === undefined) {
        issue(`${s === undefined ? a : b} missing; the ${a.replace('_start', '')} window needs both start and end, so it was left empty`);
        return undefined;
      }
      if (Date.parse(e) < Date.parse(s)) {
        issue(`${b} is before ${a}; window left empty`);
        return undefined;
      }
      return { start: s, end: e };
    };

    let currencyCol = cell('currency').toUpperCase();
    if (currencyCol !== '' && !(/^[A-Z]{3}$/.test(currencyCol) && isIsoCurrency(currencyCol))) {
      issue(`currency: "${truncate(currencyCol, 20)}" is not an ISO 4217 code; treated as blank`);
      currencyCol = '';
    }
    const readMoney = (col: string): Money | undefined => {
      const v = cell(col);
      if (v === '') return undefined;
      const r = parseMoneyCell(v);
      if (!r.ok) {
        issue(`${col}: cannot read amount "${truncate(v, 30)}" (${r.reason}); field left empty`);
        return undefined;
      }
      if (currencyCol && r.cell.inlineCurrency && r.cell.inlineCurrency !== currencyCol) {
        issue(`${col}: amount says ${r.cell.inlineCurrency} but currency column says ${currencyCol}; amount left empty`);
        return undefined;
      }
      const known = currencyCol || r.cell.inlineCurrency;
      const num = parseAmountNumber(r.cell.numeric, { groupingComma: known === undefined || usesDotDecimal(known) });
      if (!num.ok) {
        issue(`${col}: cannot read amount "${truncate(v, 30)}" (${num.reason}); field left empty`);
        return undefined;
      }
      let currency = known;
      if (!currency) {
        currency = 'USD';
        usdDefaultCount++;
        if (!usdFirst) usdFirst = row;
      }
      return { amount: num.value, currency };
    };

    const shipment: Shipment = { id, reference, events: [], documents: [] };
    const customer = readText('customer');
    if (customer) shipment.customer = customer;
    const carrier = readText('carrier');
    if (carrier) shipment.carrier = carrier;
    const pw = mkWindow('pickup_start', 'pickup_end');
    if (pw) shipment.pickupWindow = pw;
    const dw = mkWindow('delivery_start', 'delivery_end');
    if (dw) shipment.deliveryWindow = dw;
    const ft = cell('free_time_minutes');
    if (ft !== '') {
      if (/^\d+(\.0+)?$/.test(ft)) shipment.freeTimeMinutes = Math.round(Number(ft));
      else issue(`free_time_minutes: "${truncate(ft, 20)}" is not a whole number of minutes; field left empty`);
    }
    const rate = readMoney('agreed_rate');
    if (rate) shipment.agreedRate = rate;

    const events: StatusEvent[] = [];
    const addEv = (type: StatusEvent['type'], col: string, extra: Partial<StatusEvent> = {}, idSuffix: string = type) => {
      const at = readTime(col);
      if (at === undefined) return;
      events.push({ id: `${id}:${idSuffix}`, type, at, source: src(), ...extra });
    };
    addEv('arrived', 'pickup_arrived_at', { stop: 'pickup' }, 'arrived_pickup');
    addEv('picked_up', 'picked_up_at', { stop: 'pickup' });
    addEv('departed', 'pickup_departed_at', { stop: 'pickup' }, 'departed_pickup');
    addEv('arrived', 'delivery_arrived_at', { stop: 'delivery' }, 'arrived_delivery');
    addEv('departed', 'delivery_departed_at', { stop: 'delivery' }, 'departed_delivery');
    addEv('delivered', 'delivered_at', { stop: 'delivery' });

    const lastAt = readTime('last_status_at');
    const note = readText('last_status_note');
    if (lastAt !== undefined) {
      events.push({ id: `${id}:status_update`, type: 'status_update', at: lastAt, ...(note ? { note } : {}), source: src() });
    } else if (note) {
      issue('last_status_note has no last_status_at; note ignored (a note needs a time)');
    }

    const eta = readTime('eta');
    if (eta !== undefined) {
      // An eta_update needs a "reported at" time. Use last_status_at, else the latest other event in this row.
      let reportedAt = lastAt;
      if (reportedAt === undefined && events.length > 0) {
        reportedAt = events.reduce((m, e) => (Date.parse(e.at) > Date.parse(m) ? e.at : m), events[0]?.at as string);
        etaFallbackCount++;
      }
      if (reportedAt === undefined) issue('eta given but no last_status_at or other event time to say when it was reported; eta ignored');
      else events.push({ id: `${id}:eta_update`, type: 'eta_update', at: reportedAt, stop: 'delivery', eta, source: src() });
    }

    const docs: Doc[] = [];
    const podAt = readTime('pod_received_at');
    if (podAt !== undefined) docs.push({ id: `${id}:pod`, kind: 'pod', receivedAt: podAt, source: src() });
    const invAmount = readMoney('invoice_amount');
    const invAt = readTime('invoice_received_at');
    if (invAmount && invAt === undefined) {
      issue('invoice_amount without invoice_received_at; invoice ignored (a received time is required)');
    } else if (invAt !== undefined) {
      docs.push({ id: `${id}:invoice`, kind: 'invoice', receivedAt: invAt, ...(invAmount ? { amount: invAmount } : {}), source: src() });
    }

    shipment.events = sortEvents(events);
    shipment.documents = sortDocs(docs);

    const prev = byKey.get(key);
    if (prev) {
      const conflicts = describeConflicts(prev, shipment);
      issue(
        `duplicate reference "${reference}" (first seen in row ${firstRowOf.get(key)}); rows merged: first row's values kept, blanks filled from this row` +
          (conflicts.length ? `; conflicting values ignored for: ${conflicts.join(', ')}` : ''),
      );
      byKey.set(key, mergeTwo(prev, shipment));
    } else {
      byKey.set(key, shipment);
      order.push(key);
      firstRowOf.set(key, row);
    }
  }

  if (utcCount > 0) {
    issues.push({ message: `${utcCount} time value(s) had no UTC offset and were treated as UTC (first at ${utcFirst}). Add offsets (e.g. -05:00) if your times are local.` });
  }
  if (usdDefaultCount > 0) {
    issues.push({ message: `currency was blank for ${usdDefaultCount} amount(s); assumed "USD" (first at row ${usdFirst})` });
  }
  if (etaFallbackCount > 0) {
    issues.push({ message: `${etaFallbackCount} eta value(s) had no last_status_at; the latest other event time in the row was used as the report time` });
  }
  return { shipments: order.map((k) => byKey.get(k) as Shipment), issues };
}
