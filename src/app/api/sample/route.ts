import { getReadyStore } from '@/app/lib/store';
import { handle, json } from '@/app/lib/http';
import { loadSample } from '@/app/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Load the synthetic sample shipments (fake names, times relative to now) and run the rules. */
export const POST = handle(async (_req: Request) => {
  const store = await getReadyStore();
  return json(await loadSample(store, new Date()));
});
