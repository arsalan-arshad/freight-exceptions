import { resolveConfig } from '../config';
import { HOUR_MS, formatDuration, formatUtc, round1, wholeMinutes } from '../format';
import { parseInstant, parseWindow } from '../time';
import type { Severity } from '../types';
import { buildView, firstEvent } from '../view';
import { baseFacts, eventEvidence, loadLabel, makeCase, shipmentEvidence, type RuleFn } from './common';

/**
 * LATE-PU: no pickup confirmation and now > pickupWindow.end + latePickupGraceHours (strictly).
 *
 * "Picked up" = a picked_up event, or a departed event at the pickup stop (CONTRACT). Beyond the
 * contract, a load that is already in_transit, delivered or has any delivery-stop event has
 * obviously been picked up, so the rule stays quiet (otherwise it would raise a nonsense alert).
 * No usable pickup window end => the rule does not fire. Events dated after `now` are ignored.
 *
 * Severity (placeholder thresholds, document-only, not configurable in v0):
 *   med  - pickup unconfirmed past the grace period; the carrier may simply not have reported.
 *   high - unconfirmed 4h or more past the window end: a missed pickup now threatens the delivery.
 *   Capped at med when the truck has already arrived at the pickup stop: then it is a loading
 *   delay at the dock, not a no-show.
 */
export const HIGH_AFTER_MINUTES = 240;

export const latePickup: RuleFn = (shipment, now, config) => {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return [];
  const cfg = resolveConfig(config);
  const win = parseWindow(shipment.pickupWindow);
  if (!win) return [];
  const view = buildView(shipment, nowMs);
  if (view.impliesPickedUp) return [];
  if (!(nowMs > win.endMs + cfg.latePickupGraceHours * HOUR_MS)) return [];

  const overdueMin = Math.max(1, wholeMinutes(nowMs - win.endMs));
  const arrived = firstEvent(view, 'arrived', 'pickup');
  let severity: Severity = overdueMin >= HIGH_AFTER_MINUTES ? 'high' : 'med';
  if (arrived && severity === 'high') severity = 'med';

  const facts = baseFacts(shipment, now);
  if (win.startMs !== undefined) facts.pickupWindowStart = formatUtc(win.startMs);
  facts.pickupWindowEnd = formatUtc(win.endMs);
  facts.minutesOverdue = overdueMin;
  facts.hoursOverdue = round1(overdueMin / 60);
  facts.overdueText = formatDuration(overdueMin);
  if (arrived) facts.arrivedAtPickup = formatUtc(arrived.ms);
  const del = parseInstant(shipment.deliveryWindow?.end);
  if (del) facts.deliveryWindowEnd = formatUtc(del.ms);

  const dur = formatDuration(overdueMin);
  const evidence = [
    shipmentEvidence(
      shipment,
      `Pickup window ${facts.pickupWindowStart ? `${facts.pickupWindowStart} to ` : 'ends '}${facts.pickupWindowEnd}; no pickup confirmation on record`,
    ),
  ];
  if (arrived) evidence.push(eventEvidence(arrived));
  if (view.newest && view.newest !== arrived) evidence.push(eventEvidence(view.newest));

  return [
    makeCase({
      shipment,
      ruleId: 'LATE-PU',
      severity,
      title: `Pickup ${dur} overdue`,
      summary: arrived
        ? `${loadLabel(facts)} arrived at pickup at ${facts.arrivedAtPickup} but no pickup is confirmed; the pickup window ended at ${facts.pickupWindowEnd}, ${dur} before ${facts.asOf}.`
        : `${loadLabel(facts)} has no pickup confirmation; the pickup window ended at ${facts.pickupWindowEnd}, ${dur} before ${facts.asOf}.`,
      facts,
      evidence,
      suggestedNextStep: arrived
        ? 'Ask the carrier or shipper whether loading is finished and when the truck will depart.'
        : 'Ask the carrier to confirm pickup or give a pickup ETA.',
      now,
    }),
  ];
};

