import { resolveConfig } from '../config';
import { HOUR_MS, formatDuration, formatUtc, round1, wholeMinutes } from '../format';
import { parseWindow } from '../time';
import type { Severity } from '../types';
import { buildView } from '../view';
import { baseFacts, eventEvidence, loadLabel, makeCase, maxSeverity, shipmentEvidence, type RuleFn } from './common';

/**
 * LATE-DEL: not delivered, and either
 *   (a) now > deliveryWindow.end + lateDeliveryGraceHours (strictly), or
 *   (b) the ETA on the NEWEST eta_update (not in the future) is strictly after deliveryWindow.end.
 * Only the newest eta_update counts: if its eta does not parse the ETA signal is unknown, we do
 * not fall back to an older, possibly stale ETA. The grace period applies to (a) only (CONTRACT).
 * No usable delivery window end => the rule does not fire. A `delivered` event dated after
 * `now` is ignored, so such a load still counts as not delivered.
 *
 * Severity:
 *   (a) overdue: med while under 2h past the window end, high from 2h (the customer is waiting).
 *   (b) ETA-only forecast (not late yet): low if the projected lateness is under 2h, med under 8h,
 *       high from 8h. It is an early warning, so it ranks below an actual miss of equal size.
 *   When both hold, the higher of the two.
 */
const OVERDUE_HIGH_MIN = 120;
const FORECAST_MED_MIN = 120;
const FORECAST_HIGH_MIN = 480;

export const lateDelivery: RuleFn = (shipment, now, config) => {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return [];
  const cfg = resolveConfig(config);
  const win = parseWindow(shipment.deliveryWindow);
  if (!win) return [];
  const view = buildView(shipment, nowMs);
  if (view.delivered) return [];

  const overdue = nowMs > win.endMs + cfg.lateDeliveryGraceHours * HOUR_MS;
  const etaEvent = view.latestEtaEvent;
  const eta = etaEvent?.eta;
  const etaLate = eta !== undefined && eta.ms > win.endMs;
  if (!overdue && !etaLate) return [];

  const facts = baseFacts(shipment, now);
  if (win.startMs !== undefined) facts.deliveryWindowStart = formatUtc(win.startMs);
  facts.deliveryWindowEnd = formatUtc(win.endMs);

  let severity: Severity = 'low';
  let overdueMin = 0;
  if (overdue) {
    overdueMin = Math.max(1, wholeMinutes(nowMs - win.endMs));
    facts.minutesOverdue = overdueMin;
    facts.hoursOverdue = round1(overdueMin / 60);
    facts.overdueText = formatDuration(overdueMin);
    severity = overdueMin >= OVERDUE_HIGH_MIN ? 'high' : 'med';
  }
  let projectedMin = 0;
  if (etaLate && eta && etaEvent) {
    projectedMin = Math.max(1, wholeMinutes(eta.ms - win.endMs));
    facts.latestEta = formatUtc(eta.ms);
    facts.etaReportedAt = formatUtc(etaEvent.ms);
    facts.projectedMinutesLate = projectedMin;
    facts.projectedHoursLate = round1(projectedMin / 60);
    facts.projectedLateText = formatDuration(projectedMin);
    const forecast: Severity =
      projectedMin >= FORECAST_HIGH_MIN ? 'high' : projectedMin >= FORECAST_MED_MIN ? 'med' : 'low';
    severity = overdue ? maxSeverity(severity, forecast) : forecast;
  }
  if (view.newest) facts.lastUpdateAt = formatUtc(view.newest.ms);

  const evidence = [
    shipmentEvidence(
      shipment,
      `Delivery window ${facts.deliveryWindowStart ? `${facts.deliveryWindowStart} to ` : 'ends '}${facts.deliveryWindowEnd}; no delivery confirmation on record`,
    ),
  ];
  if (etaLate && etaEvent) evidence.push(eventEvidence(etaEvent));
  if (view.newest && view.newest !== etaEvent) evidence.push(eventEvidence(view.newest));

  const label = loadLabel(facts);
  let title: string;
  let summary: string;
  if (overdue) {
    const dur = formatDuration(overdueMin);
    title = `Delivery ${dur} overdue`;
    summary = `${label} is not delivered; the delivery window ended at ${facts.deliveryWindowEnd}, ${dur} before ${facts.asOf}.`;
    if (etaLate) summary += ` The latest carrier ETA is ${facts.latestEta}.`;
  } else {
    const dur = formatDuration(projectedMin);
    title = `Delivery ETA ${dur} after window`;
    summary = `${label} has a carrier ETA of ${facts.latestEta}, ${dur} after the delivery window end of ${facts.deliveryWindowEnd}.`;
  }

  return [
    makeCase({
      shipment,
      ruleId: 'LATE-DEL',
      severity,
      title,
      summary,
      facts,
      evidence,
      suggestedNextStep: overdue
        ? 'Ask the carrier for a current ETA and warn the customer if the delivery will be late.'
        : 'Confirm the new ETA with the carrier and warn the customer that delivery will miss the window.',
      now,
    }),
  ];
};
