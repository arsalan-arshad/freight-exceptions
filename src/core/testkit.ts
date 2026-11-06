// Test helpers for the core rules (not a test file, not part of the public API).
import { formatInstant, formatUtc } from './format';
import type { Doc, DocKind, EventType, Shipment, StatusEvent, StopKind } from './types';

export const NOW = new Date('2026-11-06T15:00:00.000Z');
const MIN = 60_000;

/** ISO string `agoMin` minutes before NOW (negative = future), written in the given offset. */
export function iso(agoMin: number, offsetMinutes = 0): string {
  return formatInstant(NOW.getTime() - agoMin * MIN, offsetMinutes);
}

/** Display form expected in facts: UTC, minutes, no offset text. */
export function utc(agoMin: number): string {
  return formatUtc(NOW.getTime() - agoMin * MIN);
}

export function event(
  type: EventType,
  agoMin: number,
  extra: Partial<StatusEvent> & { offset?: number } = {},
): StatusEvent {
  const { offset, ...rest } = extra;
  const id = `${type}${rest.stop ? `-${rest.stop}` : ''}@${agoMin}`;
  return { id, type, at: iso(agoMin, offset ?? 0), source: { kind: 'manual', ref: `test:${id}` }, ...rest };
}

export function doc(kind: DocKind, agoMin: number, extra: Partial<Doc> = {}): Doc {
  const id = `${kind}@${agoMin}`;
  return { id, kind, receivedAt: iso(agoMin), source: { kind: 'manual', ref: `test:${id}` }, ...extra };
}

export function windowEnding(endAgoMin: number, lenMin = 120, offset = 0): { start: string; end: string } {
  return { start: iso(endAgoMin + lenMin, offset), end: iso(endAgoMin, offset) };
}

export function shipment(over: Partial<Shipment> = {}): Shipment {
  return {
    id: 's1',
    reference: 'REF-1',
    carrier: 'Example Carrier LLC',
    customer: 'Acme Foods',
    events: [],
    documents: [],
    ...over,
  };
}

/** Deterministic Fisher-Yates using a tiny LCG (tests must not use Math.random). */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const a = [...items];
  let s = seed >>> 0 || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}
