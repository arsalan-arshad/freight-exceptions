// Next.js 16 renamed "middleware" to "proxy". It runs before routing and does three things:
// 1. APP_PASSWORD set: every page and API route needs HTTP Basic auth.
// 2. No APP_PASSWORD and not a demo (a local, unprotected server): only answer to localhost-style Host headers or
//    ALLOWED_HOSTS. This blocks DNS-rebinding pages from reading or changing local data through the browser.
// 3. A malformed percent-encoded path (e.g. /cases/%E0%A4%A) gets a clean 400 instead of a bare 500.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAuthorized } from '@/app/lib/auth';
import { hostCheckApplies, isHostAllowed, readConfig } from '@/app/lib/env';

const BASE_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

function text(status: number, body: string, extra: Record<string, string> = {}): NextResponse {
  return new NextResponse(body, { status, headers: { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...extra } });
}

export function proxy(request: NextRequest) {
  const cfg = readConfig();

  if (!isAuthorized(request.headers.get('authorization'), cfg.appPassword)) {
    return text(401, 'Authentication required.', { 'WWW-Authenticate': 'Basic realm="freight-exceptions", charset="UTF-8"' });
  }

  if (hostCheckApplies(cfg)) {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    if (!isHostAllowed(host, cfg)) {
      return text(403, 'This host name is not allowed. Open the app as http://localhost:<port>, or set ALLOWED_HOSTS (or APP_PASSWORD).');
    }
  }

  try {
    decodeURIComponent(request.nextUrl.pathname);
  } catch {
    return text(400, 'Malformed URL.');
  }

  return NextResponse.next();
}

// Run on everything, including API routes and static assets, so nothing is reachable without the password.
export const config = {
  matcher: '/:path*',
};
