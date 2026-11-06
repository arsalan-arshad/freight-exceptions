import { getReadyStore } from '@/app/lib/store';
import { HttpError, handle, json, readJsonBody, str } from '@/app/lib/http';
import { requireNotDemo } from '@/app/lib/guard';
import { applyEmailItems } from '@/app/lib/pipeline';
import type { ProposedItem } from '@/app/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ITEMS = 20;

/**
 * Step 2. Body: {"raw": "<the same email text>", "items": [{field, value, quote}], "confirmReview": boolean}.
 * The items are re-verified against the email text by code before anything is stored. If the checks flag the
 * email, nothing is applied unless "confirmReview" is true (the person ticked the warning).
 */
export const POST = handle(async (req: Request) => {
  requireNotDemo('Email paste');
  const body = await readJsonBody(req, 3 * 1024 * 1024);
  const raw = str(body.raw, 'raw', 2 * 1024 * 1024);
  if (!Array.isArray(body.items)) throw new HttpError(400, '"items" must be an array.');
  if (body.items.length > MAX_ITEMS) throw new HttpError(400, `At most ${MAX_ITEMS} items can be applied at once.`);
  const items: ProposedItem[] = body.items.map((it: unknown, i: number) => {
    if (typeof it !== 'object' || it === null) throw new HttpError(400, `items[${i}] must be an object.`);
    const o = it as Record<string, unknown>;
    const field = str(o.field, `items[${i}].field`, 40);
    const quote = str(o.quote, `items[${i}].quote`, 1000);
    const v = o.value;
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') throw new HttpError(400, `items[${i}].value must be a string, number or boolean.`);
    if (typeof v === 'string' && v.length > 300) throw new HttpError(400, `items[${i}].value is too long.`);
    return { field, value: v, quote };
  });
  const store = await getReadyStore();
  return json(await applyEmailItems(store, raw, items, body.confirmReview === true, new Date()));
});
