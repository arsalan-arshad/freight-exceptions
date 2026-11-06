import type { Doc, Shipment, StatusEvent } from '../core/types';
import { normalizeReference } from './util';

function clone<T>(v: T): T {
  return structuredClone(v);
}

function timeKey(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

function cmp(aT: string, aId: string, bT: string, bId: string): number {
  const ta = timeKey(aT);
  const tb = timeKey(bT);
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (ta === Number.POSITIVE_INFINITY && aT !== bT) return aT < bT ? -1 : 1;
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

export function sortEvents(events: StatusEvent[]): StatusEvent[] {
  return [...events].sort((a, b) => cmp(a.at, a.id, b.at, b.id));
}

export function sortDocs(docs: Doc[]): Doc[] {
  return [...docs].sort((a, b) => cmp(a.receivedAt, a.id, b.receivedAt, b.id));
}

const SCALARS = ['customer', 'carrier', 'pickupWindow', 'deliveryWindow', 'freeTimeMinutes', 'agreedRate'] as const;

/** Rewrites an id that starts with `${fromId}:` to start with `${toId}:`. */
function rekey(id: string, fromId: string, toId: string): string {
  return fromId !== toId && id.startsWith(`${fromId}:`) ? `${toId}${id.slice(fromId.length)}` : id;
}

/**
 * Merges `later` into `base` (same load). Neither input is mutated.
 * - id and reference come from `base`.
 * - scalar fields: `base` value kept when present; `later` only fills what `base` lacks.
 * - events/documents: union by id; on an id collision `base`'s copy is kept.
 *   Ids of the form `${later.id}:...` are re-keyed to `${base.id}:...` first, so the same
 *   fact seen under two spellings of the reference does not duplicate.
 */
export function mergeTwo(base: Shipment, later: Shipment): Shipment {
  const out: Shipment = clone(base);
  const b = clone(later);
  for (const k of SCALARS) {
    if (out[k] === undefined && b[k] !== undefined) {
      (out as unknown as Record<string, unknown>)[k] = b[k];
    }
  }
  const eventIds = new Set(out.events.map((e) => e.id));
  for (const e of b.events) {
    const id = rekey(e.id, b.id, out.id);
    if (!eventIds.has(id)) {
      eventIds.add(id);
      out.events.push({ ...e, id });
    }
  }
  const docIds = new Set(out.documents.map((d) => d.id));
  for (const d of b.documents) {
    const id = rekey(d.id, b.id, out.id);
    if (!docIds.has(id)) {
      docIds.add(id);
      out.documents.push({ ...d, id });
    }
  }
  out.events = sortEvents(out.events);
  out.documents = sortDocs(out.documents);
  return out;
}

/** Names of scalar fields / ids where both shipments have a value and the values differ. */
export function describeConflicts(base: Shipment, later: Shipment): string[] {
  const out: string[] = [];
  for (const k of SCALARS) {
    if (base[k] !== undefined && later[k] !== undefined && JSON.stringify(base[k]) !== JSON.stringify(later[k])) out.push(k);
  }
  const evs = new Map(base.events.map((e) => [rekey(e.id, base.id, base.id), e]));
  for (const e of later.events) {
    const mine = evs.get(rekey(e.id, later.id, base.id));
    if (mine && (mine.at !== e.at || mine.eta !== e.eta)) out.push(`event ${mine.id.slice(base.id.length + 1)}`);
  }
  const docs = new Map(base.documents.map((d) => [d.id, d]));
  for (const d of later.documents) {
    const mine = docs.get(rekey(d.id, later.id, base.id));
    if (mine && (mine.receivedAt !== d.receivedAt || JSON.stringify(mine.amount) !== JSON.stringify(d.amount))) {
      out.push(`document ${mine.id.slice(base.id.length + 1)}`);
    }
  }
  return out;
}

/**
 * Merges two shipment lists by normalised reference. Deterministic: output order is `a`'s order,
 * then shipments only in `b` in `b`'s order. Duplicates inside one list are folded too.
 * Scalar rule: the first-seen (older) value wins when present; the newer list only fills gaps.
 * Inputs are never mutated.
 */
export function mergeShipments(a: Shipment[], b: Shipment[]): Shipment[] {
  const order: string[] = [];
  const map = new Map<string, Shipment>();
  const add = (s: Shipment, idx: number, list: string) => {
    let key = normalizeReference(s.reference);
    if (key === '') key = `\u0000${list}${idx}`; // unusable reference: never merged with anything
    const prev = map.get(key);
    if (prev) map.set(key, mergeTwo(prev, s));
    else {
      order.push(key);
      const c = clone(s);
      c.events = sortEvents(c.events);
      c.documents = sortDocs(c.documents);
      map.set(key, c);
    }
  };
  a.forEach((s, i) => add(s, i, 'a'));
  b.forEach((s, i) => add(s, i, 'b'));
  return order.map((k) => map.get(k) as Shipment);
}
