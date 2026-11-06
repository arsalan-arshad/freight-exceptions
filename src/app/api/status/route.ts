import { getReadyStore } from '@/app/lib/store';
import { llmLabel, readConfig } from '@/app/lib/config';
import { handle, json } from '@/app/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (_req: Request) => {
  const store = await getReadyStore();
  const cfg = readConfig();
  const [shipments, cases] = await Promise.all([store.listShipments(), store.listCases()]);
  return json({
    demoMode: cfg.demoMode,
    passwordProtected: cfg.appPassword !== null,
    model: llmLabel(),
    shipments: shipments.length,
    cases: cases.length,
    openCases: cases.filter((c) => c.status === 'open' || c.status === 'drafted').length,
    sendsMessages: false,
  });
});
