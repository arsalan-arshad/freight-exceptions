// Read models shared by pages and API routes.
import type { CaseStatus, ExceptionCase, Shipment } from '@/core/types';
import type { Store } from '@/db';

export interface CaseRow extends ExceptionCase {
  reference: string;
  carrier?: string;
  customer?: string;
}

export const STATUS_FILTERS = ['active', 'open', 'drafted', 'resolved', 'dismissed', 'all'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export function statusesFor(f: StatusFilter): CaseStatus[] | undefined {
  switch (f) {
    case 'active':
      return ['open', 'drafted'];
    case 'all':
      return undefined;
    default:
      return [f];
  }
}

export function parseStatusFilter(v: string | undefined): StatusFilter {
  return (STATUS_FILTERS as readonly string[]).includes(v ?? '') ? (v as StatusFilter) : 'active';
}

export function toRow(c: ExceptionCase, s: Shipment | undefined): CaseRow {
  const ref = s?.reference ?? (typeof c.facts.reference === 'string' ? c.facts.reference : c.shipmentId);
  return {
    ...c,
    reference: ref,
    ...(s?.carrier !== undefined ? { carrier: s.carrier } : {}),
    ...(s?.customer !== undefined ? { customer: s.customer } : {}),
  };
}

export async function listCaseRows(store: Store, opts: { status?: StatusFilter; ruleId?: string } = {}): Promise<CaseRow[]> {
  const statuses = statusesFor(opts.status ?? 'active');
  const [cases, shipments] = await Promise.all([
    store.listCases({
      ...(statuses ? { status: statuses } : {}),
      ...(opts.ruleId ? { ruleId: opts.ruleId } : {}),
    }),
    store.listShipments(),
  ]);
  const byId = new Map(shipments.map((s) => [s.id, s]));
  return cases.map((c) => toRow(c, byId.get(c.shipmentId)));
}
