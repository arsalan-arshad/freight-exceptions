import type { Doc, ISODateTime, Shipment, SourceRef, StatusEvent, StopKind } from '../core/types';
import type { ExtractionResult, ExtractedValue } from './types';
import { sortDocs, sortEvents } from './merge';
import { normalizeReference } from './util';

export interface ApplyOptions {
  /**
   * When the email was received. Needed for eta_update (when was the ETA reported), the POD document and
   * the invoice document (when received). Without it those are skipped (or, for eta_update, use the latest
   * other accepted time in the same email) and a note says so. ExtractionResult itself carries no timestamp.
   */
  receivedAt?: ISODateTime;
}

export interface ApplyOutcome {
  /** A new array of new shipment objects; the inputs are never mutated. */
  shipments: Shipment[];
  /** The matched shipment's own reference string, when matched. */
  matchedReference?: string;
  /** True when no accepted reference matched exactly one existing shipment. Nothing is created in that case. */
  unmatched: boolean;
  /** Human-readable notes: what was applied, skipped and why. */
  notes: string[];
}

const PICKUP_WORDS = /\b(pick[\s-]?up|pickup|pu|shipper|origin|loading|loaded)\b/i;
const DELIVERY_WORDS = /\b(deliver(?:y|ed|ing)?|receiver|consignee|destination|unload(?:ing|ed)?|drop[\s-]?off|del)\b/i;

/** Stop is taken from the quote's own words only; unclear or both => undefined (never guessed). */
function stopFromQuote(quote: string): StopKind | undefined {
  const p = PICKUP_WORDS.test(quote);
  const d = DELIVERY_WORDS.test(quote);
  if (p && !d) return 'pickup';
  if (d && !p) return 'delivery';
  return undefined;
}

function msgIdFrom(ref: string): string {
  return ref.replace(/^email:/i, '');
}

/**
 * Applies verified extraction output to an existing shipment list.
 * - Matches the accepted `reference` (normalised) to exactly one existing shipment. No match, or more than one, => unmatched:true
 *   and nothing is created or changed.
 * - Creates StatusEvents / Docs with source {kind, ref, excerpt: quote} and stable ids
 *   `${shipmentId}:email:${messageId}:${field}`; applying the same email twice does not duplicate them.
 * - arrived/departed are stored with a stop only when the quote's own words say pickup or delivery; otherwise without a stop
 *   (rules ignore stop-less arrivals, so nothing is guessed).
 * - invoiceAmount needs an accepted invoiceCurrency (not guessed). carrier is informational and not applied.
 */
export function applyExtraction(existing: Shipment[], result: ExtractionResult, source: SourceRef, opts: ApplyOptions = {}): ApplyOutcome {
  const shipments = structuredClone(existing);
  const notes: string[] = [];
  const refItem = result.accepted.find((a) => a.field === 'reference');
  if (!refItem || typeof refItem.value !== 'string') {
    notes.push('no accepted reference; nothing applied');
    return { shipments, unmatched: true, notes };
  }
  const key = normalizeReference(refItem.value);
  const matches = key === '' ? [] : shipments.filter((s) => normalizeReference(s.reference) === key);
  if (matches.length !== 1) {
    notes.push(matches.length === 0 ? `reference "${refItem.value}" matches no existing shipment; nothing created` : `reference "${refItem.value}" matches ${matches.length} shipments; ambiguous, nothing applied`);
    return { shipments, unmatched: true, notes };
  }
  const ship = matches[0] as Shipment;
  const msgId = msgIdFrom(source.ref);
  const mkSource = (quote: string): SourceRef => ({ kind: source.kind, ref: source.ref, excerpt: quote });
  const get = (f: string): ExtractedValue | undefined => result.accepted.find((a) => a.field === f);
  const eventIds = new Set(ship.events.map((e) => e.id));
  const docIds = new Set(ship.documents.map((d) => d.id));
  const newEvents: StatusEvent[] = [];
  const newDocs: Doc[] = [];
  const addEvent = (e: StatusEvent) => {
    if (eventIds.has(e.id)) {
      notes.push(`event ${e.id} already present; skipped`);
      return;
    }
    eventIds.add(e.id);
    newEvents.push(e);
  };
  const addDoc = (d: Doc) => {
    if (docIds.has(d.id)) {
      notes.push(`document ${d.id} already present; skipped`);
      return;
    }
    docIds.add(d.id);
    newDocs.push(d);
  };
  const id = (field: string) => `${ship.id}:email:${msgId}:${field}`;

  const timeFields: Array<[string, StatusEvent['type'], StopKind | 'quote' | undefined]> = [
    ['pickedUpAt', 'picked_up', 'pickup'],
    ['arrivedAt', 'arrived', 'quote'],
    ['departedAt', 'departed', 'quote'],
    ['deliveredAt', 'delivered', 'delivery'],
  ];
  let latestOtherTime: string | undefined;
  for (const [f] of timeFields) {
    const v = get(f);
    if (v && typeof v.value === 'string' && (latestOtherTime === undefined || Date.parse(v.value) > Date.parse(latestOtherTime))) latestOtherTime = v.value;
  }
  for (const [f, type, stopMode] of timeFields) {
    const v = get(f);
    if (!v || typeof v.value !== 'string') continue;
    const stop = stopMode === 'quote' ? stopFromQuote(v.quote) : stopMode;
    if (stopMode === 'quote' && stop === undefined) notes.push(`${f}: quote does not say pickup or delivery; stored without a stop (detention rules need a stop)`);
    addEvent({ id: id(f), type, at: v.value, ...(stop ? { stop } : {}), source: mkSource(v.quote) });
  }
  const eta = get('eta');
  if (eta && typeof eta.value === 'string') {
    const reportedAt = opts.receivedAt ?? latestOtherTime;
    if (reportedAt === undefined) notes.push('eta not applied: the time the email was received is unknown (pass opts.receivedAt)');
    else addEvent({ id: id('eta'), type: 'eta_update', at: reportedAt, stop: 'delivery', eta: eta.value, source: mkSource(eta.quote) });
  }
  const pod = get('podAttached');
  if (pod && pod.value === true) {
    if (opts.receivedAt === undefined) notes.push('podAttached not applied: the time the email was received is unknown (pass opts.receivedAt)');
    else addDoc({ id: id('pod'), kind: 'pod', receivedAt: opts.receivedAt, source: mkSource(pod.quote) });
  }
  const amt = get('invoiceAmount');
  if (amt && typeof amt.value === 'number') {
    const cur = get('invoiceCurrency');
    if (!cur || typeof cur.value !== 'string') notes.push('invoiceAmount not applied: no accepted invoiceCurrency (currency is not guessed)');
    else if (opts.receivedAt === undefined) notes.push('invoiceAmount not applied: the time the email was received is unknown (pass opts.receivedAt)');
    else addDoc({ id: id('invoice'), kind: 'invoice', receivedAt: opts.receivedAt, amount: { amount: amt.value, currency: cur.value }, source: mkSource(`${amt.quote}${cur.quote !== amt.quote ? ` | ${cur.quote}` : ''}`) });
  }
  if (get('carrier')) notes.push('carrier is informational and was not applied');

  ship.events = sortEvents([...ship.events, ...newEvents]);
  ship.documents = sortDocs([...ship.documents, ...newDocs]);
  return { shipments, matchedReference: ship.reference, unmatched: false, notes };
}
