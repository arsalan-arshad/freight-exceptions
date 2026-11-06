import { resolveConfig } from '../config';
import { MINUTE_MS, formatDuration, formatUtc, round1, wholeMinutes } from '../format';
import type { Severity, StopKind } from '../types';
import { buildView, type ShipmentView, type TimedEvent } from '../view';
import { baseFacts, bumpSeverity, eventEvidence, loadLabel, makeCase, shipmentEvidence, type RuleFn } from './common';

/**
 * DETENTION: evaluated per stop (pickup, delivery). dwell = departed - arrived, or now - arrived
 * while the truck is still on site. Fires when dwell > free time (strictly). Case id suffix is
 * `:pickup` or `:delivery`.
 *
 * Free time = shipment.freeTimeMinutes (if a finite number >= 0) else config.defaultFreeTimeMinutes.
 *
 * Never guess: the rule does not fire for a stop when
 *   - there is no valid arrived event at that stop;
 *   - departed events exist but none is at/after the arrival (contradictory times);
 *   - there is no departed event but the load has clearly moved on (pickup stop: picked_up,
 *     in_transit, delivered or any delivery-stop event; delivery stop: delivered), because then
 *     "still on site" would overstate the dwell. Departure time is simply unknown.
 * Uses the earliest arrival and the earliest departure at/after it. Events dated after `now` are ignored.
 *
 * Severity by detention minutes (dwell beyond free time):
 *   low  - under 60 minutes over;  med - 60 to 239 minutes;  high - 240 minutes or more.
 *   Bumped one level (max high) while the truck is still on site: it is still running and the
 *   broker can act and document it now.
 */
function stopCase(
  shipment: Parameters<RuleFn>[0],
  now: Date,
  view: ShipmentView,
  stop: StopKind,
  defaultFreeMinutes: number,
) {
  const arrivals = view.events.filter((e) => e.event.type === 'arrived' && e.event.stop === stop);
  const arrival = arrivals[0];
  if (!arrival) return null;
  const departures = view.events.filter((e) => e.event.type === 'departed' && e.event.stop === stop);
  let departure: TimedEvent | undefined;
  if (departures.length > 0) {
    departure = departures.find((d) => d.ms >= arrival.ms);
    if (!departure) return null;
  } else {
    const movedOn =
      stop === 'pickup'
        ? view.impliesPickedUp
        : view.events.some((e) => e.event.type === 'delivered');
    if (movedOn) return null;
  }

  const endMs = departure ? departure.ms : view.nowMs;
  const dwellMs = endMs - arrival.ms;
  const rawFree = shipment.freeTimeMinutes;
  const freeMin =
    typeof rawFree === 'number' && Number.isFinite(rawFree) && rawFree >= 0 ? rawFree : defaultFreeMinutes;
  if (!(dwellMs > freeMin * MINUTE_MS)) return null;

  const dwellMin = wholeMinutes(dwellMs);
  const overMin = Math.max(1, wholeMinutes(dwellMs - freeMin * MINUTE_MS));
  const stillOnSite = !departure;
  let severity: Severity = overMin >= 240 ? 'high' : overMin >= 60 ? 'med' : 'low';
  if (stillOnSite) severity = bumpSeverity(severity);

  const facts = baseFacts(shipment, now);
  facts.stop = stop;
  facts.arrivedAt = formatUtc(arrival.ms);
  if (departure) facts.departedAt = formatUtc(departure.ms);
  facts.stillOnSite = stillOnSite ? 'yes' : 'no';
  facts.dwellMinutes = dwellMin;
  facts.freeTimeMinutes = freeMin;
  facts.detentionMinutes = overMin;
  facts.detentionHours = round1(overMin / 60);
  facts.dwellText = formatDuration(dwellMin);
  facts.overFreeTimeText = formatDuration(overMin);
  facts.freeTimeText = formatDuration(freeMin);

  const over = formatDuration(overMin);
  const label = loadLabel(facts);
  const evidence = [eventEvidence(arrival)];
  if (departure) evidence.push(eventEvidence(departure));
  evidence.push(
    shipmentEvidence(
      shipment,
      `Free time ${facts.freeTimeText} at the ${stop} stop${
        typeof rawFree === 'number' && Number.isFinite(rawFree) && rawFree >= 0 ? '' : ' (default, none set on the shipment)'
      }`,
    ),
  );

  return makeCase({
    shipment,
    ruleId: 'DETENTION',
    idSuffix: stop,
    severity,
    title: `Detention at ${stop}: ${over} over free time`,
    summary: stillOnSite
      ? `${label} arrived at the ${stop} stop at ${facts.arrivedAt} and is still on site: ${facts.dwellText} so far against ${facts.freeTimeText} of free time (as of ${facts.asOf}).`
      : `${label} spent ${facts.dwellText} at the ${stop} stop (${facts.arrivedAt} to ${facts.departedAt}) against ${facts.freeTimeText} of free time.`,
    facts,
    evidence,
    suggestedNextStep: stillOnSite
      ? 'Document the arrival time now and flag the stop for accessorial (detention) billing.'
      : 'Flag the stop for accessorial (detention) billing and check the carrier invoice for a detention charge.',
    now,
  });
}

export const detention: RuleFn = (shipment, now, config) => {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return [];
  const cfg = resolveConfig(config);
  const view = buildView(shipment, nowMs);
  const out = [];
  for (const stop of ['pickup', 'delivery'] as const) {
    const c = stopCase(shipment, now, view, stop, cfg.defaultFreeTimeMinutes);
    if (c) out.push(c);
  }
  return out;
};
