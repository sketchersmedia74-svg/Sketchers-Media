import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { checkApiKey } from "@/lib/apiAuth";

// GET /api/contacts  -> list all contacts (with latest call summary)
export async function GET(req: NextRequest) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("contacts")
    .select(
      "*, companies(name), calls(id, summary, call_date, outcome)"
    )
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST /api/contacts -> create a contact
// Body: { first_name, last_name?, email?, phone?, company_id?, owner?, source? }
// source: e.g. "apify_scrape" for Make.com-tagged scraped leads; defaults to "manual".
export async function POST(req: NextRequest) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const body = await req.json();
  if (!body.first_name) {
    return NextResponse.json({ error: "first_name is required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("contacts")
    .insert({ ...body, source: body.source || "manual" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
