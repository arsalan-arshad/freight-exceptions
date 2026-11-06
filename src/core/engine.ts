import { resolveConfig } from './config';
import { RULES } from './rules';
import type { ExceptionCase, RuleConfig, Severity, Shipment } from './types';

const SEVERITY_RANK: Record<Severity, number> = { high: 0, med: 1, low: 2 };

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Run every rule over every shipment.
 * - Deterministic: same input (in any order) => identical output.
 * - Sorted by severity (high first), then case id (plain code-unit order, no locale).
 * - Never throws: a shipment or rule that misbehaves is skipped; an invalid `now` yields [].
 * - `config` is merged over DEFAULT_RULE_CONFIG; invalid values fall back to the defaults.
 */
export function evaluateShipments(
  shipments: Shipment[],
  now: Date,
  config?: Partial<RuleConfig>,
): ExceptionCase[] {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return [];
  if (!Array.isArray(shipments)) return [];
  const cfg = resolveConfig(config);
  const all: ExceptionCase[] = [];
  for (const shipment of shipments) {
    if (!shipment || typeof shipment !== 'object' || typeof shipment.id !== 'string') continue;
    for (const rule of RULES) {
      try {
        all.push(...rule.evaluate(shipment, now, cfg));
      } catch {
        // A rule must never take the whole evaluation down; skip it for this shipment.
      }
    }
  }
  const keyed = all.map((c) => ({ c, json: JSON.stringify(c) }));
  keyed.sort(
    (a, b) =>
      SEVERITY_RANK[a.c.severity] - SEVERITY_RANK[b.c.severity] ||
      cmpStr(a.c.id, b.c.id) ||
      cmpStr(a.json, b.json),
  );
  const seen = new Set<string>();
  const out: ExceptionCase[] = [];
  for (const { c } of keyed) {
    if (seen.has(c.id)) continue; // duplicate shipment ids: keep one case per id
    seen.add(c.id);
    out.push(c);
  }
  return out;
}
