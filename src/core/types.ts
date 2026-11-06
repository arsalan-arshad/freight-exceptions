// SHARED DOMAIN CONTRACT. Owned by the orchestrator. Do not edit without asking.
// All times are ISO 8601 strings with an offset or Z. Pure data: JSON-serialisable.

export type ISODateTime = string;

export interface Money {
  /** Major units, e.g. 1250.5 for 1,250.50 */
  amount: number;
  /** ISO 4217, upper case, e.g. "USD" */
  currency: string;
}

export interface Window {
  start: ISODateTime;
  end: ISODateTime;
}

/** Where a fact came from, so a person can verify it. */
export interface SourceRef {
  kind: 'csv' | 'email' | 'manual' | 'synthetic';
  /** e.g. "shipments.csv:row 12", "email:msg-0007" */
  ref: string;
  /** Short verbatim excerpt from the source, if any. */
  excerpt?: string;
}

export type StopKind = 'pickup' | 'delivery';

export type EventType =
  | 'arrived' // truck arrived at a stop (uses `stop`)
  | 'departed' // truck left a stop (uses `stop`)
  | 'picked_up' // pickup confirmed
  | 'in_transit'
  | 'eta_update' // carrier gave a new delivery ETA (`eta` set)
  | 'delivered' // delivery confirmed
  | 'status_update'; // any other status message

export interface StatusEvent {
  id: string;
  type: EventType;
  /** When the event happened (or was reported, if only that is known). */
  at: ISODateTime;
  stop?: StopKind;
  eta?: ISODateTime;
  note?: string;
  source: SourceRef;
}

export type DocKind = 'pod' | 'bol' | 'rate_confirmation' | 'invoice' | 'other';

export interface Doc {
  id: string;
  kind: DocKind;
  receivedAt: ISODateTime;
  /** Set for invoices: the amount the carrier billed. */
  amount?: Money;
  source: SourceRef;
}

export interface Shipment {
  id: string;
  /** Broker's load / reference number as people say it. */
  reference: string;
  customer?: string;
  carrier?: string;
  pickupWindow?: Window;
  deliveryWindow?: Window;
  /** Free time at a stop before detention starts. Falls back to RuleConfig default. */
  freeTimeMinutes?: number;
  agreedRate?: Money;
  events: StatusEvent[];
  documents: Doc[];
}

export type RuleId =
  | 'LATE-PU'
  | 'LATE-DEL'
  | 'NO-POD'
  | 'NO-UPDATE'
  | 'DETENTION'
  | 'RATE-MISMATCH';

export type Severity = 'low' | 'med' | 'high';
export type CaseStatus = 'open' | 'drafted' | 'resolved' | 'dismissed';

export interface Evidence {
  source: 'email' | 'csv' | 'event' | 'document';
  ref: string;
  excerpt: string;
}

export interface ExceptionCase {
  /** Deterministic: `${shipmentId}:${ruleId}` (+ `:${stop}` for DETENTION). Same input => same id. */
  id: string;
  shipmentId: string;
  ruleId: RuleId;
  severity: Severity;
  /** Short deterministic headline, e.g. "Pickup 5h overdue". */
  title: string;
  /** Deterministic one-sentence explanation built from facts. */
  summary: string;
  /**
   * THE ONLY values a drafted message may contain (times, amounts, references, names).
   * Values are display-ready strings or numbers. Drafts are validated against these.
   */
  facts: Record<string, string | number>;
  evidence: Evidence[];
  /** Deterministic suggestion from the rule, e.g. "Ask carrier for ETA". */
  suggestedNextStep: string;
  detectedAt: ISODateTime;
  status: CaseStatus;
  /**
   * Who moved the case to 'resolved': a person, or the system because new data cleared the condition.
   * Absent for open cases. A case resolved by 'data' re-opens if the exception is detected again;
   * one resolved or dismissed by a 'person' stays as they left it.
   */
  resolvedBy?: 'person' | 'data';
}

/** Thresholds are placeholders until brokers confirm them. All configurable. */
export interface RuleConfig {
  latePickupGraceHours: number; // LATE-PU: hours after pickup window end
  lateDeliveryGraceHours: number; // LATE-DEL: hours after delivery window end (or ETA past window end)
  noPodHours: number; // NO-POD: hours after delivered with no POD document
  noUpdateHours: number; // NO-UPDATE: hours without any event while in transit
  defaultFreeTimeMinutes: number; // DETENTION: used when the shipment has no freeTimeMinutes
  rateToleranceAmount: number; // RATE-MISMATCH: absolute tolerance in major units
}

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  latePickupGraceHours: 2,
  lateDeliveryGraceHours: 0,
  noPodHours: 24,
  noUpdateHours: 6,
  defaultFreeTimeMinutes: 120,
  rateToleranceAmount: 0.5,
};
