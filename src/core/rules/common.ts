import type { Doc, Evidence, ExceptionCase, RuleConfig, RuleId, Severity, Shipment } from '../types';
import { formatUtc, truncate } from '../format';
import type { TimedDoc, TimedEvent } from '../view';

export type Facts = Record<string, string | number>;

/** Signature shared by every rule. Pure: `now` is a parameter, nothing else is read. */
export type RuleFn = (shipment: Shipment, now: Date, config?: Partial<RuleConfig>) => ExceptionCase[];

const SEVERITIES: Severity[] = ['low', 'med', 'high'];

export function bumpSeverity(s: Severity): Severity {
  return SEVERITIES[Math.min(2, SEVERITIES.indexOf(s) + 1)] ?? 'high';
}

export function lowerSeverity(s: Severity): Severity {
  return SEVERITIES[Math.max(0, SEVERITIES.indexOf(s) - 1)] ?? 'low';
}

export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITIES.indexOf(a) >= SEVERITIES.indexOf(b) ? a : b;
}

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

/** Facts every case carries. Unknown values are omitted, never filled in. */
export function baseFacts(shipment: Shipment, now: Date): Facts {
  const facts: Facts = { reference: nonEmpty(shipment.reference) ? shipment.reference : shipment.id };
  if (nonEmpty(shipment.carrier)) facts.carrier = shipment.carrier;
  if (nonEmpty(shipment.customer)) facts.customer = shipment.customer;
  facts.asOf = formatUtc(now.getTime());
  return facts;
}

export function eventEvidence(te: TimedEvent): Evidence {
  const e = te.event;
  const stop = e.stop ? ` (${e.stop})` : '';
  let text = `${e.id}: ${e.type}${stop} at ${formatUtc(te.ms)}`;
  if (te.eta) text += `, ETA ${formatUtc(te.eta.ms)}`;
  const quote = e.source?.excerpt ?? e.note;
  if (typeof quote === 'string' && quote.trim() !== '') text += ` - "${truncate(quote.trim(), 120)}"`;
  return { source: 'event', ref: e.source?.ref ?? e.id, excerpt: truncate(text, 240) };
}

export function docEvidence(td: TimedDoc): Evidence {
  const d: Doc = td.doc;
  let text = `${d.id}: ${d.kind}`;
  if (td.ms !== null) text += ` received ${formatUtc(td.ms)}`;
  const quote = d.source?.excerpt;
  if (typeof quote === 'string' && quote.trim() !== '') text += ` - "${truncate(quote.trim(), 120)}"`;
  return { source: 'document', ref: d.source?.ref ?? d.id, excerpt: truncate(text, 240) };
}

/**
 * Evidence for values that live on the shipment record itself (windows, agreed rate, free time).
 * The shipment record comes from the CSV import (or manual entry), so it is labelled `csv`.
 */
export function shipmentEvidence(shipment: Shipment, excerpt: string): Evidence {
  return { source: 'csv', ref: `shipment:${shipment.id}`, excerpt: truncate(excerpt, 240) };
}

export function makeCase(args: {
  shipment: Shipment;
  ruleId: RuleId;
  idSuffix?: string;
  severity: Severity;
  title: string;
  summary: string;
  facts: Facts;
  evidence: Evidence[];
  suggestedNextStep: string;
  now: Date;
}): ExceptionCase {
  return {
    id: `${args.shipment.id}:${args.ruleId}${args.idSuffix ? `:${args.idSuffix}` : ''}`,
    shipmentId: args.shipment.id,
    ruleId: args.ruleId,
    severity: args.severity,
    title: args.title,
    summary: args.summary,
    facts: args.facts,
    evidence: args.evidence,
    suggestedNextStep: args.suggestedNextStep,
    detectedAt: args.now.toISOString(),
    status: 'open',
  };
}

/** "load FX-1 (Example Carrier LLC)" style label used in summaries. */
export function loadLabel(facts: Facts): string {
  const ref = String(facts.reference);
  return typeof facts.carrier === 'string' ? `Load ${ref} (${facts.carrier})` : `Load ${ref}`;
}
