// Environment parsing with no heavy imports, so the proxy can use it too.
export interface AppConfig {
  databasePath: string;
  demoMode: boolean;
  appPassword: string | null;
  /** Extra hostnames (or host:port) accepted when running unprotected on a local machine. */
  allowedHosts: string[];
}

type Env = Record<string, string | undefined>;

const FALSE_WORDS = ['false', '0', 'no', 'off'];

/**
 * DEMO_MODE fails closed: any non-empty value other than an explicit false is treated as ON,
 * so a typo can never enable uploads and the model on a public demo.
 */
export function parseDemoMode(v: string | undefined): boolean {
  if (v === undefined) return false;
  const t = v.trim().toLowerCase();
  if (t === '') return false;
  return !FALSE_WORDS.includes(t);
}

export function readConfig(env: Env = process.env): AppConfig {
  const pw = env.APP_PASSWORD;
  return {
    databasePath: env.DATABASE_PATH && env.DATABASE_PATH.trim() ? env.DATABASE_PATH.trim() : './data/freight.sqlite',
    demoMode: parseDemoMode(env.DEMO_MODE),
    appPassword: pw && pw.length > 0 ? pw : null,
    allowedHosts: (env.ALLOWED_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h !== ''),
  };
}

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

/** Split a Host header value into hostname and optional port. Handles "[::1]:3000". */
export function splitHost(host: string): { hostname: string; port: string | null } {
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    if (end === -1) return { hostname: h, port: null };
    const rest = h.slice(end + 1);
    return { hostname: h.slice(0, end + 1), port: rest.startsWith(':') ? rest.slice(1) : null };
  }
  const i = h.lastIndexOf(':');
  return i === -1 ? { hostname: h, port: null } : { hostname: h.slice(0, i), port: h.slice(i + 1) };
}

/** Is this Host header value one this unprotected local server should answer to? */
export function isHostAllowed(host: string | null | undefined, cfg: AppConfig): boolean {
  if (!host) return false;
  const { hostname } = splitHost(host);
  if (LOCAL_HOSTNAMES.includes(hostname)) return true;
  const full = host.trim().toLowerCase();
  return cfg.allowedHosts.some((a) => a === full || a === hostname);
}

/** The host check applies only to an unprotected, non-demo server (the case DNS rebinding targets). */
export function hostCheckApplies(cfg: AppConfig): boolean {
  return cfg.appPassword === null && !cfg.demoMode;
}
