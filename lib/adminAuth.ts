import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase";

// Same session+role check used by /api/team-members — cookie-based Supabase
// session, then a profiles.role lookup. Use for any admin-only route handler.
export async function requireAdminSession(): Promise<{ userId: string } | null> {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  const db = supabaseAdmin();
  const { data } = await db.from("profiles").select("role").eq("id", session.user.id).single();
  if (data?.role !== "admin") return null;

  return { userId: session.user.id };
}
