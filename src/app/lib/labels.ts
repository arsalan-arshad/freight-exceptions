import type { RuleId } from '@/core/types';

export const RULE_LABELS: Record<RuleId, string> = {
  'LATE-PU': 'Late pickup',
  'LATE-DEL': 'Late delivery',
  'NO-POD': 'Missing proof of delivery',
  'NO-UPDATE': 'No status update',
  DETENTION: 'Detention',
  'RATE-MISMATCH': 'Rate mismatch',
};

export const RULE_IDS = Object.keys(RULE_LABELS) as RuleId[];

export function ruleLabel(id: string): string {
  return (RULE_LABELS as Record<string, string>)[id] ?? id;
}

export const STATUS_FILTER_LABELS: Record<string, string> = {
  active: 'Open and drafted',
  open: 'Open only',
  drafted: 'Drafted only',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
  all: 'All',
};

/** Format an ISO time for display in the viewer's UTC-based fallback; the facts already carry display-ready times. */
export function fmtIso(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

/** Readable names for fact keys. Unknown keys fall back to a humanised camelCase name. */
export const FACT_LABELS: Record<string, string> = {
  reference: 'Reference',
  carrier: 'Carrier',
  customer: 'Customer',
  asOf: 'Checked at',
  stop: 'Stop',
  pickupWindowStart: 'Pickup window starts',
  pickupWindowEnd: 'Pickup window ends',
  deliveryWindowStart: 'Delivery window starts',
  deliveryWindowEnd: 'Delivery window ends',
  arrivedAt: 'Arrived',
  arrivedAtPickup: 'Arrived at pickup',
  departedAt: 'Departed',
  pickedUpAt: 'Picked up',
  deliveredAt: 'Delivered',
  etaReportedAt: 'ETA reported at',
  lastUpdateAt: 'Last update',
  stillOnSite: 'Still on site',
  overdueText: 'Overdue by',
  projectedLateText: 'Projected late by',
  dwellText: 'Time on site',
  freeTimeText: 'Free time',
  overFreeTimeText: 'Over free time by',
  noPodThresholdHours: 'No-POD threshold (hours)',
  noUpdateThresholdHours: 'No-update threshold (hours)',
  agreedRate: 'Agreed rate',
  invoiceAmount: 'Invoice amount',
  agreedCurrency: 'Agreed rate currency',
  invoiceCurrency: 'Invoice currency',
  differenceAmount: 'Difference',
  direction: 'Direction',
  differencePercent: 'Difference (%)',
  toleranceAmount: 'Tolerance',
  minutesOverdue: 'Minutes overdue',
  hoursOverdue: 'Hours overdue',
  minutesSinceDelivered: 'Minutes since delivered',
  hoursSinceDelivered: 'Hours since delivered',
  minutesSinceLastUpdate: 'Minutes since last update',
  hoursSinceLastUpdate: 'Hours since last update',
  projectedMinutesLate: 'Projected minutes late',
  projectedHoursLate: 'Projected hours late',
  dwellMinutes: 'Minutes on site',
  freeTimeMinutes: 'Free time (minutes)',
  detentionMinutes: 'Detention (minutes)',
  detentionHours: 'Detention (hours)',
};

/** Raw numeric facts that a human-readable "...Text" fact already says better. Shown under "raw values". */
const RAW_UNLESS_TEXT: Record<string, string> = {
  minutesOverdue: 'overdueText',
  hoursOverdue: 'overdueText',
  minutesSinceDelivered: 'overdueText',
  hoursSinceDelivered: 'overdueText',
  minutesSinceLastUpdate: 'overdueText',
  hoursSinceLastUpdate: 'overdueText',
  projectedMinutesLate: 'projectedLateText',
  projectedHoursLate: 'projectedLateText',
  dwellMinutes: 'dwellText',
  freeTimeMinutes: 'freeTimeText',
  detentionMinutes: 'overFreeTimeText',
  detentionHours: 'overFreeTimeText',
};

export function factLabel(key: string): string {
  const known = FACT_LABELS[key];
  if (known) return known;
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export interface FactRow {
  key: string;
  label: string;
  value: string;
}

/** Split facts into the readable list and the raw numbers that a Text fact already covers. */
export function splitFacts(facts: Record<string, string | number>): { main: FactRow[]; raw: FactRow[] } {
  const main: FactRow[] = [];
  const raw: FactRow[] = [];
  for (const [key, v] of Object.entries(facts)) {
    const row = { key, label: factLabel(key), value: String(v) };
    const covered = RAW_UNLESS_TEXT[key];
    if (covered !== undefined && covered in facts) raw.push(row);
    else main.push(row);
  }
  return { main, raw };
}
