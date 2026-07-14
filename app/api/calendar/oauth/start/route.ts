import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { getAuthUrl } from "@/lib/googleCalendar";

// GET /api/calendar/oauth/start -> redirects an admin to Google's consent
// screen to connect the shared company calendar. Admin-only (session cookie).
export async function GET() {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: "Forbidden: admin access required" }, { status: 403 });

  return NextResponse.redirect(getAuthUrl());
}
