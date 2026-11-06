import { getReadyStore } from '@/app/lib/store';
import { getLlm } from '@/app/lib/config';
import { handle, json, readJsonBody, routeId, str } from '@/app/lib/http';
import { editDraft, generateDraft } from '@/app/lib/drafts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Generate a draft (model if configured, else the template; invalid model output falls back to the template). */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = routeId((await ctx.params).id);
  const store = await getReadyStore();
  return json(await generateDraft(store, id, getLlm(), new Date()));
});

/** Save an edit. The text is stored even with violations; approval is cleared. */
export const PUT = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = routeId((await ctx.params).id);
  const body = await readJsonBody(req, 64 * 1024);
  const subject = str(body.subject, 'subject', 300);
  const text = str(body.body, 'body', 20000);
  const store = await getReadyStore();
  return json(await editDraft(store, id, subject, text, new Date()));
});
