import type { CaseStatus, Severity } from '@/core/types';

const SEV_LABEL: Record<Severity, string> = { high: 'High', med: 'Medium', low: 'Low' };
const STATUS_LABEL: Record<CaseStatus, string> = { open: 'Open', drafted: 'Drafted', resolved: 'Resolved', dismissed: 'Dismissed' };

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`badge sev-${severity}`}>
      <span className="visually-hidden">Severity: </span>
      {SEV_LABEL[severity] ?? severity}
    </span>
  );
}

export function StatusBadge({ status }: { status: CaseStatus }) {
  return (
    <span className={`badge st-${status}`}>
      <span className="visually-hidden">Status: </span>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
