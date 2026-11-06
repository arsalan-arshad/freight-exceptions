import { getReadyStore } from '@/app/lib/store';
import { getLlm } from '@/app/lib/config';
import { HttpError, handle, json, readTextBody } from '@/app/lib/http';
import { requireNotDemo } from '@/app/lib/guard';
import { importEmail } from '@/app/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Step 1 (preview). Body: one raw email. Needs a configured model.
 * Returns what the model proposed and the checks' verdict. STORES NOTHING: apply with /api/import/email/apply.
 */
export const POST = handle(async (req: Request) => {
  requireNotDemo('Email paste');
  const raw = await readTextBody(req);
  if (raw.trim() === '') throw new HttpError(400, 'The email is empty.');
  const store = await getReadyStore();
  return json(await importEmail(store, raw, getLlm(), new Date()));
});
