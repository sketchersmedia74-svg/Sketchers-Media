import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { checkApiKey } from "@/lib/apiAuth";

// GET /api/notes?contact_id=... -> list notes for a contact
export async function GET(req: NextRequest) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const contactId = req.nextUrl.searchParams.get("contact_id");
  if (!contactId) return NextResponse.json({ error: "contact_id is required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("notes")
    .select("*")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST /api/notes -> add a note to a contact's timeline (x-api-key protected, for Make.com).
// Body: { contact_id, text, created_by? }
export async function POST(req: NextRequest) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const body = await req.json();
  if (!body.contact_id) return NextResponse.json({ error: "contact_id is required" }, { status: 400 });
  if (!body.text || !body.text.trim()) return NextResponse.json({ error: "text is required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("notes")
    .insert({
      contact_id: body.contact_id,
      text: body.text.trim(),
      created_by: body.created_by || "API",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
