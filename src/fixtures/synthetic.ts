import { formatInstant } from '../core/format';
import type { Doc, DocKind, EventType, Shipment, StatusEvent, StopKind } from '../core/types';
import { mulberry32, slugify } from './prng';

const MIN = 60_000;

/** Display offsets (minutes east of UTC) so the data exercises timezone handling. */
const OFFSETS = [-300, -360, -480, 0, 60, 330];
const CARRIERS = ['Example Carrier LLC', 'Sample Trucking Co', 'Demo Haulers Inc', 'Test Transport LLC'];
const CUSTOMERS = ['Acme Foods', 'Widget Wholesale Co', 'Sample Retail Group', 'Demo Hardware Ltd'];

interface EvSpec {
  type: EventType;
  stop?: StopKind;
  /** Minutes before `now` (negative = in the future). */
  ago: number;
  /** Minutes before `now` for the ETA value (eta_update only). */
  etaAgo?: number;
  note?: string;
  /** Replace the generated `at` string (garbage / timezone-less test data). */
  raw?: string;
  /** Emit the same event (same id) twice. */
  dup?: boolean;
}

interface DocSpec {
  kind: DocKind;
  ago: number;
  raw?: string;
  amount?: number;
  currency?: string;
}

interface Spec {
  /** Minutes ago that the pickup window ended; null = no window. */
  puEnd: number | null;
  delEnd: number | null;
  free?: number;
  /** Agreed rate in major units; null = none; undefined = seeded random. */
  rate?: number | null;
  currency?: string;
  events?: EvSpec[];
  docs?: DocSpec[];
  /** Emit events in reverse chronological order. */
  reverse?: boolean;
}

const ev = (type: EventType, ago: number, extra: Partial<EvSpec> = {}): EvSpec => ({ type, ago, ...extra });
const at = (type: 'arrived' | 'departed', stop: StopKind, ago: number): EvSpec => ({ type, stop, ago });

/**
 * About 45 synthetic shipments (references FX-1001 ...) covering every rule with clear positives,
 * clear negatives, boundary cases right at the threshold and ambiguous / missing-data cases.
 * All times are relative to `now`; the seed only varies names, display offsets and rates, never
 * the timing of the boundary cases. Deterministic: same (now, seed) => deep-equal output.
 * The comment on each line is the expectation under DEFAULT_RULE_CONFIG.
 */
