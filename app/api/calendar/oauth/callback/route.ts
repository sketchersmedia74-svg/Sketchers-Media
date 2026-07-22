import { NextRequest, NextResponse } from "next/server";
import { checkAdminSession } from "@/lib/adminAuth";
import { completeOAuth } from "@/lib/googleCalendar";

// GET /api/calendar/oauth/callback -> Google redirects here after consent.
// Exchanges the code for tokens and stores the refresh token server-side.
export async function GET(req: NextRequest) {
  const admin = await checkAdminSession();
  if (admin.ok === false) {
    console.error(`GET /api/calendar/oauth/callback: denied (${admin.reason})`);
    const status = admin.reason === "no_session" ? 401 : 403;
    return NextResponse.json(
      { error: admin.reason === "no_session" ? "Not signed in" : "Forbidden: admin access required" },
      { status }
    );
  }

  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/settings/calendar?error=missing_code", req.url));
  }

  try {
    await completeOAuth(code);
  } catch (err: any) {
    return NextResponse.redirect(
      new URL(`/settings/calendar?error=${encodeURIComponent(err.message || "oauth_failed")}`, req.url)
    );
  }

  return NextResponse.redirect(new URL("/settings/calendar?connected=1", req.url));
}
