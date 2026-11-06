import type { Doc, Shipment, StatusEvent, StopKind } from './types';
import { parseInstant, type ParsedInstant } from './time';

export interface TimedEvent {
  event: StatusEvent;
  ms: number;
  offset: number;
  /** Parsed ETA, only for eta_update events whose `eta` is a valid instant. */
  eta?: ParsedInstant;
}

export interface TimedDoc {
  doc: Doc;
  /** null when receivedAt does not parse (the document still counts as present). */
  ms: number | null;
  offset: number;
}

export interface ShipmentView {
  nowMs: number;
  /** Valid, not in the future, de-duplicated by id, sorted ascending with a total order. */
  events: TimedEvent[];
  docs: TimedDoc[];
  newest?: TimedEvent;
  delivered?: TimedEvent;
  /** The newest eta_update event (its eta may be absent if it did not parse). */
  latestEtaEvent?: TimedEvent;
  /** picked_up, or departed at the pickup stop (the CONTRACT definition). */
  pickedUp: boolean;
  /** pickedUp, or the load has clearly moved on (in_transit, delivered, any delivery-stop event). */
  impliesPickedUp: boolean;
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function compareEvents(a: TimedEvent, b: TimedEvent): number {
  if (a.ms !== b.ms) return a.ms < b.ms ? -1 : 1;
  const ka = [a.event.type, str(a.event.stop), str(a.event.id), str(a.event.eta), str(a.event.note)];
  const kb = [b.event.type, str(b.event.stop), str(b.event.id), str(b.event.eta), str(b.event.note)];
  for (let i = 0; i < ka.length; i++) {
    const c = cmpStr(ka[i] ?? '', kb[i] ?? '');
    if (c !== 0) return c;
  }
  return 0;
}

function compareDocs(a: TimedDoc, b: TimedDoc): number {
  const am = a.ms ?? Number.NEGATIVE_INFINITY;
  const bm = b.ms ?? Number.NEGATIVE_INFINITY;
  if (am !== bm) return am < bm ? -1 : 1;
  const ka = [str(a.doc.kind), str(a.doc.id), String(a.doc.amount?.amount ?? ''), str(a.doc.amount?.currency)];
  const kb = [str(b.doc.kind), str(b.doc.id), String(b.doc.amount?.amount ?? ''), str(b.doc.amount?.currency)];
  for (let i = 0; i < ka.length; i++) {
    const c = cmpStr(ka[i] ?? '', kb[i] ?? '');
    if (c !== 0) return c;
  }
  return 0;
}

/**
 * Normalise a shipment for the rules. Never throws.
 * - events with a missing/garbage/offset-less `at` are skipped
 * - events dated after `now` are ignored: they cannot have happened yet as of `now`
 * - documents dated after `now` are ignored; documents whose date does not parse are kept
 * - duplicates (same id) are collapsed; ordering never depends on input order
 */
export function buildView(shipment: Shipment, nowMs: number): ShipmentView {
  const rawEvents: unknown[] = Array.isArray(shipment?.events) ? shipment.events : [];
  const timed: TimedEvent[] = [];
  for (const raw of rawEvents) {
    if (!raw || typeof raw !== 'object') continue;
    const ev = raw as StatusEvent;
    if (typeof ev.type !== 'string') continue;
    const at = parseInstant(ev.at);
    if (!at || at.ms > nowMs) continue;
    const te: TimedEvent = { event: ev, ms: at.ms, offset: at.offsetMinutes };
    if (ev.type === 'eta_update') {
      const eta = parseInstant(ev.eta);
      if (eta) te.eta = eta;
    }
    timed.push(te);
  }
  timed.sort(compareEvents);

  const seen = new Set<string>();
  const events: TimedEvent[] = [];
  for (const te of timed) {
    const e = te.event;
    const key = typeof e.id === 'string' && e.id !== '' ? `id:${e.id}` : `k:${e.type}|${str(e.stop)}|${str(e.at)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(te);
  }

  const rawDocs: unknown[] = Array.isArray(shipment?.documents) ? shipment.documents : [];
  const timedDocs: TimedDoc[] = [];
  for (const raw of rawDocs) {
    if (!raw || typeof raw !== 'object') continue;
    const doc = raw as Doc;
    if (typeof doc.kind !== 'string') continue;
    const at = parseInstant(doc.receivedAt);
    if (at && at.ms > nowMs) continue;
    timedDocs.push({ doc, ms: at ? at.ms : null, offset: at ? at.offsetMinutes : 0 });
  }
  timedDocs.sort(compareDocs);
  const seenDocs = new Set<string>();
  const docs: TimedDoc[] = [];
  for (const td of timedDocs) {
    const key = typeof td.doc.id === 'string' && td.doc.id !== '' ? `id:${td.doc.id}` : `k:${td.doc.kind}|${str(td.doc.receivedAt)}`;
    if (seenDocs.has(key)) continue;
    seenDocs.add(key);
    docs.push(td);
  }

  const delivered = events.find((e) => e.event.type === 'delivered');
  const pickedUp = events.some(
    (e) => e.event.type === 'picked_up' || (e.event.type === 'departed' && e.event.stop === 'pickup'),
  );
  const movedOn = events.some(
    (e) =>
      e.event.type === 'in_transit' ||
      e.event.type === 'delivered' ||
      ((e.event.type === 'arrived' || e.event.type === 'departed') && e.event.stop === 'delivery'),
  );
  const etaEvents = events.filter((e) => e.event.type === 'eta_update');

  const view: ShipmentView = {
    nowMs,
    events,
    docs,
    pickedUp,
    impliesPickedUp: pickedUp || movedOn,
  };
  const newest = events[events.length - 1];
  if (newest) view.newest = newest;
  if (delivered) view.delivered = delivered;
  const latestEta = etaEvents[etaEvents.length - 1];
  if (latestEta) view.latestEtaEvent = latestEta;
  return view;
}

/** Earliest event of a type (optionally at a stop). */
export function firstEvent(view: ShipmentView, type: StatusEvent['type'], stop?: StopKind): TimedEvent | undefined {
  return view.events.find((e) => e.event.type === type && (stop === undefined || e.event.stop === stop));
}
