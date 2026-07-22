import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase";

// Same session+role check used by /api/team-members — cookie-based Supabase
// session (refreshed on every request by middleware.ts), then a profiles.role
// lookup via the service-role client. Use for any admin-only route handler.
export type AdminSessionResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "no_session" | "no_profile" | "profile_lookup_failed" | "not_admin" };

export async function checkAdminSession(): Promise<AdminSessionResult> {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, reason: "no_session" };

  const db = supabaseAdmin();
  const { data, error } = await db.from("profiles").select("role").eq("id", session.user.id).single();

  if (error) {
    // Distinguish "row genuinely doesn't exist" from "the lookup itself
    // failed" (e.g. SUPABASE_SERVICE_ROLE_KEY missing/wrong on this
    // deployment) — both would otherwise silently collapse into the same
    // generic 403, which is exactly what makes this class of bug hard to
    // diagnose on a live environment.
    console.error("checkAdminSession: profiles lookup failed:", error.message);
    return { ok: false, reason: error.code === "PGRST116" ? "no_profile" : "profile_lookup_failed" };
  }
  if (data?.role !== "admin") return { ok: false, reason: "not_admin" };

  return { ok: true, userId: session.user.id };
}

// Back-compat convenience wrapper for call sites that only need a yes/no.
export async function requireAdminSession(): Promise<{ userId: string } | null> {
  const result = await checkAdminSession();
  return result.ok ? { userId: result.userId } : null;
}
