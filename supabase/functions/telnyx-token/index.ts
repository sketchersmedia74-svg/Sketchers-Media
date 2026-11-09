// telnyx-token: gives a signed-in CRM team member a short-lived Telnyx WebRTC login token.
// Deploy WITH JWT verification (default). Secrets: TELNYX_API_KEY, TELNYX_CONNECTION_ID,
// TELNYX_CALLER_NUMBER (optional: ALLOWED_ORIGINS). SUPABASE_URL / SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY are provided automatically by Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const TELNYX = "https://api.telnyx.com/v2";

async function telnyx(path: string, init: RequestInit = {}) {
  const res = await fetch(`${TELNYX}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${Deno.env.get("TELNYX_API_KEY")}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("TELNYX_API_KEY");
  const connectionId = Deno.env.get("TELNYX_CONNECTION_ID");
  const callerNumber = Deno.env.get("TELNYX_CALLER_NUMBER");
  if (!apiKey || !connectionId || !callerNumber) {
    console.error("telnyx-token: missing Telnyx secrets");
    return json(req, { error: "Calling is not configured yet" }, 500);
  }

  // 1. Who is calling? Verify the Supabase session against Supabase Auth.
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json(req, { error: "Not signed in" }, 401);
  const user = userData.user;

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // 2. Must be a CRM team member (has a profiles row), same notion as the rest of the CRM.
  const { data: profile } = await db.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (!profile) return json(req, { error: "Not a team member" }, 403);

  // 3. Find or create this user's Telnyx telephony credential (one per user).
  let { data: cred } = await db
    .from("telnyx_credentials")
    .select("credential_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let justCreated = false;
  if (!cred) {
    const created = await telnyx("/telephony_credentials", {
      method: "POST",
      body: JSON.stringify({
        connection_id: connectionId,
        name: user.email || user.id,
        tag: "crm",
      }),
    });
    if (!created.ok) {
      console.error("telnyx-token: create credential failed", created.status, created.text);
      return json(req, { error: "Could not create phone login" }, 502);
    }
    const data = JSON.parse(created.text)?.data;
    const { error: insErr } = await db.from("telnyx_credentials").insert({
      user_id: user.id,
      credential_id: data.id,
      sip_username: data.sip_username ?? null,
    });
    if (insErr) {
      // Two requests raced: keep the row that won, delete the extra Telnyx credential.
      await telnyx(`/telephony_credentials/${data.id}`, { method: "DELETE" });
      const again = await db
        .from("telnyx_credentials")
        .select("credential_id")
        .eq("user_id", user.id)
        .single();
      cred = again.data;
    } else {
      cred = { credential_id: data.id };
      justCreated = true;
    }
  }

  // Telnyx asks for ~5s before a brand-new credential's first login.
  if (justCreated) await new Promise((r) => setTimeout(r, 5000));

  // 4. Mint a login token (valid ~24h). The response may be plain text or JSON; handle both.
  const tok = await telnyx(`/telephony_credentials/${cred!.credential_id}/token`, { method: "POST" });
  if (!tok.ok) {
    console.error("telnyx-token: token request failed", tok.status, tok.text);
    return json(req, { error: "Could not get phone token" }, 502);
  }
  let token = tok.text.trim();
  try {
    const parsed = JSON.parse(token);
    token = typeof parsed === "string" ? parsed : parsed?.data?.token ?? parsed?.data ?? parsed?.token ?? token;
  } catch (_) { /* plain-text JWT */ }

  // 5. Never return the API key.
  return json(req, { token, callerNumber });
});
