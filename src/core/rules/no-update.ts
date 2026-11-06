import { resolveConfig } from '../config';
import { HOUR_MS, formatDuration, formatUtc, round1, wholeMinutes } from '../format';
import { parseInstant } from '../time';
import type { Severity } from '../types';
import { buildView, firstEvent } from '../view';
import { baseFacts, bumpSeverity, eventEvidence, loadLabel, makeCase, type RuleFn } from './common';

/**
 * NO-UPDATE: picked up, not delivered, and the newest event (any type, not in the future) is
 * older than noUpdateHours (strictly).
 *
 * "Picked up" = picked_up, departed at pickup, or any later sign of movement (in_transit, delivery
 * stop events). A load with no usable events at all is unknowable => the rule does not fire.
 * Events dated after `now` are ignored when finding the newest event.
 *
 * Severity scales with the configured threshold:
 *   ratio = hoursSilent / max(noUpdateHours, 1)
 *   low  - ratio < 2   (default: 6h to 12h of silence)
 *   med  - ratio >= 2  (default: 12h+)
 *   high - ratio >= 4  (default: 24h+; the load is effectively untracked)
 * Bumped one level (max high) when the delivery window end has already passed: a silent load that
 * is also overdue is more urgent than a silent load with time in hand.
 */
export const noUpdate: RuleFn = (shipment, now, config) => {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return [];
  const cfg = resolveConfig(config);
  const view = buildView(shipment, nowMs);
  if (view.delivered || !view.impliesPickedUp || !view.newest) return [];
  const newest = view.newest;
  if (!(nowMs > newest.ms + cfg.noUpdateHours * HOUR_MS)) return [];

  const silentMin = Math.max(1, wholeMinutes(nowMs - newest.ms));
  const hours = silentMin / 60;
  const ratio = hours / Math.max(cfg.noUpdateHours, 1);
  let severity: Severity = ratio >= 4 ? 'high' : ratio >= 2 ? 'med' : 'low';
  const delEnd = parseInstant(shipment.deliveryWindow?.end);
  if (delEnd && delEnd.ms < nowMs) severity = bumpSeverity(severity);

  const facts = baseFacts(shipment, now);
  facts.lastUpdateAt = formatUtc(newest.ms);
  facts.minutesSinceLastUpdate = silentMin;
  facts.hoursSinceLastUpdate = round1(hours);
  // overdueText = time since the last status update (the same duration the headline shows).
  facts.overdueText = formatDuration(silentMin);
  facts.noUpdateThresholdHours = cfg.noUpdateHours;
  const pickedUp = firstEvent(view, 'picked_up');
  if (pickedUp) facts.pickedUpAt = formatUtc(pickedUp.ms);
  if (delEnd) facts.deliveryWindowEnd = formatUtc(delEnd.ms);

  const dur = formatDuration(silentMin);
  const evidence = [eventEvidence(newest)];
  if (pickedUp && pickedUp !== newest) evidence.push(eventEvidence(pickedUp));

  return [
    makeCase({
      shipment,
      ruleId: 'NO-UPDATE',
      severity,
      title: `No update for ${dur}`,
      summary: `${loadLabel(facts)} is in transit and the last status update was at ${facts.lastUpdateAt}, ${dur} before ${facts.asOf}.`,
      facts,
      evidence,
      suggestedNextStep: 'Make a check call to the carrier or driver for a location and ETA.',
      now,
    }),
  ];
};
