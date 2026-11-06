import { getReadyStore } from '@/app/lib/store';
import { handle, json, routeId } from '@/app/lib/http';
import { approveDraft } from '@/app/lib/drafts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** "Mark approved" only records that a person reviewed the text. Nothing is sent. */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = routeId((await ctx.params).id);
  const store = await getReadyStore();
  return json(await approveDraft(store, id, new Date()));
});
