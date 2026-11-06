import { getStore } from '@/app/lib/store';
import { readConfig } from '@/app/lib/config';
import { HttpError, handle, json, readJsonBody } from '@/app/lib/http';
import { loadSample } from '@/app/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Delete all stored data. Requires {"confirm": true}.
 * In demo mode the store is reset to the synthetic sample data instead of being left empty.
 */
export const POST = handle(async (req: Request) => {
  const body = await readJsonBody(req, 1024);
  if (body.confirm !== true) throw new HttpError(400, 'Send {"confirm": true} to reset.');
  const store = getStore();
  await store.clearAll();
  if (readConfig().demoMode) {
    const sample = await loadSample(store, new Date());
    return json({ kind: 'reset', demoMode: true, sample });
  }
  return json({ kind: 'reset', demoMode: false });
});
