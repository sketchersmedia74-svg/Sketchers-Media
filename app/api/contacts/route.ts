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
// Rejects with 409 if a contact with the same phone already exists (same
// duplicate-phone check the manual "Add Contact" form and CSV import already
// apply — this endpoint was the one gap, since Make.com/API callers had no
// such guard at all).
export async function POST(req: NextRequest) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const body = await req.json();
  if (!body.first_name) {
    return NextResponse.json({ error: "first_name is required" }, { status: 400 });
  }

  const db = supabaseAdmin();

  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (phone) {
    const { data: existing } = await db
      .from("contacts")
      .select("id, first_name, last_name, phone")
      .eq("phone", phone)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: "A contact with this phone number already exists.", existing_contact: existing },
        { status: 409 }
      );
    }
  }

  const { data, error } = await db
    .from("contacts")
    .insert({ ...body, source: body.source || "manual" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
