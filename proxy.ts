// Proxy disabled - using client-side auth checks instead
// due to Edge Runtime limitations with Node.js modules

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  // Allow all requests - auth is handled client-side
  return NextResponse.next();
}

export const config = {
  matcher: [],
};
