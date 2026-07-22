import { NextResponse } from "next/server";
import { checkAdminSession } from "@/lib/adminAuth";
import { getAuthUrl } from "@/lib/googleCalendar";

// GET /api/calendar/oauth/start -> redirects an admin to Google's consent
// screen to connect the shared company calendar. Admin-only (session cookie).
export async function GET() {
  const admin = await checkAdminSession();
  if (admin.ok === false) {
    console.error(`GET /api/calendar/oauth/start: denied (${admin.reason})`);
    const status = admin.reason === "no_session" ? 401 : 403;
    return NextResponse.json(
      { error: admin.reason === "no_session" ? "Not signed in" : "Forbidden: admin access required" },
      { status }
    );
  }

  return NextResponse.redirect(getAuthUrl());
}
