import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * A name-only roster for attributing deals/notes to a specific person when
 * several team members share one CRM login (a real login account per person
 * isn't practical there). Separate from /api/team-members, which manages
 * actual Supabase Auth login accounts.
 */

async function requireSession() {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

// GET /api/team-names -> list all names. Any signed-in team member.
export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const db = supabaseAdmin();
  const { data, error } = await db.from("team_names").select("*").order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST /api/team-names -> add a name. Body: { name }. Any signed-in team member.
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { name } = await req.json();
  if (!name || !name.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data, error } = await db.from("team_names").insert({ name: name.trim() }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

// DELETE /api/team-names?id=... -> remove a name. Any signed-in team member.
export async function DELETE(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const db = supabaseAdmin();
  const { error } = await db.from("team_names").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
