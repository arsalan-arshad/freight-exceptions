import { readConfig } from './config';
import { HttpError } from './http';

/** Refuse a feature that DEMO_MODE turns off. */
export function requireNotDemo(what: string): void {
  if (readConfig().demoMode) throw new HttpError(403, `${what} is disabled in demo mode (sample data only).`);
}
