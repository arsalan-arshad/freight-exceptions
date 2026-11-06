import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <div className="empty">
      <h1>Page not found</h1>
      <Link className="btn" href="/">
        Back to exceptions
      </Link>
    </div>
  );
}