export function generateSyntheticShipments(now: Date, seed = 1): Shipment[] {
  const rng = mulberry32(seed);
  const nowMs = now.getTime();
  const out: Shipment[] = [];
  let counter = 1000;

  const add = (spec: Spec): void => {
    counter += 1;
    const reference = `FX-${counter}`;
    const id = slugify(reference);
    // Always consume the same number of random draws so one spec never shifts another.
    const off = OFFSETS[Math.floor(rng() * OFFSETS.length)] ?? 0;
    const carrier = CARRIERS[Math.floor(rng() * CARRIERS.length)] ?? CARRIERS[0];
    const customer = CUSTOMERS[Math.floor(rng() * CUSTOMERS.length)] ?? CUSTOMERS[0];
    const randomRate = 800 + Math.floor(rng() * 220) * 10;
    const fmt = (agoMin: number): string => formatInstant(nowMs - agoMin * MIN, off);
    const source = (excerpt?: string) => ({
      kind: 'synthetic' as const,
      ref: `synthetic:seed-${seed}:${id}`,
      ...(excerpt ? { excerpt } : {}),
    });

    const shipment: Shipment = { id, reference, events: [], documents: [] };
    if (carrier) shipment.carrier = carrier;
    if (customer) shipment.customer = customer;
    if (spec.puEnd !== null) shipment.pickupWindow = { start: fmt(spec.puEnd + 120), end: fmt(spec.puEnd) };
    if (spec.delEnd !== null) shipment.deliveryWindow = { start: fmt(spec.delEnd + 120), end: fmt(spec.delEnd) };
    if (spec.free !== undefined) shipment.freeTimeMinutes = spec.free;
    const rate = spec.rate === undefined ? randomRate : spec.rate;
    if (rate !== null) shipment.agreedRate = { amount: rate, currency: spec.currency ?? 'USD' };

    const used = new Map<string, number>();
    const events: StatusEvent[] = [];
    for (const e of spec.events ?? []) {
      const base = `${id}:${e.stop ? `${e.stop}_` : ''}${e.type}`;
      const n = (used.get(base) ?? 0) + 1;
      const eid = e.dup ? base : n === 1 ? base : `${base}#${n}`;
      if (!e.dup) used.set(base, n);
      const event: StatusEvent = {
        id: eid,
        type: e.type,
        at: e.raw ?? fmt(e.ago),
        source: source(e.note),
      };
      if (e.stop) event.stop = e.stop;
      if (e.etaAgo !== undefined) event.eta = fmt(e.etaAgo);
      if (e.note) event.note = e.note;
      events.push(event);
      if (e.dup) events.push({ ...event, source: { ...event.source } });
    }
    shipment.events = spec.reverse ? events.reverse() : events;

    const docs: Doc[] = [];
    for (const d of spec.docs ?? []) {
      const doc: Doc = {
        id: `${id}:${d.kind}${docs.some((x) => x.kind === d.kind) ? `#${docs.length + 1}` : ''}`,
        kind: d.kind,
        receivedAt: d.raw ?? fmt(d.ago),
        source: source(),
      };
      if (d.amount !== undefined) doc.amount = { amount: d.amount, currency: d.currency ?? spec.currency ?? 'USD' };
      docs.push(doc);
    }
    shipment.documents = docs;
    out.push(shipment);
  };

  // A delivered load with POD, used by the RATE-MISMATCH cases so no other rule fires.
  const billed = (rate: number | null, invoices: DocSpec[], currency = 'USD'): void =>
    add({
      puEnd: 3000,
      delEnd: 1900,
      rate,
      currency,
      events: [ev('picked_up', 2900), ev('delivered', 1800)],
      docs: [{ kind: 'pod', ago: 1700 }, ...invoices],
    });
  const delivered = (deliveredAgo: number, docs: DocSpec[] = []): void =>
    add({ puEnd: 3000, delEnd: 1900, events: [ev('picked_up', 2900), ev('delivered', deliveredAgo)], docs });
  const inTransit = (lastAgo: number, extra: Partial<Spec> = {}): void =>
    add({ puEnd: 700, delEnd: -1000, events: [ev('picked_up', 600), ev('in_transit', lastAgo)], ...extra });

  // ---- LATE-PU ----
  add({ puEnd: 300, delEnd: -1500, events: [] }); //                         1001 LATE-PU high (5h past window end)
  add({ puEnd: 240, delEnd: -1200, reverse: true, events: [ev('picked_up', 230, { dup: true }), ev('in_transit', 100)] }); // 1002 none (picked up; unsorted + duplicate)
  add({ puEnd: 120, delEnd: -1500, events: [] }); //                         1003 none (exactly at the 2h grace)
  add({ puEnd: 121, delEnd: -1500, events: [] }); //                         1004 LATE-PU med (1 minute past grace)
  add({ puEnd: null, delEnd: null, rate: null, events: [] }); //              1005 none (no windows, nothing known)
  add({ puEnd: 300, delEnd: -1200, events: [at('arrived', 'pickup', 100)] }); // 1006 LATE-PU med (on site, capped)

  // ---- LATE-DEL ----
  add({ puEnd: 1600, delEnd: 180, events: [ev('picked_up', 1500), ev('in_transit', 60)] }); // 1007 LATE-DEL high (3h overdue)
  add({ puEnd: 900, delEnd: -240, events: [ev('picked_up', 800), ev('in_transit', 100), ev('eta_update', 60, { etaAgo: -420 })] }); // 1008 LATE-DEL med (ETA 3h after window)
  add({ puEnd: 900, delEnd: 0, events: [ev('picked_up', 800), ev('eta_update', 30, { etaAgo: 30 })] }); //   1009 none (now == window end)
  add({ puEnd: 900, delEnd: -240, events: [ev('picked_up', 800), ev('eta_update', 30, { etaAgo: -240 })] }); // 1010 none (ETA == window end)
  add({ puEnd: 900, delEnd: -240, events: [ev('picked_up', 800), ev('eta_update', 30, { etaAgo: -241 })] }); // 1011 LATE-DEL low (ETA 1 minute after)
  add({ puEnd: 1500, delEnd: 300, events: [ev('picked_up', 1400), ev('delivered', 240)], docs: [{ kind: 'pod', ago: 200 }] }); // 1012 none (delivered late, POD in)
  add({ puEnd: 900, delEnd: null, events: [ev('picked_up', 800), ev('eta_update', 30, { etaAgo: -2880 })] }); // 1013 none (no delivery window)
  add({
    puEnd: 600,
    delEnd: -600,
    events: [
      ev('picked_up', 500),
      ev('in_transit', 0, { raw: 'not-a-date' }),
      ev('eta_update', 0, { raw: '2026-13-45T10:00:00Z', etaAgo: -100 }),
      ev('status_update', 0, { raw: formatInstant(nowMs - 30 * MIN, 0).slice(0, 19) }), // no offset => unusable
    ],
  }); //                                                                       1014 NO-UPDATE low (garbage events skipped, never thrown)

  // ---- NO-POD ----
  delivered(1800); //                                                          1015 NO-POD low (30h)
  add({ puEnd: 5500, delEnd: 4900, events: [ev('picked_up', 5400), ev('delivered', 4800)] }); // 1016 NO-POD high (80h)
  delivered(1800, [{ kind: 'pod', ago: 1700 }]); //                            1017 none (POD present)
  delivered(1440); //                                                          1018 none (exactly 24h)
  delivered(1441); //                                                          1019 NO-POD low (24h + 1 minute)
  add({ puEnd: 3000, delEnd: -500, events: [ev('picked_up', 100), ev('delivered', 0, { raw: 'garbage' })] }); // 1020 none (delivered time unusable)
  delivered(3000, [{ kind: 'pod', ago: 0, raw: 'yesterday-ish' }]); //         1021 none (POD present, its date unusable)

  // ---- NO-UPDATE ----
  add({ puEnd: 1500, delEnd: -1000, events: [ev('picked_up', 1200), ev('in_transit', 720)] }); // 1022 NO-UPDATE med (12h)
  add({ puEnd: 2500, delEnd: -1000, events: [ev('picked_up', 2000), ev('status_update', 1800)] }); // 1023 NO-UPDATE high (30h)
  inTransit(360); //                                                           1024 none (exactly 6h)
  inTransit(361); //                                                           1025 NO-UPDATE low (6h + 1 minute)
  inTransit(-60); //                                                           1026 NO-UPDATE low (a future event is ignored; last real event 10h ago)
  add({ puEnd: 2500, delEnd: 60, events: [ev('picked_up', 2000), ev('in_transit', 800)] }); // 1027 NO-UPDATE high (med bumped, window passed) + LATE-DEL med

  // ---- DETENTION ----
  add({ puEnd: 380, delEnd: -1000, events: [at('arrived', 'pickup', 400), ev('picked_up', 160), at('departed', 'pickup', 160), ev('in_transit', 60)] }); // 1028 DETENTION pickup med (2h over)
  add({ puEnd: 2500, delEnd: 400, events: [ev('picked_up', 2000), ev('in_transit', 1500), at('arrived', 'delivery', 420), ev('status_update', 30, { note: 'Waiting at dock' })] }); // 1029 DETENTION delivery high (still on site) + LATE-DEL high
  add({ puEnd: 400, delEnd: -1000, events: [at('arrived', 'pickup', 300), ev('picked_up', 210), at('departed', 'pickup', 210), ev('in_transit', 100)] }); // 1030 none (90 min dwell)
  add({ puEnd: 420, delEnd: -1000, events: [at('arrived', 'pickup', 400), ev('picked_up', 280), at('departed', 'pickup', 280), ev('in_transit', 100)] }); // 1031 none (exactly 120 min)
  add({ puEnd: 320, delEnd: -1000, free: 60, events: [at('arrived', 'pickup', 300), ev('picked_up', 239), at('departed', 'pickup', 239), ev('in_transit', 60)] }); // 1032 DETENTION pickup low (61 vs 60 free)
  add({ puEnd: 420, delEnd: -1000, free: 240, events: [at('arrived', 'pickup', 400), ev('picked_up', 220), at('departed', 'pickup', 220), ev('in_transit', 100)] }); // 1033 none (180 vs 240 free)
  add({ puEnd: 320, delEnd: -1000, events: [at('arrived', 'pickup', 200), at('departed', 'pickup', 300), ev('picked_up', 290), ev('in_transit', 100)] }); // 1034 none (departed before arrived: contradictory)
  add({ puEnd: 700, delEnd: -1000, events: [at('arrived', 'pickup', 600), ev('picked_up', 400), ev('in_transit', 100)] }); // 1035 none (moved on, departure unknown)
  add({ puEnd: 1500, delEnd: 700, events: [ev('picked_up', 1400), ev('in_transit', 1000), at('arrived', 'delivery', 600), ev('delivered', 320), at('departed', 'delivery', 300)], docs: [{ kind: 'pod', ago: 280 }] }); // 1036 DETENTION delivery med (completed)

  // ---- RATE-MISMATCH ----
  billed(1250, [{ kind: 'invoice', ago: 400, amount: 1310 }]); //             1037 RATE med (+60.00, 4.8%)
  billed(1000, [{ kind: 'invoice', ago: 400, amount: 1300 }]); //             1038 RATE high (+30%)
  billed(1500, [{ kind: 'invoice', ago: 400, amount: 1500 }]); //             1039 none (equal)
  billed(1000.1, [{ kind: 'invoice', ago: 400, amount: 1000.6 }]); //         1040 none (difference exactly 0.50; float-safe)
  billed(1000.1, [{ kind: 'invoice', ago: 400, amount: 1000.61 }]); //        1041 RATE low (0.51 over tolerance)
  billed(1800, [{ kind: 'invoice', ago: 400, amount: 1800, currency: 'CAD' }]); // 1042 RATE high (currency differs)
  billed(null, [{ kind: 'invoice', ago: 400, amount: 900 }]); //              1043 none (no agreed rate)
  billed(2000, [{ kind: 'invoice', ago: 400, amount: 1950 }]); //             1044 RATE low (invoice 2.5% under)
  billed(1250, [
    { kind: 'invoice', ago: 900, amount: 1400 },
    { kind: 'invoice', ago: 300, amount: 1250 },
  ]); //                                                                       1045 none (corrected invoice supersedes)

  return out;
}
