import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';
import { readConfig } from './lib/config';
import { NavLinks } from './components/NavLinks';

export const metadata: Metadata = {
  title: { default: 'Freight exceptions', template: '%s — Freight exceptions' },
  description: 'Deterministic rules find shipment exceptions. AI only extracts and drafts. A person approves. Nothing is sent.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
};

export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  const demo = readConfig().demoMode;
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          {demo && (
            <div className="banner-demo" role="status">
              <div className="wrap">
                <strong>Demo mode.</strong> Sample data only: the shipments, carriers and emails are synthetic. Uploads, pasted emails and
                any AI model are turned off.
              </div>
            </div>
          )}
          <div className="wrap site-header-row">
            <Link className="brand" href="/">
              freight<span>-</span>exceptions
            </Link>
            <NavLinks />
          </div>
          <div className="strip">
            <div className="wrap">Nothing is ever sent from here. Rule thresholds are placeholders until brokers confirm them.</div>
          </div>
        </header>
        <main id="main" className="wrap" tabIndex={-1}>
          {children}
        </main>
        <footer className="site-footer">
          <div className="wrap">
            Open source (MIT). Early hypothesis-stage tool: not validated with brokers yet. <Link href="/about">How it works</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
