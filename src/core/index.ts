// Public API of the rules engine. Pure functions only: no I/O, no clock, no network.
export * from './types';
export { evaluateShipments } from './engine';
export { RULES, type RuleDefinition } from './rules';
export { resolveConfig } from './config';
export { parseInstant } from './time';
