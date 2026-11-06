import { getReadyStore } from '@/app/lib/store';
import { handle, json } from '@/app/lib/http';
import { listCaseRows, parseStatusFilter } from '@/app/lib/views';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const status = parseStatusFilter(url.searchParams.get('status') ?? undefined);
  const rule = url.searchParams.get('rule');
  const store = await getReadyStore();
  const cases = await listCaseRows(store, { status, ...(rule ? { ruleId: rule.slice(0, 40) } : {}) });
  return json({ count: cases.length, status, cases });
});
