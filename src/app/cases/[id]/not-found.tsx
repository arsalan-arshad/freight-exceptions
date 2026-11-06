import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Case not found' };

export default function NotFound() {
  return (
    <div className="empty">
      <h1>Case not found</h1>
      <p className="muted">It may have been removed by a reset. Cases are re-created when the rules run again.</p>
      <Link className="btn" href="/">
        Back to exceptions
      </Link>
    </div>
  );
}
