'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { DraftView } from '../lib/drafts';

type Busy = null | 'generate' | 'save' | 'approve';

class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function call(url: string, method: string, body?: unknown): Promise<DraftView> {
  const res = await fetch(url, {
    method,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json()) as DraftView & { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? 'The request failed.', res.status);
  return data;
}

export function DraftPanel({ caseId, initial }: { caseId: string; initial: DraftView | null }) {
  const router = useRouter();
  const base = `/api/cases/${encodeURIComponent(caseId)}`;
  const [view, setView] = useState<DraftView | null>(initial);
  const [subject, setSubject] = useState(initial?.draft.subject ?? '');
  const [text, setText] = useState(initial?.draft.body ?? '');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const dirty = view !== null && (subject !== view.draft.subject || text !== view.draft.body);
  const violations = view?.violations ?? [];
  const stale = view?.stale === true && !dirty;
  const approved = view?.draft.approved === true && !dirty && !stale;
  const copyBlocked = dirty || stale || violations.length > 0;

  function adopt(v: DraftView) {
    setView(v);
    setSubject(v.draft.subject);
    setText(v.draft.body);
  }

  async function run(kind: Exclude<Busy, null>, fn: () => Promise<DraftView>) {
    setBusy(kind);
    setError(null);
    setCopied(false);
    try {
      adopt(await fn());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request failed.');
      if (e instanceof ApiError && e.status === 409) {
        // Another tab or a re-run changed things: show what the server has now instead of stale text.
        try {
          const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}`);
          const cur = (await res.json()) as { draft?: DraftView | null };
          if (res.ok && cur.draft) adopt(cur.draft);
        } catch {
          /* keep the error message above */
        }
      }
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    const payload = `Subject: ${subject}\n\n${text}`;
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
    } catch {
      // Clipboard API unavailable (non-secure context): select the text so the person can copy by hand.
      bodyRef.current?.focus();
      bodyRef.current?.select();
      setError('Your browser blocked clipboard access. The text is selected: press Ctrl+C (or Cmd+C).');
    }
  }

  if (!view) {
    return (
      <div>
        <button className="btn primary" type="button" disabled={busy !== null} aria-busy={busy === 'generate'} onClick={() => run('generate', () => call(`${base}/draft`, 'POST'))}>
          {busy === 'generate' && <span className="spinner" aria-hidden="true" />}
          {busy === 'generate' ? 'Generating' : 'Generate draft'}
        </button>
        <p className="small muted" style={{ marginTop: 8 }}>
          Uses the model if one is configured, otherwise a fixed template. Either way the text may only contain the facts above.
        </p>
        <div role="alert">{error && <p className="notice error">{error}</p>}</div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row">
        <span className="badge neutral">{view.draft.origin === 'llm' ? 'Written by a model' : 'Template'}</span>
        {approved ? <span className="badge st-resolved">Approved (not sent)</span> : <span className="badge st-drafted">Not approved</span>}
        {dirty && <span className="badge neutral">Unsaved edits</span>}
      </div>

      {view.fallbackReasons.length > 0 && (
        <div className="notice warn" role="status">
          <p>
            <strong>The model draft was not used.</strong> It failed the facts check, so the template was used instead:
          </p>
          <ul>
            {view.fallbackReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <label htmlFor="draft-subject">Subject</label>
        <input id="draft-subject" type="text" value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div>
        <label htmlFor="draft-body">Message</label>
        <textarea id="draft-body" ref={bodyRef} value={text} maxLength={20000} onChange={(e) => setText(e.target.value)} aria-describedby="draft-help" />
        <p id="draft-help" className="small muted">
          Edit freely. After &ldquo;Save and check&rdquo; every number, time and reference is checked against the case facts.
        </p>
      </div>

      <div role="alert">
        {stale && (
          <div className="notice warn">
            <p>
              <strong>This draft is out of date.</strong> The case facts changed after it was written (time has passed, or new data arrived), so the
              times and amounts in it may no longer be right. Use <strong>Regenerate</strong> to write a fresh one, then review it.
            </p>
          </div>
        )}
        {violations.length > 0 && !dirty && !stale && (
          <div className="notice error">
            <p>
              <strong>This text contains values that are not in the case facts</strong>, so it cannot be approved. Remove or correct them, then
              save again:
            </p>
            <ul>
              {violations.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="notice error">{error}</p>}
      </div>
      {violations.length === 0 && !dirty && !stale && !error && (
        <p className="small" role="status" style={{ color: 'var(--ok)' }}>
          Facts check passed: every number, time and reference comes from the case facts.
        </p>
      )}

      <div className="row">
        <button
          className="btn"
          type="button"
          disabled={busy !== null || !dirty}
          onClick={() => run('save', () => call(`${base}/draft`, 'PUT', { subject, body: text }))}
        >
          {busy === 'save' ? 'Checking' : 'Save and check'}
        </button>
        <button className="btn" type="button" onClick={copy} disabled={copyBlocked} aria-describedby={copyBlocked ? 'copy-hint' : undefined}>
          {copied ? 'Copied' : 'Copy to clipboard'}
        </button>
        <button
          className="btn primary"
          type="button"
          disabled={busy !== null || dirty || stale || violations.length > 0 || approved}
          onClick={() => run('approve', () => call(`${base}/approve`, 'POST'))}
        >
          {busy === 'approve' ? 'Saving' : approved ? 'Approved' : 'Mark approved'}
        </button>
        <button
          className="btn"
          type="button"
          disabled={busy !== null}
          onClick={() => {
            if (!dirty || window.confirm('Replace your unsaved edits with a freshly generated draft?')) {
              void run('generate', () => call(`${base}/draft`, 'POST'));
            }
          }}
        >
          {busy === 'generate' ? 'Generating' : 'Regenerate'}
        </button>
      </div>
      {copyBlocked && (
        <p id="copy-hint" className="hint">
          {dirty
            ? 'Copy is off until you save and check your edits, so you never copy text that has not been checked.'
            : stale
              ? 'Copy is off because this draft is out of date. Regenerate it first.'
              : 'Copy is off while the text contains values that are not in the case facts. Fix them and save again.'}
        </p>
      )}
      <p className="small muted">Approving does not send anything. Copy the text and send it yourself.</p>
      <div aria-live="polite" className="visually-hidden">
        {copied ? 'Copied to clipboard' : ''}
      </div>
    </div>
  );
}
