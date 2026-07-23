import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { checkApiKey } from "@/lib/apiAuth";

/**
 * GET /api/contacts/due-for-retry
 *
 * Returns contacts whose next_retry_at has passed — i.e. their last AI call
 * went to voicemail or wasn't answered, and it's been 1-2 days since (set by
 * POST /api/calls). Point a daily Make.com Schedule + HTTP module at this,
 * then loop the results into whatever redials them (e.g. POST
 * /api/trigger-call per contact, or straight to Vapi).
 *
 * Excludes do_not_call and max_attempts_reached contacts automatically.
 * Headers: x-api-key: <CRM_API_KEY>
 */
export async function GET(req: NextRequest) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("contacts")
    .select("*")
    .lte("next_retry_at", new Date().toISOString())
    .eq("do_not_call", false)
    .eq("max_attempts_reached", false)
    .order("next_retry_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
