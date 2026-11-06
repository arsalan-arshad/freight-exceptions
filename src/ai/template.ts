// Deterministic follow-up drafts. Uses ONLY values from c.facts plus fixed words. Missing optional facts degrade
// gracefully (the sentence that needs them is simplified or dropped); nothing is ever invented.
//
// Fact keys it looks for (case/punctuation-insensitive, first match wins). Any that are absent are simply skipped:
//   reference | ref | loadNumber      carrier | carrierName
//   pickupWindowEnd | pickupEnd      deliveryWindowEnd | deliveryEnd      eta | latestEta
//   deliveredAt                      lastEventAt | lastUpdateAt | lastStatusAt
//   stop                             arrivedAt | departedAt
//   dwellText | dwellMinutes         freeTimeText | freeTimeMinutes     overFreeTimeText | detentionMinutes
//   overdueText (LATE-PU / LATE-DEL)
//   invoiceAmount                    agreedRate | agreedAmount
//   asOf, stillOnSite ('yes')        differenceAmount + direction (RATE-MISMATCH)
// A bare number for dwell/freeTime is read as minutes (or hours if the key says "hours").
import type { ExceptionCase } from '../core/types';
import { factKind, isSafeFreeText, validateDraft } from './validate';

type Facts = Record<string, string | number>;

function normKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cleanValue(v: unknown): string | undefined {
  let s: string;
  if (typeof v === 'number') s = Number.isFinite(v) ? String(v) : '';
  else if (typeof v === 'string') s = v;
  else return undefined;
  s = s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (s === '' || s.length > 120) return undefined;
  return s;
}

/** Rule-computed strings are times, amounts, durations and enums: a small plain charset, no links, no long text. */
const COMPUTED_CHARS = /^[\p{Script=Latin}\p{M}0-9 .,:+\-/()%$&'#]+$/u;
const LINKISH = /@|https?:|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|us|biz|info|ru|cn|xyz)\b/i;

/**
 * Facts that are safe to put in front of a reader or a model.
 *  - free text (carrier, customer, reference and any other typed string): isSafeFreeText, i.e. <= 60 plain Latin
 *    characters, no links, no payment-instruction words, no threats/insults/number words;
 *  - rule-computed strings (times, amounts, durations): short, plain charset, no links, and they must pass validateDraft;
 *  - numbers: always.
 * Anything else is treated as missing, and the sentence that needs it is simply left out.
 */
export function usableFacts(c: ExceptionCase): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(c?.facts ?? {})) {
    const v = cleanValue(raw);
    if (v === undefined) continue;
    if (typeof raw === 'number') {
      out[k] = v;
      continue;
    }
    const kind = factKind(k, raw);
    if (kind === 'computed') {
      if (v.length > 80 || !COMPUTED_CHARS.test(v) || LINKISH.test(v)) continue;
      if (!validateDraft(v, c).ok) continue;
    } else if (!isSafeFreeText(v)) continue;
    out[k] = v;
  }
  return out;
}

class Reader {
  private readonly m = new Map<string, { key: string; value: string }>();
  constructor(facts: Record<string, string>) {
    for (const [k, v] of Object.entries(facts)) if (!this.m.has(normKey(k))) this.m.set(normKey(k), { key: k, value: v });
  }
  get(...aliases: string[]): { key: string; value: string } | undefined {
    for (const a of aliases) {
      const hit = this.m.get(normKey(a));
      if (hit) return hit;
    }
    return undefined;
  }
  val(...aliases: string[]): string | undefined {
    return this.get(...aliases)?.value;
  }
  /** Durations: add a unit word when the value is a bare number. */
  duration(...aliases: string[]): string | undefined {
    const hit = this.get(...aliases);
    if (!hit) return undefined;
    if (/^\d+(\.\d+)?$/.test(hit.value)) return `${hit.value} ${/hour/i.test(hit.key) ? 'hours' : 'minutes'}`;
    return hit.value;
  }
}

const THANKS = 'Thank you.';

