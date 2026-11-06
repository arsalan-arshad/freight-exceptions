import type { Evidence } from '@/core/types';

export function EvidenceList({ items }: { items: Evidence[] }) {
  if (items.length === 0) return <p className="muted small">No evidence recorded.</p>;
  return (
    <ul className="evidence">
      {items.map((e, i) => (
        <li key={`${e.ref}-${i}`}>
          <span className="src">
            {e.source} / {e.ref}
          </span>
          <br />
          {e.excerpt}
        </li>
      ))}
    </ul>
  );
}
