import { DEFAULT_RULE_CONFIG, type RuleConfig } from './types';

/**
 * Merge a partial config over the defaults. A value that is not a number, is NaN or is negative is
 * ignored (the default is used). Infinity is allowed and effectively disables a threshold.
 */
export function resolveConfig(partial?: Partial<RuleConfig> | null): RuleConfig {
  const out: RuleConfig = { ...DEFAULT_RULE_CONFIG };
  if (!partial || typeof partial !== 'object') return out;
  for (const key of Object.keys(DEFAULT_RULE_CONFIG) as (keyof RuleConfig)[]) {
    const v = partial[key];
    if (typeof v === 'number' && !Number.isNaN(v) && v >= 0) out[key] = v;
  }
  return out;
}
