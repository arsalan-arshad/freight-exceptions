import { resolveConfig } from '../config';
import { HOUR_MS, formatDuration, formatUtc, round1, wholeMinutes } from '../format';
import type { Severity } from '../types';
import { buildView } from '../view';
import { baseFacts, eventEvidence, loadLabel, makeCase, shipmentEvidence, type RuleFn } from './common';

/**
 * NO-POD: has a delivered event, no `pod` document, and now > deliveredAt + noPodHours (strictly).
 *
 * deliveredAt = the EARLIEST valid delivered event not in the future (a carrier re-reporting
 * "delivered" later must not postpone the clock). A pod document with an unparseable receivedAt
 * still counts as present (garbage input must not create a false alarm); a pod dated after `now`
 * is ignored. A delivered event with a garbage time => the rule does not fire.
 *
 * Severity scales with the configured threshold so overrides keep their meaning:
 *   ratio = hoursSinceDelivered / max(noPodHours, 1)
 *   low  - ratio < 2   (default: 24h to 48h; normal carrier lag)
 *   med  - ratio >= 2  (default: 48h+)
 *   high - ratio >= 3  (default: 72h+; billing and customer paperwork are blocked)
 */
export const noPod: RuleFn = (shipment, now, config) => {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return [];
  const cfg = resolveConfig(config);
  const view = buildView(shipment, nowMs);
  const delivered = view.delivered;
  if (!delivered) return [];
  if (view.docs.some((d) => d.doc.kind === 'pod')) return [];
  if (!(nowMs > delivered.ms + cfg.noPodHours * HOUR_MS)) return [];

  const sinceMin = Math.max(1, wholeMinutes(nowMs - delivered.ms));
  const hours = sinceMin / 60;
  const ratio = hours / Math.max(cfg.noPodHours, 1);
  const severity: Severity = ratio >= 3 ? 'high' : ratio >= 2 ? 'med' : 'low';

  const facts = baseFacts(shipment, now);
  facts.deliveredAt = formatUtc(delivered.ms);
  facts.minutesSinceDelivered = sinceMin;
  facts.hoursSinceDelivered = round1(hours);
  // overdueText = time elapsed since delivery (the same duration the headline shows).
  facts.overdueText = formatDuration(sinceMin);
  facts.noPodThresholdHours = cfg.noPodHours;

  const dur = formatDuration(sinceMin);
  const label = loadLabel(facts);
  return [
    makeCase({
      shipment,
      ruleId: 'NO-POD',
      severity,
      title: `No POD ${dur} after delivery`,
      summary: `${label} was delivered at ${facts.deliveredAt} but no proof of delivery has been received ${dur} later (as of ${facts.asOf}).`,
      facts,
      evidence: [
        eventEvidence(delivered),
        shipmentEvidence(shipment, `No proof of delivery document on record for ${facts.reference}`),
      ],
      suggestedNextStep: 'Request the signed proof of delivery from the carrier.',
      now,
    }),
  ];
};
