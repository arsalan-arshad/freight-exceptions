import type { Metadata } from 'next';
import { getReadyStore } from '@/app/lib/store';
import { getLlm, readConfig } from '@/app/lib/config';
import { ImportPanel } from '@/app/components/ImportPanel';

export const metadata: Metadata = { title: 'Import' };
export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const store = await getReadyStore();
  const shipments = await store.listShipments();
  const demo = readConfig().demoMode;
  return (
    <>
      <h1>Import</h1>
      <p className="muted">
        Bring in shipments, then the rules run and the exception list updates. Everything stays in this app&rsquo;s local database. Nothing is
        sent anywhere.
      </p>
      <ImportPanel demoMode={demo} modelConfigured={getLlm() !== null} shipmentCount={shipments.length} />
    </>
  );
}
