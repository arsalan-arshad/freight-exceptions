import { getReadyStore } from '@/app/lib/store';
import { HttpError, handle, json, readTextBody } from '@/app/lib/http';
import { requireNotDemo } from '@/app/lib/guard';
import { importCsv } from '@/app/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Body: the CSV text (Content-Type text/csv or text/plain). Optional ?name=shipments.csv for source references. */
export const POST = handle(async (req: Request) => {
  requireNotDemo('CSV upload');
  const text = await readTextBody(req);
  if (text.trim() === '') throw new HttpError(400, 'The CSV is empty.');
  const rawName = new URL(req.url).searchParams.get('name') ?? 'upload.csv';
  const name = rawName.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 80) || 'upload.csv';
  const store = await getReadyStore();
  return json(await importCsv(store, text, new Date(), name));
});
