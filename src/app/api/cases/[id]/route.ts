import { getReadyStore } from '@/app/lib/store';
import { HttpError, handle, json, routeId } from '@/app/lib/http';
import { viewDraft } from '@/app/lib/drafts';
import { toRow } from '@/app/lib/views';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = routeId((await ctx.params).id);
  const store = await getReadyStore();
  const c = await store.getCase(id);
  if (!c) throw new HttpError(404, 'Case not found.');
  const shipment = await store.getShipment(c.shipmentId);
  return json({ case: toRow(c, shipment ?? undefined), draft: await viewDraft(store, c) });
});
