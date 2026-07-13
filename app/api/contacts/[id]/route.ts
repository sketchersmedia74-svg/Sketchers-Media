import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { checkApiKey } from "@/lib/apiAuth";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("contacts")
    .select("*, companies(name), calls(*)")
    .eq("id", params.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const body = await req.json();
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("contacts")
    .update(body)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const db = supabaseAdmin();
  const { error } = await db.from("contacts").delete().eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
