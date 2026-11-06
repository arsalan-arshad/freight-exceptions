import type { RuleId } from '../types';
import type { RuleFn } from './common';
import { detention } from './detention';
import { lateDelivery } from './late-del';
import { latePickup } from './late-pu';
import { noPod } from './no-pod';
import { noUpdate } from './no-update';
import { rateMismatch } from './rate-mismatch';

export type { RuleFn } from './common';
export { detention, lateDelivery, latePickup, noPod, noUpdate, rateMismatch };

export interface RuleDefinition {
  id: RuleId;
  description: string;
  /** Plain-language severity logic (placeholder thresholds). The code comments in each rule file are authoritative. */
  severityLogic: string;
  evaluate: RuleFn;
}

export const RULES: readonly RuleDefinition[] = [
  {
    id: 'LATE-PU',
    description:
      'No pickup confirmation (no picked_up, no departure from the pickup stop) after the pickup window end plus the grace period.',
    severityLogic: 'med when overdue; high at 4h or more past the window end; capped at med if the truck already arrived at pickup.',
    evaluate: latePickup,
  },
  {
    id: 'LATE-DEL',
    description:
      'Not delivered and either past the delivery window end plus grace, or the latest carrier ETA is after the window end.',
    severityLogic:
      'Overdue: med, high from 2h past the window end. ETA-only forecast: low under 2h, med under 8h, high from 8h. Higher of the two if both.',
    evaluate: lateDelivery,
  },
  {
    id: 'NO-POD',
    description: 'Delivered, but no proof-of-delivery document within the configured hours.',
    severityLogic: 'By hours since delivery relative to the threshold: low under 2x, med from 2x, high from 3x (default 24h/48h/72h).',
    evaluate: noPod,
  },
  {
    id: 'NO-UPDATE',
    description: 'Picked up and not delivered, but the newest status event is older than the configured hours.',
    severityLogic:
      'By silence relative to the threshold: low under 2x, med from 2x, high from 4x (default 6h/12h/24h); +1 level if the delivery window already ended.',
    evaluate: noUpdate,
  },
  {
    id: 'DETENTION',
    description: 'Dwell time at a pickup or delivery stop exceeds the free time. One case per stop.',
    severityLogic: 'By minutes over free time: low under 60, med 60-239, high 240+; +1 level while the truck is still on site.',
    evaluate: detention,
  },
  {
    id: 'RATE-MISMATCH',
    description: 'Latest carrier invoice differs from the agreed rate by more than the tolerance, or is in a different currency.',
    severityLogic:
      'Currency mismatch: high. Invoice above agreed: low under 2%, med from 2%, high from 10%. Invoice below agreed: one level lower.',
    evaluate: rateMismatch,
  },
];
