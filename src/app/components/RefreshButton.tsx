'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { RefreshSummary } from '../lib/pipeline';

export function RefreshButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      const data = (await res.json()) as { refresh?: RefreshSummary; error?: string };
      if (!res.ok || !data.refresh) throw new Error(data.error ?? 'Could not re-run the rules.');
      const r = data.refresh;
      const resolved = r.autoResolved.length;
      setMsg({
        kind: 'ok',
        text: `Rules re-run on ${r.shipmentsEvaluated} shipment(s): ${r.casesDetected} exception(s) now, ${r.newCases} new${
          resolved ? `, ${resolved} marked resolved because the condition cleared` : ''
        }.`,
      });
      router.refresh();
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Could not re-run the rules.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ textAlign: 'right' }}>
      <button className="btn" type="button" onClick={run} disabled={busy} aria-busy={busy}>
        {busy && <span className="spinner" aria-hidden="true" />}
        {busy ? 'Re-running rules' : 'Re-run rules now'}
      </button>
      <div role="status" aria-live="polite" className="small" style={{ marginTop: 6, maxWidth: 420 }}>
        {msg && <span className={msg.kind === 'error' ? 'notice error' : 'muted'}>{msg.text}</span>}
      </div>
    </div>
  );
}
