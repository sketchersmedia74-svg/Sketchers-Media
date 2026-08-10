import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { checkApiKey } from "@/lib/apiAuth";

/**
 * GET /api/contacts/pending-first-call
 *
 * Returns contacts that have never been called yet (call_attempts = 0),
 * regardless of how they were created — scraper, CSV import, or the manual
 * "Add Contact" form all land here the same way, since none of those paths
 * trigger a call on their own. Point a Make.com Schedule + HTTP module at
 * this to pick up new leads and feed them into the same AI-calling flow the
 * scraper scenario already uses (e.g. POST /api/trigger-call per contact,
 * or straight to Vapi).
 *
 * Excludes do_not_call contacts and any without a phone number (nothing to
 * call). Once a call is logged via POST /api/calls, call_attempts becomes 1
 * and the contact drops out of this list — from then on,
 * /api/contacts/due-for-retry is what picks it back up if needed.
 *
 * Query param: ?limit=15 (optional) — caps how many contacts come back per
 * call, so a scheduled scenario can work through a backlog gradually
 * instead of triggering every pending contact in one run.
 *
 * Headers: x-api-key: <CRM_API_KEY>
 */
export async function GET(req: NextRequest) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : null;

  const db = supabaseAdmin();
  let query = db
    .from("contacts")
    .select("*")
    .eq("call_attempts", 0)
    .eq("do_not_call", false)
    .not("phone", "is", null)
    .order("created_at", { ascending: true });

  if (limit && Number.isFinite(limit) && limit > 0) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
