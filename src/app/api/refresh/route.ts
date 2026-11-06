import { getReadyStore } from '@/app/lib/store';
import { handle, json } from '@/app/lib/http';
import { refreshCases } from '@/app/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Re-run the rules over stored shipments with the current time. */
export const POST = handle(async (_req: Request) => {
  const store = await getReadyStore();
  return json({ kind: 'refresh', refresh: await refreshCases(store, new Date()) });
});
