import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { completeOAuth } from "@/lib/googleCalendar";

// GET /api/calendar/oauth/callback -> Google redirects here after consent.
// Exchanges the code for tokens and stores the refresh token server-side.
export async function GET(req: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: "Forbidden: admin access required" }, { status: 403 });

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