export function templateDraft(c: ExceptionCase): { subject: string; body: string } {
  const f = new Reader(usableFacts(c));
  const ref = f.val('reference', 'ref', 'loadNumber', 'loadRef', 'shipmentReference');
  const carrier = f.val('carrier', 'carrierName');
  const loadRef = ref ? `load ${ref}` : 'this load';
  const subj = (head: string) => (ref ? `${head} - load ${ref}` : head);
  const greet = carrier ? `Hello ${carrier} team,` : 'Hello,';
  const paras = (...p: Array<string | undefined>) => p.filter((x): x is string => !!x).join('\n\n');

  switch (c?.ruleId) {
    case 'LATE-PU': {
      const end = f.val('pickupWindowEnd', 'pickupEnd', 'pickupBy', 'pickupDeadline');
      const over = f.val('overdueText');
      return {
        subject: subj('Pickup ETA request'),
        body: paras(
          greet,
          `Could you please send us an updated ETA for pickup on ${loadRef}? ${end ? `The pickup window ended at ${end} and we have not yet seen a pickup confirmation.` : 'We have not yet seen a pickup confirmation.'}${over ? ` That is ${over} past the window end.` : ''}`,
          'If the pickup has already happened, please confirm the time so we can update our records.',
          THANKS,
        ),
      };
    }
    case 'LATE-DEL': {
      const end = f.val('deliveryWindowEnd', 'deliveryEnd', 'deliveryBy', 'deliveryDeadline');
      const eta = f.val('eta', 'latestEta', 'newEta');
      const over = f.val('overdueText');
      const status =
        end && eta
          ? `The delivery window end is ${end} and the latest ETA we have is ${eta}.`
          : end
            ? `The delivery window end is ${end} and we have no delivery confirmation yet.`
            : eta
              ? `The latest ETA we have is ${eta}.`
              : 'We have no delivery confirmation yet.';
      return {
        subject: subj('Delivery ETA request'),
        body: paras(
          greet,
          `Could you please send us an updated ETA for delivery of ${loadRef}? ${status}${over ? ` The delivery is ${over} past the window end.` : ''}`,
          'Please let us know if anything is holding the load up.',
          THANKS,
        ),
      };
    }
    case 'NO-POD': {
      const at = f.val('deliveredAt', 'deliveryTime', 'deliveredTime');
      const asOf = f.val('asOf');
      const since = asOf ? f.val('overdueText') : undefined;
      return {
        subject: subj('POD request'),
        body: paras(
          greet,
          `Could you please send the signed proof of delivery (POD) for ${loadRef}? ${at ? `Delivery was recorded at ${at} and we have not received the POD yet.` : 'We have not received the POD yet.'}${since ? ` That was ${since} before ${asOf}.` : ''}`,
          'A photo or scan of the signed delivery receipt is fine.',
          THANKS,
        ),
      };
    }
    case 'NO-UPDATE': {
      const last = f.val('lastEventAt', 'lastUpdateAt', 'lastStatusAt', 'lastUpdate', 'lastEvent');
      const asOf = f.val('asOf');
      const since = asOf ? f.val('overdueText') : undefined;
      return {
        subject: subj('Status update request'),
        body: paras(
          greet,
          `Could you please send us a status update on ${loadRef}? ${last ? `The last update we have is from ${last}${since ? ` (${since} before ${asOf})` : ''}.` : 'We have not had a recent status update.'}`,
          'Please include the current location and the expected delivery time.',
          THANKS,
        ),
      };
    }
    case 'DETENTION': {
      const stop = f.val('stop', 'stopKind');
      const arrived = f.val('arrivedAt', 'arrival', 'arrived');
      const departed = f.val('departedAt', 'departure', 'departed');
      const dwell = f.val('dwellText') ?? f.duration('dwellMinutes', 'dwell', 'dwellTime', 'dwellHours');
      const free = f.val('freeTimeText') ?? f.duration('freeTimeMinutes', 'freeTime', 'freeTimeHours');
      const overFree = f.val('overFreeTimeText');
      const onSite = dwell
        ? `Time on site: ${dwell}${free ? `, against ${free} of free time` : ''}${overFree ? ` (${overFree} over)` : ''}.`
        : free
          ? `Free time at this stop: ${free}.`
          : undefined;
      const asOf = f.val('asOf');
      const still = f.val('stillOnSite')?.toLowerCase() === 'yes' ? `The truck is still on site${asOf ? ` as of ${asOf}` : ''}.` : undefined;
      const details = [stop ? `Stop: ${stop}.` : undefined, arrived ? `Arrived: ${arrived}.` : undefined, departed ? `Departed: ${departed}.` : undefined, onSite, still]
        .filter((x): x is string => !!x)
        .join('\n');
      return {
        subject: subj('Detention to review'),
        body: paras(
          'Note for you (internal, not for the carrier).',
          `Detention may apply on ${loadRef}${carrier ? ` (carrier: ${carrier})` : ''}.`,
          details || undefined,
          'Please review the timestamps and decide whether to bill accessorial (detention) charges, as your terms allow.',
        ),
      };
    }
    case 'RATE-MISMATCH': {
      const inv = f.val('invoiceAmount', 'invoiced', 'invoiceTotal', 'billedAmount');
      const agreed = f.val('agreedRate', 'agreedAmount', 'rate');
      const diff = f.val('differenceAmount');
      const dir = f.val('direction');
      const gap = diff && dir ? ` The invoice is ${dir} (difference ${diff}).` : '';
      const compare =
        inv && agreed
          ? `Your invoice shows ${inv}, while our records show an agreed rate of ${agreed}.${gap}`
          : inv
            ? `Your invoice shows ${inv}, which does not match our records of the agreed rate.`
            : agreed
              ? `Our records show an agreed rate of ${agreed}, which does not match your invoice.`
              : 'The invoice amount does not match our records of the agreed rate.';
      return {
        subject: subj('Invoice amount query'),
        body: paras(
          greet,
          `We are checking your invoice for ${loadRef} against the agreed rate. ${compare}`,
          'Could you please confirm the correct amount, or send the rate confirmation or a corrected invoice if needed?',
          THANKS,
        ),
      };
    }
    default:
      return {
        subject: subj('Status request'),
        body: paras(greet, `Could you please send us a status update on ${loadRef}?`, THANKS),
      };
  }
}
