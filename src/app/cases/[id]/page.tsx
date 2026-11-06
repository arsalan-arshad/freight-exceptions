import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getReadyStore } from '@/app/lib/store';
import { routeId } from '@/app/lib/http';
import { viewDraft } from '@/app/lib/drafts';
import { toRow } from '@/app/lib/views';
import { ruleLabel, splitFacts } from '@/app/lib/labels';
import { SeverityBadge, StatusBadge } from '@/app/components/Badges';
import { EvidenceList } from '@/app/components/Evidence';
import { CaseActions } from '@/app/components/CaseActions';
import { DraftPanel } from '@/app/components/DraftPanel';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const id = routeId((await params).id);
  const store = await getReadyStore();
  const c = await store.getCase(id);
  if (!c) return { title: 'Case not found' };
  const s = await store.getShipment(c.shipmentId);
  return { title: `${toRow(c, s ?? undefined).reference} · ${c.title}` };
}

export default async function CaseDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = routeId((await params).id);
  const store = await getReadyStore();
  const found = await store.getCase(id);
  if (!found) notFound();
  const shipment = await store.getShipment(found.shipmentId);
  const c = toRow(found, shipment ?? undefined);
  const draft = await viewDraft(store, found);
  const { main: mainFacts, raw: rawFacts } = splitFacts(c.facts);

  return (
    <>
      <p className="crumbs">
        <Link href="/">&larr; All exceptions</Link>
      </p>
      <div className="row between" style={{ marginBottom: 4 }}>
        <h1 className="wrap-any" style={{ marginBottom: 0, minWidth: 0 }}>{c.title}</h1>
        <span className="row">
          <SeverityBadge severity={c.severity} />
          <StatusBadge status={c.status} />
        </span>
      </div>
      <p className="muted wrap-any">
        <span className="mono">{c.reference}</span>
        {c.carrier ? <> · {c.carrier}</> : null}
        {c.customer ? <> · {c.customer}</> : null} · {ruleLabel(c.ruleId)} (<span className="mono">{c.ruleId}</span>)
      </p>

      {c.status === 'resolved' && (
        <p className="notice ok">
          Resolved. This is either a person's decision or the rules no longer find this exception in the stored data (the condition cleared).
        </p>
      )}

      <section className="card" aria-labelledby="h-why">
        <h2 id="h-why">Why this was flagged</h2>
        <p>{c.summary}</p>
        <p>
          <strong>Suggested next step:</strong> {c.suggestedNextStep}
        </p>
        <p className="small muted">Detected by a fixed rule, not by a model. Thresholds are placeholders.</p>
      </section>

      <section className="card" aria-labelledby="h-facts">
        <h2 id="h-facts">Facts</h2>
        <p className="small muted">A drafted message may only contain these values.</p>
        <dl className="facts">
          {mainFacts.map((f) => (
            <div key={f.key} style={{ display: 'contents' }}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
        {rawFacts.length > 0 && (
          <details>
            <summary>Raw numbers ({rawFacts.length})</summary>
            <dl className="facts">
              {rawFacts.map((f) => (
                <div key={f.key} style={{ display: 'contents' }}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </section>

      <section className="card" aria-labelledby="h-ev">
        <h2 id="h-ev">Evidence</h2>
        <EvidenceList items={c.evidence} />
      </section>

      <section className="card" aria-labelledby="h-draft">
        <h2 id="h-draft">Follow-up draft</h2>
        <p className="muted small">
          Nothing is sent from this tool. Review the text, copy it, and send it yourself from your own email. &ldquo;Mark approved&rdquo; only
          records that you reviewed it.
        </p>
        <DraftPanel caseId={c.id} initial={draft} />
      </section>

      <section className="card" aria-labelledby="h-act">
        <h2 id="h-act">Case status</h2>
        <CaseActions caseId={c.id} status={c.status} />
      </section>
    </>
  );
}
