import type { Metadata } from 'next';
import { llmLabel, readConfig } from '@/app/lib/config';

export const metadata: Metadata = { title: 'How it works' };
export const dynamic = 'force-dynamic';

export default function About() {
  const cfg = readConfig();
  return (
    <>
      <h1>How it works</h1>
      <p className="notice warn">
        <strong>Early and unvalidated.</strong> This is a hypothesis-stage open-source tool (MIT). The rule thresholds are placeholders until real
        brokers say what matters. Treat the output as a prompt to look, not as a verdict.
      </p>

      <section className="card">
        <h2>Who decides what</h2>
        <ol>
          <li>
            <strong>Fixed rules decide the exceptions.</strong> Late pickup, late delivery, missing proof of delivery, no status update, detention and
            rate mismatch are computed from your shipment data with plain arithmetic. Same data in, same exceptions out. If an input is missing, the
            rule does not fire; it never guesses.
          </li>
          <li>
            <strong>A model may only do two narrow jobs, and only if you configure one.</strong> It can propose values from a pasted email into a fixed
            list of fields, and each value is kept only if its supporting quote appears verbatim in the email. It can also word a follow-up message.
          </li>
          <li>
            <strong>Drafts may only contain facts from the case.</strong> Every number, time and reference in a draft is checked against the case facts.
            A draft that fails is replaced by a fixed template, and you are told why. You can edit the text; edits are checked again, and text with
            unknown values cannot be marked approved.
          </li>
          <li>
            <strong>Nothing is ever sent.</strong> There is no send button, no email connection and no webhook. &ldquo;Mark approved&rdquo; records that you
            reviewed the text. You copy it and send it yourself.
          </li>
        </ol>
      </section>

      <section className="card">
        <h2>Data</h2>
        <ul>
          <li>Shipments, cases and drafts live in a local SQLite database on the machine running this app.</li>
          <li>Input is a CSV you upload or an email you paste. Access is read-only: the tool never logs in to your mailbox.</li>
          <li>When you re-import or re-run the rules, an open case whose condition has cleared is marked resolved, and the page tells you so.</li>
          <li>Only import data you are allowed to use. The demo uses synthetic data with fake names.</li>
        </ul>
      </section>

      <section className="card">
        <h2>This instance</h2>
        <dl className="facts">
          <dt>Mode</dt>
          <dd>{cfg.demoMode ? 'Demo (sample data only)' : 'Normal'}</dd>
          <dt>Model</dt>
          <dd>{llmLabel()}</dd>
          <dt>Password</dt>
          <dd>{cfg.appPassword ? 'Required' : 'Not set'}</dd>
        </dl>
        <p className="small muted" style={{ marginTop: 12 }}>
          API keys are read from the server environment and are never sent to your browser.
        </p>
      </section>
    </>
  );
}
