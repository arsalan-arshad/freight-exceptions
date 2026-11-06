import { openSqliteStore } from '@/db';
import type { Store } from '@/db';
import { readConfig } from './config';

const KEY = Symbol.for('freight-exceptions.store');
type G = typeof globalThis & { [KEY]?: Store };

/** One store per server process (survives Next hot reloads in dev). */
export function getStore(): Store {
  const g = globalThis as G;
  let s = g[KEY];
  if (!s) {
    s = openSqliteStore(readConfig().databasePath);
    g[KEY] = s;
  }
  return s;
}

import { loadSample } from './pipeline';

const SEEDED = Symbol.for('freight-exceptions.seeded');

/** The store, plus a one-time sample load when DEMO_MODE=true and the database is empty. */
export async function getReadyStore(): Promise<Store> {
  const store = getStore();
  if (readConfig().demoMode) {
    const g = globalThis as typeof globalThis & { [SEEDED]?: Promise<unknown> };
    g[SEEDED] ??= (async () => {
      if ((await store.listShipments()).length === 0) await loadSample(store, new Date());
    })().catch((e) => {
      g[SEEDED] = undefined;
      throw e;
    });
    await g[SEEDED];
  }
  return store;
}
