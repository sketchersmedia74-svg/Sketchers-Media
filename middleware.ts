import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// The public booking page is served on its own domain (book.resetdentalmedia.com),
// separate from the CRM login (crm.resetdentalmedia.com and the default
// *.vercel.app domain) — visitors landing on the booking domain's root should
// go straight to /book instead of seeing the internal login screen.
const BOOKING_HOST = "book.resetdentalmedia.com";

// Refreshes the Supabase auth cookie on every request so it never goes stale
// server-side, even though the browser's own client auto-refreshes its
// in-memory/localStorage session independently. Without this, API routes
// using createRouteHandlerClient (e.g. /api/team-members, /api/internal/*)
// will start reporting "Not signed in" once the cookie's access token expires,
// even though the user still looks logged in client-side.
export async function middleware(req: NextRequest) {
  const host = (req.headers.get("host") || "").split(":")[0];
  if (host === BOOKING_HOST && req.nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL("/book", req.url));
  }

  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });
  await supabase.auth.getSession();
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
