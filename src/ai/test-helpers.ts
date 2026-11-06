// Synthetic ExceptionCase builders for tests. Obviously fake names only.
import type { ExceptionCase, RuleId, Shipment } from '../core/types';

export function makeCase(ruleId: RuleId, facts: Record<string, string | number>, over: Partial<ExceptionCase> = {}): ExceptionCase {
  return {
    id: `acme-ld-4821:${ruleId}`,
    shipmentId: 'acme-ld-4821',
    ruleId,
    severity: 'med',
    title: `${ruleId} test case`,
    summary: `Synthetic ${ruleId} case.`,
    facts,
    evidence: [{ source: 'csv', ref: 'shipments.csv:row 2', excerpt: 'LD-4821,Example Carrier LLC' }],
    suggestedNextStep: 'Ask carrier for an update',
    detectedAt: '2026-11-05T20:00:00Z',
    status: 'open',
    ...over,
  };
}

export const BASE = { reference: 'LD-4821', carrier: 'Example Carrier LLC' };

// Facts mirror what src/core/rules emits: ISO datetimes with offset, formatted amounts, numeric minutes/hours, asOf.
const ASOF = { asOf: '2026-11-06T10:00:00+00:00' };
export const CASES: Record<RuleId, ExceptionCase> = {
  'LATE-PU': makeCase('LATE-PU', { ...BASE, ...ASOF, pickupWindowEnd: '2026-11-05T10:00:00-05:00', minutesOverdue: 300, hoursOverdue: 5 }, { title: 'Pickup 5h overdue' }),
  'LATE-DEL': makeCase('LATE-DEL', { ...BASE, ...ASOF, deliveryWindowEnd: '2026-11-05T16:00:00-05:00', latestEta: '2026-11-05T21:30:00-05:00', hoursOverdue: 5.5 }),
  'NO-POD': makeCase('NO-POD', { ...BASE, ...ASOF, deliveredAt: '2026-11-04T14:00:00-05:00', hoursSinceDelivered: 44 }),
  'NO-UPDATE': makeCase('NO-UPDATE', { ...BASE, ...ASOF, lastUpdateAt: '2026-11-05T06:15:00-05:00', hoursSinceLastUpdate: 14.8 }),
  DETENTION: makeCase('DETENTION', {
    ...BASE,
    ...ASOF,
    stop: 'delivery',
    arrivedAt: '2026-11-05T08:00:00-05:00',
    departedAt: '2026-11-05T11:35:00-05:00',
    stillOnSite: 'no',
    dwellMinutes: 215,
    freeTimeMinutes: 120,
    detentionMinutes: 95,
  }),
  'RATE-MISMATCH': makeCase('RATE-MISMATCH', {
    ...BASE,
    ...ASOF,
    invoiceAmount: '1,350.00 USD',
    agreedRate: '1,250.00 USD',
    differenceAmount: '+100.00 USD',
    direction: 'higher than agreed',
  }),
};

export const SHIPMENT: Shipment = {
  id: 'acme-ld-4821',
  reference: 'LD-4821',
  carrier: 'Example Carrier LLC',
  events: [{ id: 'e1', type: 'status_update', at: '2026-11-05T06:15:00-05:00', note: 'SHIPMENT-NOTE-SECRET truck broke down', source: { kind: 'synthetic', ref: 'x' } }],
  documents: [],
};
