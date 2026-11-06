'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function LoadSampleButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/sample', { method: 'POST' });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Could not load the sample data.');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the sample data.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn primary" type="button" onClick={run} disabled={busy} aria-busy={busy}>
        {busy && <span className="spinner" aria-hidden="true" />}
        {busy ? 'Loading sample data' : 'Load sample data'}
      </button>
      <div role="alert">{error && <p className="notice error">{error}</p>}</div>
    </div>
  );
}
