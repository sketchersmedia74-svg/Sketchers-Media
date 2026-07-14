import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Team member management for the CRM dashboard. Auth here is the logged-in
 * team member's Supabase session (cookie-based), same pattern as
 * /api/internal/trigger-call — not the x-api-key used by Make.com.
 */

async function requireSession() {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

async function requireAdmin(userId: string) {
  const db = supabaseAdmin();
  const { data } = await db.from("profiles").select("role").eq("id", userId).single();
  return data?.role === "admin";
}

function generateTempPassword() {
  return randomBytes(9).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
}

// GET /api/team-members -> list Supabase Auth users (id, email only). Admins only.
export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!(await requireAdmin(session.user.id))) {
    return NextResponse.json({ error: "Forbidden: admin access required" }, { status: 403 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db.auth.admin.listUsers();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rawUsers = data.users as unknown as { id: string; email: string | null }[];
  const users: { id: string; email: string }[] = rawUsers
    .filter((u): u is { id: string; email: string } => !!u.email)
    .map((u) => ({ id: u.id, email: u.email }));

  // Self-heal: backfill a profiles row for any auth user that's missing one
  // (e.g. from a past failed insert, or a user created outside this route).
  const { data: existingProfiles } = await db.from("profiles").select("id, full_name");
  const nameById = new Map<string, string | null>(
    (existingProfiles ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name])
  );
  const missing = users.filter((u) => !nameById.has(u.id));
  if (missing.length) {
    await db.from("profiles").insert(
      missing.map((u) => ({ id: u.id, email: u.email ?? "", role: "member" }))
    );
  }

  const members = users.map((u) => ({ id: u.id, email: u.email, full_name: nameById.get(u.id) || null }));
  return NextResponse.json(members);
}

// POST /api/team-members -> add a new team member by email. Admins only.
// Body: { email, full_name? }
// Sends a Supabase invite email if email sending is configured; otherwise
// creates the user directly and returns a one-time temporary password.
// Always creates a matching profiles row (role defaults to 'member').
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!(await requireAdmin(session.user.id))) {
    return NextResponse.json({ error: "Forbidden: admin access required" }, { status: 403 });
  }

  const { email, full_name } = await req.json();
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

  const db = supabaseAdmin();

  const { data: inviteData, error: inviteError } = await db.auth.admin.inviteUserByEmail(email);
  if (!inviteError && inviteData.user) {
    const { error: profileError } = await db
      .from("profiles")
      .upsert({ id: inviteData.user.id, email: inviteData.user.email ?? email, full_name: full_name || null, role: "member" });
    if (profileError) {
      console.error(`Failed to create profiles row for ${email} (${inviteData.user.id}):`, profileError.message);
    }
    return NextResponse.json(
      {
        id: inviteData.user.id,
        email: inviteData.user.email,
        invited: true,
        profile_warning: profileError ? profileError.message : undefined,
      },
      { status: 201 }
    );
  }

  // Invite email failed (e.g. no SMTP/email provider configured) — fall back
  // to creating the account directly with a temporary password.
  const temporaryPassword = generateTempPassword();
  const { data: createData, error: createError } = await db.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
  });

  if (createError) return NextResponse.json({ error: createError.message }, { status: 500 });

  const { error: profileError } = await db
    .from("profiles")
    .upsert({ id: createData.user.id, email: createData.user.email ?? email, full_name: full_name || null, role: "member" });
  if (profileError) {
    console.error(`Failed to create profiles row for ${email} (${createData.user.id}):`, profileError.message);
  }

  return NextResponse.json(
    {
      id: createData.user.id,
      email: createData.user.email,
      invited: false,
      temporary_password: temporaryPassword,
      profile_warning: profileError ? profileError.message : undefined,
    },
    { status: 201 }
  );
}
