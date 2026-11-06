import { resolveConfig } from '../config';
import { formatCents, formatUtc, round1, toCents } from '../format';
import type { Money, Severity } from '../types';
import { buildView } from '../view';
import { baseFacts, docEvidence, loadLabel, lowerSeverity, makeCase, shipmentEvidence, type RuleFn } from './common';

/**
 * RATE-MISMATCH: an invoice document with an amount, and an agreed rate, that differ by more than
 * rateToleranceAmount (same currency) or are in different currencies.
 *
 * Money is compared in integer cents, never as floats, so 0.1 + 0.2 style noise cannot flip a
 * result and a difference of exactly the tolerance does not fire (strictly greater).
 * Which invoice: invoices dated after `now` are ignored, invalid amounts/currencies are skipped,
 * and the LATEST invoice (by receivedAt; unparseable dates sort first) supersedes earlier ones, so a
 * corrected invoice clears the case. No agreed rate, or an unusable one => the rule does not fire.
 * Currencies are compared case-insensitively and must be 3 letters; anything else is unusable.
 *
 * Severity:
 *   currency mismatch - high (amounts cannot be compared; payment risk).
 *   invoice ABOVE agreed (we would overpay), by % of the agreed rate:
 *       low under 2%, med from 2%, high from 10% (agreed rate of 0 => high).
 *   invoice BELOW agreed: one level lower than the same % above, never below low. It is still a
 *       discrepancy to understand, but it costs nothing if paid.
 */
function usableMoney(m: Money | undefined): { cents: number; currency: string } | null {
  if (!m || typeof m !== 'object') return null;
  if (typeof m.amount !== 'number' || !Number.isFinite(m.amount)) return null;
  if (typeof m.currency !== 'string' || !/^[A-Za-z]{3}$/.test(m.currency.trim())) return null;
  if (Math.abs(m.amount) > 1e12) return null;
  return { cents: toCents(m.amount), currency: m.currency.trim().toUpperCase() };
}

export const rateMismatch: RuleFn = (shipment, now, config) => {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return [];
  const cfg = resolveConfig(config);
  const agreed = usableMoney(shipment.agreedRate);
  if (!agreed) return [];
  const view = buildView(shipment, nowMs);
  const invoices = view.docs.filter((d) => d.doc.kind === 'invoice' && usableMoney(d.doc.amount) !== null);
  const latest = invoices[invoices.length - 1];
  if (!latest) return [];
  const inv = usableMoney(latest.doc.amount);
  if (!inv) return [];

  const facts = baseFacts(shipment, now);
  facts.agreedRate = formatCents(agreed.cents, agreed.currency);
  facts.invoiceAmount = formatCents(inv.cents, inv.currency);
  if (latest.ms !== null) facts.invoiceReceivedAt = formatUtc(latest.ms);

  let severity: Severity;
  let title: string;
  let summary: string;
  let step: string;
  const label = loadLabel(facts);

  if (inv.currency !== agreed.currency) {
    severity = 'high';
    facts.agreedCurrency = agreed.currency;
    facts.invoiceCurrency = inv.currency;
    title = `Invoice currency ${inv.currency} differs from agreed ${agreed.currency}`;
    summary = `${label} was agreed at ${facts.agreedRate} but the carrier invoice is ${facts.invoiceAmount}; the currencies differ so the amounts cannot be compared.`;
    step = 'Hold payment and ask the carrier to re-issue the invoice in the agreed currency.';
  } else {
    const tolCents = toCents(cfg.rateToleranceAmount);
    const diff = inv.cents - agreed.cents;
    if (!(Math.abs(diff) > tolCents)) return [];
    const higher = diff > 0;
    const pct = agreed.cents === 0 ? Infinity : (Math.abs(diff) / Math.abs(agreed.cents)) * 100;
    const above: Severity = pct >= 10 ? 'high' : pct >= 2 ? 'med' : 'low';
    severity = higher ? above : lowerSeverity(above);
    facts.differenceAmount = formatCents(diff, agreed.currency, true);
    facts.direction = higher ? 'higher than agreed' : 'lower than agreed';
    if (Number.isFinite(pct)) facts.differencePercent = round1(pct);
    facts.toleranceAmount = formatCents(tolCents, agreed.currency);
    title = `Invoice ${formatCents(Math.abs(diff), agreed.currency)} ${higher ? 'over' : 'under'} agreed rate`;
    summary = `${label} was agreed at ${facts.agreedRate} but the carrier invoice is ${facts.invoiceAmount} (${facts.differenceAmount}, ${higher ? 'higher' : 'lower'} than agreed).`;
    step = higher
      ? 'Hold payment and ask the carrier to explain the difference (for example an accessorial) or correct the invoice.'
      : 'Ask the carrier to confirm the invoice amount against the agreed rate before paying.';
  }

  return [
    makeCase({
      shipment,
      ruleId: 'RATE-MISMATCH',
      severity,
      title,
      summary,
      facts,
      evidence: [
        docEvidence(latest),
        shipmentEvidence(shipment, `Agreed rate ${facts.agreedRate}`),
      ],
      suggestedNextStep: step,
      now,
    }),
  ];
};
