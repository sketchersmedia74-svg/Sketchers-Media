import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { checkApiKey } from "@/lib/apiAuth";

// GET /api/deals -> all deals, joined with contact + latest call summary
export async function GET(req: NextRequest) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("deals")
    .select(
      "*, contacts(id, first_name, last_name, phone, email, calls(summary, call_date, outcome)), companies(name)"
    )
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST /api/deals -> create a deal
// Body: { title, contact_id, company_id?, value?, stage?, owner? }
export async function POST(req: NextRequest) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const body = await req.json();
  if (!body.title || !body.contact_id) {
    return NextResponse.json({ error: "title and contact_id are required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db.from("deals").insert(body).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
