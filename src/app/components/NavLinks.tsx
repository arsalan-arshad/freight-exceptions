'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Cases' },
  { href: '/import', label: 'Import' },
  { href: '/about', label: 'How it works' },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map((l) => {
        const active = l.href === '/' ? path === '/' || path.startsWith('/cases') : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} {...(active ? { 'aria-current': 'page' as const } : {})}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
