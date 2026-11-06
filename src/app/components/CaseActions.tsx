'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CaseStatus } from '@/core/types';

export function CaseActions({ caseId, status }: { caseId: string; status: CaseStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function set(next: 'open' | 'resolved' | 'dismissed') {
    setBusy(next);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Could not update the case.');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the case.');
    } finally {
      setBusy(null);
    }
  }

  const done = status === 'resolved' || status === 'dismissed';
  return (
    <div>
      <div className="row">
        {!done && (
          <>
            <button className="btn" type="button" disabled={busy !== null} onClick={() => set('resolved')}>
              {busy === 'resolved' ? 'Saving' : 'Resolve'}
            </button>
            <button className="btn" type="button" disabled={busy !== null} onClick={() => set('dismissed')}>
              {busy === 'dismissed' ? 'Saving' : 'Dismiss'}
            </button>
          </>
        )}
        {done && (
          <button className="btn" type="button" disabled={busy !== null} onClick={() => set('open')}>
            {busy === 'open' ? 'Saving' : 'Reopen'}
          </button>
        )}
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        Resolve when it is handled. Dismiss when it is not a real problem. Your choice is kept when the rules run again.
      </p>
      <div role="alert">{error && <p className="notice error">{error}</p>}</div>
    </div>
  );
}
