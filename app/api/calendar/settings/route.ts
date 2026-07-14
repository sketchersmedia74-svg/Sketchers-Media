import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabase";

// GET /api/calendar/settings -> connection status + shared availability config.
// Never returns the refresh token itself.
export async function GET() {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: "Forbidden: admin access required" }, { status: 403 });

  const db = supabaseAdmin();
  const { data } = await db.from("calendar_settings").select("*").eq("id", 1).maybeSingle();

  if (!data) {
    return NextResponse.json({ connected: false });
  }

  const { google_refresh_token, ...safe } = data;
  return NextResponse.json({ connected: !!google_refresh_token, ...safe });
}

// PATCH /api/calendar/settings -> update shared availability config.
// Body: { calendar_id?, timezone?, slot_duration_minutes?, buffer_minutes?, working_hours? }
export async function PATCH(req: NextRequest) {
  const admin = await requireAdminSession();
  if (!admin) return NextResponse.json({ error: "Forbidden: admin access required" }, { status: 403 });

  const body = await req.json();
  const allowed = ["calendar_id", "timezone", "slot_duration_minutes", "buffer_minutes", "working_hours"];
  const update: Record<string, any> = { id: 1, updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (body[key] !== undefined) update[key] = body[key];
  }

  const db = supabaseAdmin();
  const { data, error } = await db.from("calendar_settings").upsert(update).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { google_refresh_token, ...safe } = data;
  return NextResponse.json({ connected: !!google_refresh_token, ...safe });
}
