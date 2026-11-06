'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { CsvImportSummary, EmailApplySummary, EmailImportSummary, RefreshSummary, SampleSummary } from '../lib/pipeline';

type Result =
  | { kind: 'csv'; data: CsvImportSummary }
  | { kind: 'email-applied'; data: EmailApplySummary }
  | { kind: 'sample'; data: SampleSummary }
  | { kind: 'reset'; text: string }
  | { kind: 'error'; text: string };

const CSV_COLUMNS =
  'reference, customer, carrier, pickup_start, pickup_end, delivery_start, delivery_end, free_time_minutes, agreed_rate, currency, pickup_arrived_at, picked_up_at, pickup_departed_at, delivery_arrived_at, delivery_departed_at, delivered_at, eta, last_status_at, last_status_note, pod_received_at, invoice_amount, invoice_received_at';

async function post<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { method: 'POST', ...init });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const msg = typeof data === 'object' && data !== null && 'error' in data ? String((data as { error: unknown }).error) : `Request failed (${res.status}).`;
    throw new Error(msg);
  }
  return data as T;
}

function RefreshNote({ r }: { r: RefreshSummary }) {
  return (
    <>
      <p>
        Rules ran on {r.shipmentsEvaluated} shipment{r.shipmentsEvaluated === 1 ? '' : 's'}: <strong>{r.casesDetected}</strong> exception
        {r.casesDetected === 1 ? '' : 's'} now, <strong>{r.newCases}</strong> new.
      </p>
      {r.reopened.length > 0 && (
        <div>
          <p>
            {r.reopened.length} case{r.reopened.length === 1 ? ' was' : 's were'} <strong>re-opened: the exception is back</strong> (new data had cleared
            {r.reopened.length === 1 ? ' it' : ' them'}, but the rules detect {r.reopened.length === 1 ? 'it' : 'them'} again):
          </p>
          <ul>
            {r.reopened.map((c) => (
              <li key={c.id}>{c.title}</li>
            ))}
          </ul>
        </div>
      )}
      {r.autoResolved.length > 0 && (
        <div>
          <p>
            {r.autoResolved.length} earlier case{r.autoResolved.length === 1 ? ' was' : 's were'} marked <strong>resolved</strong> because the new data
            means the condition no longer holds:
          </p>
          <ul>
            {r.autoResolved.map((c) => (
              <li key={c.id}>{c.title}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <details>
      <summary>What was applied or skipped ({notes.length})</summary>
      <ul>
        {notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </details>
  );
}

function RejectedTable({ rejected }: { rejected: EmailImportSummary['rejected'] }) {
  if (rejected.length === 0) return null;
  return (
    <div className="table-scroll">
      <table className="data">
        <caption className="visually-hidden">Rejected values</caption>
        <thead>
          <tr>
            <th scope="col">Rejected field</th>
            <th scope="col">Proposed</th>
            <th scope="col">Why</th>
          </tr>
        </thead>
        <tbody>
          {rejected.map((r, i) => (
            <tr key={i}>
              <td className="mono">{r.field}</td>
              <td className="mono">{typeof r.proposed === 'string' ? r.proposed : JSON.stringify(r.proposed)}</td>
              <td>{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultView({ result }: { result: Result }) {
  if (result.kind === 'error') return <p className="notice error">{result.text}</p>;
  if (result.kind === 'reset') return <p className="notice ok">{result.text}</p>;
  if (result.kind === 'sample') {
    return (
      <div className="notice ok">
        <p>Sample data is loaded: {result.data.shipmentsLoaded} synthetic shipments (fake names and data).</p>
        <RefreshNote r={result.data.refresh} />
        <Link href="/">See the exceptions</Link>
      </div>
    );
  }
  if (result.kind === 'csv') {
    const d = result.data;
    const tone = d.noDataRows || d.issues.length ? 'warn' : 'ok';
    return (
      <div className={`notice ${tone}`}>
        {d.noDataRows ? (
          <p>
            <strong>{d.sourceName}</strong>: <strong>no data rows found.</strong> Nothing was imported. The file may have only a header row, be empty,
            or every row was rejected{d.issues.length ? ' (see below)' : ''}.
          </p>
        ) : (
          <p>
            <strong>{d.sourceName}</strong>: {d.rowsParsed} shipment{d.rowsParsed === 1 ? '' : 's'} read ({d.added} new, {d.updated} merged into existing).
            {d.issues.length > 0 ? ` ${d.issues.length} issue${d.issues.length === 1 ? '' : 's'} to look at.` : ' No parse issues.'}
          </p>
        )}
        {d.issues.length > 0 && (
          <details open={d.issues.length <= 8}>
            <summary>Parse issues ({d.issues.length})</summary>
            <ul>
              {d.issues.slice(0, 200).map((i, n) => (
                <li key={n}>
                  {i.row !== undefined ? <span className="mono">Row {i.row}: </span> : null}
                  {i.message}
                </li>
              ))}
            </ul>
            {d.issues.length > 200 && <p className="small muted">Showing the first 200.</p>}
          </details>
        )}
        <RefreshNote r={d.refresh} />
        <Link href="/">See the exceptions</Link>
      </div>
    );
  }
  const d = result.data;
  return (
    <div className={`notice ${d.stored ? 'ok' : 'warn'}`}>
      <p>
        <strong>{d.stored ? 'Applied.' : 'Not applied.'}</strong> {d.message}
      </p>
      <RejectedTable rejected={d.rejected} />
      <Notes notes={d.notes} />
      {d.refresh && <RefreshNote r={d.refresh} />}
    </div>
  );
}

function EmailPreview({
  preview,
  selected,
  setSelected,
  confirm,
  setConfirm,
  onApply,
  busy,
}: {
  preview: EmailImportSummary;
  selected: Set<number>;
  setSelected: (s: Set<number>) => void;
  confirm: boolean;
  setConfirm: (b: boolean) => void;
  onApply: () => void;
  busy: boolean;
}) {
  const uid = useId();
  const canApply = selected.size > 0 && (!preview.confirmationRequired || confirm) && !preview.unmatched;
  return (
    <div className={`notice ${preview.needsReview ? 'warn' : 'info'}`} aria-label="Email extraction preview" role="group">
      <p>
        <strong>Preview.</strong> {preview.message}
      </p>
      {preview.injectionSuspected && (
        <p>
          <strong>Warning: this email contains instruction-like text</strong> (for example &ldquo;ignore previous instructions&rdquo;). Values extracted
          from it may have been steered. Compare every value with the original before applying.
        </p>
      )}
      {preview.needsReview && !preview.injectionSuspected && (
        <p>
          <strong>Needs a person&rsquo;s review:</strong> something was rejected, or the reference is missing. Check the table against the original email.
        </p>
      )}
      {preview.accepted.length > 0 && (
        <fieldset style={{ border: 0, padding: 0, margin: '8px 0' }}>
          <legend className="small muted">Values that passed the text check. Tick the ones you want to apply.</legend>
          {preview.accepted.map((a, i) => {
            const id = `${uid}-i${i}`;
            return (
              <div key={i} className="check item">
                <input
                  id={id}
                  type="checkbox"
                  checked={selected.has(i)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(i);
                    else next.delete(i);
                    setSelected(next);
                  }}
                />
                <label htmlFor={id}>
                  <span className="mono">{a.field}</span> = <span className="mono">{String(a.value)}</span>
                  <br />
                  <span className="small muted">Quote in the email: &ldquo;{a.quote}&rdquo;</span>
                </label>
              </div>
            );
          })}
        </fieldset>
      )}
      {preview.accepted.length === 0 && <p>No value passed the text check.</p>}
      <RejectedTable rejected={preview.rejected} />
      <Notes notes={preview.notes} />
      {preview.confirmationRequired && preview.accepted.length > 0 && (
        <div className="check">
          <input id={`${uid}-confirm`} type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          <label htmlFor={`${uid}-confirm`}>I compared the ticked values with the original email and want to apply them despite the warning above.</label>
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <button className="btn primary" type="button" disabled={!canApply || busy} onClick={onApply}>
          Apply selected ({selected.size})
        </button>
      </div>
      <p className="hint" style={{ marginTop: 6 }}>
        Applying re-checks each value against the email text on the server, attaches it to the matching shipment, and re-runs the rules.
      </p>
    </div>
  );
}

export function ImportPanel({ demoMode, modelConfigured, shipmentCount }: { demoMode: boolean; modelConfigured: boolean; shipmentCount: number }) {
  const router = useRouter();
  const uid = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [email, setEmail] = useState('');
  const [preview, setPreview] = useState<{ data: EmailImportSummary; raw: string } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmEmail, setConfirmEmail] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  async function run(label: string, fn: () => Promise<Result>) {
    setBusy(label);
    setResult(null);
    try {
      setResult(await fn());
      router.refresh();
    } catch (e) {
      setResult({ kind: 'error', text: e instanceof Error ? e.message : 'The request failed.' });
    } finally {
      setBusy(null);
    }
  }

  async function runPreview() {
    setBusy('extracting from the email');
    setResult(null);
    setPreview(null);
    try {
      const raw = email;
      const data = await post<EmailImportSummary>('/api/import/email', { headers: { 'Content-Type': 'text/plain' }, body: raw });
      setPreview({ data, raw });
      setSelected(new Set(data.confirmationRequired ? [] : data.accepted.map((_, i) => i)));
      setConfirmEmail(false);
    } catch (e) {
      setResult({ kind: 'error', text: e instanceof Error ? e.message : 'The request failed.' });
    } finally {
      setBusy(null);
    }
  }

  async function runApply() {
    if (!preview) return;
    const items = preview.data.accepted.filter((_, i) => selected.has(i)).map((a) => ({ field: a.field, value: a.value, quote: a.quote }));
    setBusy('applying the selected values');
    setResult(null);
    try {
      const data = await post<EmailApplySummary>('/api/import/email/apply', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: preview.raw, items, confirmReview: confirmEmail }),
      });
      setResult({ kind: 'email-applied', data });
      if (data.stored) setPreview(null);
      router.refresh();
    } catch (e) {
      setResult({ kind: 'error', text: e instanceof Error ? e.message : 'The request failed.' });
    } finally {
      setBusy(null);
    }
  }

  const uploadsOff = demoMode;
  const emailOff = demoMode || !modelConfigured;

  return (
    <div>
      <div role="status" aria-live="polite" aria-atomic="false">
        {busy && (
          <p className="muted">
            <span className="spinner" aria-hidden="true" />
            Working: {busy}
          </p>
        )}
        {result && <ResultView result={result} />}
      </div>

      <section className="card" aria-labelledby="h-sample">
        <h2 id="h-sample">Load sample data</h2>
        <p className="muted">
          Synthetic shipments with fake names, with times set relative to now so the demo always shows live exceptions.{' '}
          {shipmentCount > 0
            ? 'Loading it again updates the same sample shipments (no duplicates) and re-runs the rules. The result below says which cases were newly resolved or re-opened.'
            : ''}
        </p>
        <button
          className="btn primary"
          type="button"
          disabled={busy !== null}
          onClick={() => run('loading sample data', async () => ({ kind: 'sample', data: await post<SampleSummary>('/api/sample', {}) }))}
        >
          Load sample data
        </button>
      </section>

      <section className="card" aria-labelledby="h-csv">
        <h2 id="h-csv">Upload a CSV</h2>
        {uploadsOff && <p className="notice info">Disabled in demo mode. Run your own copy to import your data.</p>}
        <p className="muted">
          One row per shipment, up to 2 MB. Empty cell means unknown. Times without an offset are read as UTC and flagged. Use only data you are
          allowed to use; it stays in this app&rsquo;s database.
        </p>
        <details style={{ marginBottom: 12 }}>
          <summary>Expected columns</summary>
          <p className="small mono">{CSV_COLUMNS}</p>
        </details>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!file) return;
            void run(`reading ${file.name}`, async () => {
              if (file.size > 2 * 1024 * 1024) throw new Error('That file is larger than the 2 MB limit.');
              const text = await file.text();
              const data = await post<CsvImportSummary>(`/api/import/csv?name=${encodeURIComponent(file.name)}`, {
                headers: { 'Content-Type': 'text/csv' },
                body: text,
              });
              return { kind: 'csv', data };
            });
          }}
        >
          <label htmlFor={`${uid}-csv`}>CSV file</label>
          <input id={`${uid}-csv`} type="file" accept=".csv,text/csv" disabled={uploadsOff || busy !== null} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <div style={{ marginTop: 12 }}>
            <button className="btn primary" type="submit" disabled={uploadsOff || busy !== null || !file}>
              Import CSV
            </button>
          </div>
        </form>
      </section>

      <section className="card" aria-labelledby="h-email">
        <h2 id="h-email">Paste an email</h2>
        {demoMode ? (
          <p className="notice info">Disabled in demo mode.</p>
        ) : !modelConfigured ? (
          <p className="notice info">
            Needs a model, and none is configured (set <code>LLM_PROVIDER</code>, <code>LLM_API_KEY</code>, <code>LLM_MODEL</code>). CSV import works without one.
          </p>
        ) : null}
        <p className="muted">
          Two steps. First a model proposes values and each is checked against the email text; <strong>nothing is stored</strong>. Then you tick the values
          that are right and apply them. They attach to a shipment you already imported (matched by reference); an email never creates a shipment.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!email.trim()) return;
            void runPreview();
          }}
        >
          <label htmlFor={`${uid}-email`}>Email text</label>
          <textarea
            id={`${uid}-email`}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setPreview(null);
            }}
            disabled={emailOff || busy !== null}
            maxLength={2_000_000}
            placeholder="Paste the email here"
          />
          <div style={{ marginTop: 12 }}>
            <button className="btn primary" type="submit" disabled={emailOff || busy !== null || !email.trim()}>
              Extract (nothing is stored)
            </button>
          </div>
        </form>
        {preview && (
          <div style={{ marginTop: 16 }}>
            <EmailPreview
              preview={preview.data}
              selected={selected}
              setSelected={setSelected}
              confirm={confirmEmail}
              setConfirm={setConfirmEmail}
              onApply={() => void runApply()}
              busy={busy !== null}
            />
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="h-reset">
        <h2 id="h-reset">Reset</h2>
        <p className="muted">
          {demoMode
            ? 'Restore the demo to a fresh copy of the synthetic sample data.'
            : 'Delete every stored shipment, case and draft from this app’s database. This cannot be undone.'}
        </p>
        <div className="check">
          <input id={`${uid}-rconfirm`} type="checkbox" checked={confirmReset} onChange={(e) => setConfirmReset(e.target.checked)} />
          <label htmlFor={`${uid}-rconfirm`}>{demoMode ? 'Yes, reset the demo' : 'I understand this deletes all stored data'}</label>
        </div>
        <div style={{ marginTop: 12 }}>
          <button
            className="btn danger"
            type="button"
            disabled={busy !== null || !confirmReset}
            onClick={() =>
              run('resetting', async () => {
                await post('/api/reset', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
                setConfirmReset(false);
                return { kind: 'reset', text: demoMode ? 'Demo reset to the sample data.' : 'All stored data was deleted.' };
              })
            }
          >
            {demoMode ? 'Reset demo' : 'Delete all data'}
          </button>
        </div>
      </section>
    </div>
  );
}
