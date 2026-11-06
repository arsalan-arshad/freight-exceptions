import type { Metadata } from 'next';
import Link from 'next/link';
import { getReadyStore } from '@/app/lib/store';
import { listCaseRows, parseStatusFilter } from '@/app/lib/views';
import { RULE_IDS, STATUS_FILTER_LABELS, ruleLabel } from '@/app/lib/labels';
import { SeverityBadge, StatusBadge } from '@/app/components/Badges';
import { EvidenceList } from '@/app/components/Evidence';
import { RefreshButton } from '@/app/components/RefreshButton';
import { LoadSampleButton } from '@/app/components/LoadSampleButton';
import { readConfig } from '@/app/lib/config';

export const metadata: Metadata = { title: 'Exceptions' };
export const dynamic = 'force-dynamic';

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ status?: string; rule?: string }> }) {
  const sp = await searchParams;
  const status = parseStatusFilter(sp.status);
  const rule = RULE_IDS.includes(sp.rule as never) ? sp.rule : undefined;
  const store = await getReadyStore();
  const [rows, shipments, everything] = await Promise.all([
    listCaseRows(store, { status, ...(rule ? { ruleId: rule } : {}) }),
    store.listShipments(),
    store.listCases(),
  ]);
  const filtered = status !== 'active' || rule !== undefined;

  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1>Exceptions</h1>
        <RefreshButton />
      </div>
      <p className="muted">
        Found by fixed rules over the shipments you imported, sorted by severity. {shipments.length} shipment
        {shipments.length === 1 ? '' : 's'} stored. Thresholds are placeholders. Nothing is sent to anyone.
      </p>

      <form className="filters" method="get" action="/" aria-label="Filter cases">
        <div>
          <label htmlFor="f-status">Status</label>
          <select id="f-status" name="status" defaultValue={status}>
            {Object.entries(STATUS_FILTER_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-rule">Rule</label>
          <select id="f-rule" name="rule" defaultValue={rule ?? ''}>
            <option value="">All rules</option>
            {RULE_IDS.map((r) => (
              <option key={r} value={r}>
                {ruleLabel(r)} ({r})
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <button className="btn" type="submit">
            Apply filters
          </button>
          {filtered && (
            <Link className="btn" href="/">
              Clear
            </Link>
          )}
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="empty">
          {shipments.length === 0 ? (
            <>
              <h2>No data yet</h2>
              <p className="muted">Load the synthetic sample data to see how it works{readConfig().demoMode ? '.' : ', or import a CSV of your own shipments.'}</p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <LoadSampleButton />
                {!readConfig().demoMode && (
                  <Link className="btn" href="/import">
                    Go to import
                  </Link>
                )}
              </div>
            </>
          ) : filtered ? (
            <>
              <h2>No cases match these filters</h2>
              <p className="muted">{everything.length} case{everything.length === 1 ? '' : 's'} exist in total.</p>
              <Link className="btn" href="/">
                Clear filters
              </Link>
            </>
          ) : (
            <>
              <h2>No open exceptions</h2>
              <p className="muted">
                The rules found nothing to chase in {shipments.length} shipment{shipments.length === 1 ? '' : 's'}. That is only as good as the
                data imported and the placeholder thresholds.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <p className="small muted" aria-live="polite">
            Showing {rows.length} case{rows.length === 1 ? '' : 's'}.
          </p>
          <ul className="cases">
            {rows.map((c) => (
              <li key={c.id} className={`case sev-${c.severity}`}>
                <div className="row between">
                  <Link className="case-title wrap-any" href={`/cases/${encodeURIComponent(c.id)}`}>
                    {c.title}
                  </Link>
                  <span className="row">
                    <SeverityBadge severity={c.severity} />
                    <StatusBadge status={c.status} />
                  </span>
                </div>
                <div className="case-meta wrap-any">
                  <span className="mono">{c.reference}</span>
                  {c.carrier ? <> · {c.carrier}</> : null}
                  {c.customer ? <> · {c.customer}</> : null} · {ruleLabel(c.ruleId)}
                </div>
                <p className="wrap-any" style={{ margin: '6px 0 0' }}>{c.summary}</p>
                <details>
                  <summary>Evidence ({c.evidence.length})</summary>
                  <EvidenceList items={c.evidence} />
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
