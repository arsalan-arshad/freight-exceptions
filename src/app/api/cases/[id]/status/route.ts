import { getReadyStore } from '@/app/lib/store';
import { HttpError, handle, json, readJsonBody, routeId } from '@/app/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = ['open', 'resolved', 'dismissed'] as const;

/** Resolve, dismiss or reopen a case. Reopening returns it to "drafted" when a draft exists, else "open". */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = routeId((await ctx.params).id);
  const body = await readJsonBody(req, 4096);
  const status = body.status;
  if (typeof status !== 'string' || !(ALLOWED as readonly string[]).includes(status)) {
    throw new HttpError(400, `"status" must be one of: ${ALLOWED.join(', ')}.`);
  }
  const store = await getReadyStore();
  if (!(await store.getCase(id))) throw new HttpError(404, 'Case not found.');
  const next = status === 'open' ? ((await store.getDraft(id)) ? 'drafted' : 'open') : (status as 'resolved' | 'dismissed');
  await store.setCaseStatus(id, next, 'person');
  return json({ id, status: next });
});
