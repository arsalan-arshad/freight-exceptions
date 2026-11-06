import { formatInstant } from '../core/format';

const MIN = 60_000;

/** Exact column order from docs/CONTRACT.md. */
export const SAMPLE_CSV_COLUMNS = [
  'reference',
  'customer',
  'carrier',
  'pickup_start',
  'pickup_end',
  'delivery_start',
  'delivery_end',
  'free_time_minutes',
  'agreed_rate',
  'currency',
  'pickup_arrived_at',
  'picked_up_at',
  'pickup_departed_at',
  'delivery_arrived_at',
  'delivery_departed_at',
  'delivered_at',
  'eta',
  'last_status_at',
  'last_status_note',
  'pod_received_at',
  'invoice_amount',
  'invoice_received_at',
] as const;

type Column = (typeof SAMPLE_CSV_COLUMNS)[number];

function cell(value: string): string {
  return /[",\r\n]/.test(value) || value !== value.trim() ? `"${value.replace(/"/g, '""')}"` : value;
}

const OFFSETS = [-300, -360, 0, -480];

/**
 * 20 rows, all times relative to `now` and written with an explicit offset. Under the default
 * RuleConfig the rows trigger a mix of all six rules; the comment per row says which.
 * An empty cell means unknown. Fake names only (example.com / Acme / Example Carrier).
 */
export function generateSampleCsv(now: Date): string {
  const nowMs = now.getTime();
  const rows: Array<Partial<Record<Column, string>>> = [];

  const add = (
    n: number,
    o: {
      customer?: string;
      carrier?: string;
      puEnd?: number;
      delEnd?: number;
      free?: number;
      rate?: string;
      currency?: string;
      puArr?: number;
      pu?: number;
      puDep?: number;
      delArr?: number;
      delDep?: number;
      delivered?: number;
      eta?: number;
      last?: number;
      note?: string;
      pod?: number;
      invoice?: string;
      invoiceAt?: number;
    },
  ): void => {
    const off = OFFSETS[(n - 7001) % OFFSETS.length] ?? 0;
    const t = (ago: number | undefined): string | undefined =>
      ago === undefined ? undefined : formatInstant(nowMs - ago * MIN, off);
    const row: Partial<Record<Column, string>> = { reference: `LD-${n}` };
    const set = (k: Column, v: string | undefined): void => {
      if (v !== undefined) row[k] = v;
    };
    set('customer', o.customer ?? 'Acme Foods');
    set('carrier', o.carrier ?? 'Example Carrier LLC');
    set('pickup_start', t(o.puEnd === undefined ? undefined : o.puEnd + 120));
    set('pickup_end', t(o.puEnd));
    set('delivery_start', t(o.delEnd === undefined ? undefined : o.delEnd + 120));
    set('delivery_end', t(o.delEnd));
    set('free_time_minutes', o.free === undefined ? undefined : String(o.free));
    set('agreed_rate', o.rate);
    set('currency', o.currency ?? (o.rate ? 'USD' : undefined));
    set('pickup_arrived_at', t(o.puArr));
    set('picked_up_at', t(o.pu));
    set('pickup_departed_at', t(o.puDep));
    set('delivery_arrived_at', t(o.delArr));
    set('delivery_departed_at', t(o.delDep));
    set('delivered_at', t(o.delivered));
    set('eta', t(o.eta));
    set('last_status_at', t(o.last));
    set('last_status_note', o.note);
    set('pod_received_at', t(o.pod));
    set('invoice_amount', o.invoice);
    set('invoice_received_at', t(o.invoiceAt));
    rows.push(row);
  };

  add(7001, { puEnd: 360, delEnd: -1500, rate: '1250.00' }); //                                   LATE-PU high (6h)
  add(7002, { puEnd: 1500, delEnd: 1100, rate: '1250.00', pu: 1400, delivered: 1200, last: 1200, pod: 900, invoice: '1250.00', invoiceAt: 600 }); // clean
  add(7003, { puEnd: 1600, delEnd: 180, rate: '1800.00', pu: 1500, last: 60, note: 'In transit, running behind' }); // LATE-DEL high
  add(7004, { puEnd: 900, delEnd: -300, rate: '2100.00', pu: 800, eta: -480, last: 45, note: 'Driver sent a new ETA' }); // LATE-DEL (ETA 3h after window), med
  add(7005, { puEnd: 3000, delEnd: 1900, rate: '950.00', pu: 2900, delivered: 1800, last: 1800 }); //        NO-POD low
  add(7006, { puEnd: 1600, delEnd: -900, rate: '1400.00', pu: 1500, last: 800, note: 'Departed Springfield yard' }); // NO-UPDATE med
  add(7007, { puEnd: 380, delEnd: -1000, rate: '1650.00', free: 120, puArr: 420, pu: 200, puDep: 190, last: 60, note: 'Loaded and rolling' }); // DETENTION pickup med
  add(7008, { puEnd: 2500, delEnd: 200, rate: '1500.00', free: 120, pu: 2000, delArr: 300, last: 40, note: 'Waiting at dock, receiver says door 4' }); // DETENTION delivery (on site) + LATE-DEL
  add(7009, { puEnd: 3000, delEnd: 1900, rate: '1250.00', pu: 2900, delivered: 1300, last: 1300, pod: 1200, invoice: '1310.00', invoiceAt: 400 }); // RATE-MISMATCH med
  add(7010, { customer: 'Sample Retail Group', puEnd: 500, delEnd: -700, rate: '1100.00', pu: 300, last: 60, note: 'On schedule' }); // clean (email adds an invoice later)
  add(7011, { customer: 'Demo Hardware Ltd', carrier: 'Sample Trucking Co' }); //                      sparse row: nothing known, no exception
  add(7012, { puEnd: 1000, delEnd: 400, rate: '1700.00', pu: 900, delivered: 360, last: 360 }); //        delivered 6h ago, POD not yet due: clean
  add(7013, { puEnd: 2600, delEnd: 240, rate: '2300.00', pu: 2000, last: 900, note: 'Fuel stop' }); //     LATE-DEL high + NO-UPDATE high
  add(7014, { puEnd: 90, delEnd: -1500, rate: '1200.00' }); //                                       within pickup grace: clean
  add(7015, { customer: 'Sample Retail Group', puEnd: 3000, delEnd: 1900, rate: '2400.00', currency: 'CAD', pu: 2900, delivered: 2000, last: 2000, pod: 1900, invoice: '2400.00', invoiceAt: 800 }); // clean (CAD)
  add(7016, { puEnd: 3000, delEnd: 1900, rate: '2000.00', pu: 2900, delivered: 2000, last: 2000, pod: 1900, invoice: '1950.00', invoiceAt: 700 }); // RATE-MISMATCH low (under)
  add(7017, { customer: 'Widget Wholesale, Co.', carrier: 'Demo Haulers Inc', puEnd: 800, delEnd: -900, rate: '1325.50', pu: 700, last: 400, note: 'Driver said, "ETA 6pm, maybe later"' }); // NO-UPDATE low (quoted fields)
  add(7018, { puEnd: 120, delEnd: -1500, rate: '1000.00' }); //                                       exactly at the grace boundary: clean
  add(7019, { carrier: '', puEnd: 500, delEnd: -1200, rate: '1500.00' }); //                          LATE-PU high, carrier unknown
  add(7020, { customer: 'Demo Hardware Ltd', carrier: 'Test Transport LLC', puEnd: 5500, delEnd: 4900, rate: '900.00', pu: 5400, delivered: 4500, last: 4500, invoice: '900.00', invoiceAt: 3000 }); // NO-POD high

  const lines = [SAMPLE_CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(SAMPLE_CSV_COLUMNS.map((c) => cell(row[c] ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}
