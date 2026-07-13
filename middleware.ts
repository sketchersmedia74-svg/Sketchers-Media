import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Refreshes the Supabase auth cookie on every request so it never goes stale
// server-side, even though the browser's own client auto-refreshes its
// in-memory/localStorage session independently. Without this, API routes
// using createRouteHandlerClient (e.g. /api/team-members, /api/internal/*)
// will start reporting "Not signed in" once the cookie's access token expires,
// even though the user still looks logged in client-side.
export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });
  await supabase.auth.getSession();
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
