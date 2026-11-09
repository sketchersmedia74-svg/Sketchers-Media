// telnyx-webhook: turns Telnyx call events into rows in public.call_logs.
// Deploy with --no-verify-jwt (Telnyx has no Supabase login). Security comes from
// verifying Telnyx's Ed25519 signature on every request.
// Secrets: TELNYX_PUBLIC_KEY, TELNYX_CALLER_NUMBER.
import { createClient } from "npm:@supabase/supabase-js@2";
import nacl from "npm:tweetnacl@1.0.3";

const MAX_AGE_SECONDS = 300;

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const digits = (s?: string | null) => (s || "").replace(/\D/g, "");
const last10 = (s?: string | null) => digits(s).slice(-10);

function publicKeyBytes(): Uint8Array {
  const raw = b64((Deno.env.get("TELNYX_PUBLIC_KEY") || "").trim());
  // Accept a raw 32-byte key, or a 44-byte SPKI/DER key (12-byte header + 32-byte key).
  return raw.length === 44 ? raw.slice(12) : raw;
}

function verifySignature(rawBody: string, sigB64: string | null, timestamp: string | null): boolean {
  if (!sigB64 || !timestamp) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > MAX_AGE_SECONDS) return false;
  try {
    const message = new TextEncoder().encode(`${timestamp}|${rawBody}`);
    return nacl.sign.detached.verify(message, b64(sigB64), publicKeyBytes());
  } catch (_) {
    return false;
  }
}

function decodeClientState(v?: string | null): string | null {
  if (!v) return null;
  try { return atob(v); } catch (_) { return null; }
}

const isUuid = (s: string | null) =>
  !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const rawBody = await req.text();
  const ok = verifySignature(
    rawBody,
    req.headers.get("telnyx-signature-ed25519"),
    req.headers.get("telnyx-timestamp"),
  );
  if (!ok) return new Response("Invalid signature", { status: 401 });

  // Signature is valid: from here on always answer 200 so Telnyx does not retry forever.
  try {
    const event = JSON.parse(rawBody);
    await handleEvent(event);
  } catch (e) {
    console.error("telnyx-webhook: handler error", e);
  }
  return new Response("ok", { status: 200 });
});

async function handleEvent(event: any) {
  const type: string = event?.data?.event_type;
  const p = event?.data?.payload || {};
  if (!type || !type.startsWith("call.")) return;

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const sessionId: string | null = p.call_session_id ?? null;
  const callerNumber = Deno.env.get("TELNYX_CALLER_NUMBER") || "";
  const legDirection = String(p.direction || "").toLowerCase(); // 'incoming' | 'outgoing' (per Telnyx docs)

  // Temporary diagnostics for the Stage 5 live test (no secrets, no full bodies).
  console.log("telnyx event", JSON.stringify({
    type, legDirection, from: p.from, to: p.to, session: sessionId,
    has_client_state: !!p.client_state, custom_headers: p.custom_headers ?? null,
  }));

  // ---- Find the call_logs row this event belongs to --------------------------
  let row: any = null;

  // 1) Already linked by Telnyx session id.
  if (sessionId) {
    const { data } = await db.from("call_logs").select("*").eq("call_session_id", sessionId).limit(1);
    row = data?.[0] ?? null;
  }

  // 2) Our own call_logs.id, if Telnyx echoed it back (client_state or X-CRM-Call-Id header).
  if (!row) {
    let id = decodeClientState(p.client_state);
    if (!isUuid(id)) {
      const h = (p.custom_headers || []).find?.((x: any) => String(x?.name).toLowerCase().replace(/^x-/, "") === "crm-call-id");
      id = h?.value ?? null;
    }
    if (isUuid(id)) {
      const { data } = await db.from("call_logs").select("*").eq("id", id).limit(1);
      row = data?.[0] ?? null;
    }
  }

  const toIsOurNumber = !!callerNumber && digits(p.to) === digits(callerNumber);

  // 3) Outbound fallback: newest unlinked 'dialing' row for the same destination, last 3 minutes.
  if (!row && !toIsOurNumber && type === "call.initiated") {
    const since = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const { data } = await db
      .from("call_logs")
      .select("*")
      .eq("direction", "outbound")
      .is("call_session_id", null)
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(10);
    row = (data || []).find((r: any) => last10(r.to_number) === last10(p.to)) ?? null;
  }

  // 4) Inbound call to our number with no row yet: create one and try to match the lead.
  if (!row && toIsOurNumber && type === "call.initiated" && sessionId) {
    // phone is E.164 in this CRM; compare on last 10 digits.
    const fromLast10 = last10(p.from);
    let contactId: string | null = null;
    if (fromLast10) {
      const { data: m } = await db.from("contacts").select("id, phone").like("phone", `%${fromLast10}`).limit(1);
      contactId = m?.[0]?.id ?? null;
    }
    const { error } = await db
      .from("call_logs")
      .insert({
        contact_id: contactId,
        user_id: null,
        direction: "inbound",
        from_number: p.from,
        to_number: p.to,
        status: "ringing",
        call_session_id: sessionId,
        call_control_id: p.call_control_id ?? null,
      });
    if (error) console.error("telnyx-webhook: inbound insert failed", error.message);
    return; // row created with ringing status; nothing more for this event
  }

  if (!row) return; // event we can't tie to any call: ignore

  // ---- Apply the event --------------------------------------------------------
  const patch: Record<string, unknown> = {};
  if (sessionId && !row.call_session_id) patch.call_session_id = sessionId;
  if (p.call_control_id && !row.call_control_id) patch.call_control_id = p.call_control_id;

  if (type === "call.initiated") {
    if (row.status === "dialing") patch.status = "ringing";
  } else if (type === "call.answered") {
    // A browser call has two legs: the browser leg answers instantly, the phone leg answers
    // when the dentist picks up. For outbound calls only the phone ('outgoing') leg counts.
    const isRealAnswer = row.direction === "inbound" ? true : legDirection !== "incoming";
    if (isRealAnswer && !row.answered_at) {
      patch.answered_at = p.start_time || event.data.occurred_at || new Date().toISOString();
      patch.status = "answered";
    }
  } else if (type === "call.hangup") {
    if (!row.ended_at) {
      const endedAt: string = p.end_time || event.data.occurred_at || new Date().toISOString();
      patch.ended_at = endedAt;
      patch.status = "ended";
      patch.hangup_cause = p.hangup_cause ?? row.hangup_cause ?? null;
      const answeredAt = (patch.answered_at as string) || row.answered_at;
      patch.duration_seconds = answeredAt
        ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(answeredAt)) / 1000))
        : 0;
    }
  }

  if (Object.keys(patch).length) {
    const { error } = await db.from("call_logs").update(patch).eq("id", row.id);
    if (error) console.error("telnyx-webhook: update failed", error.message);
  }

  // First (and only first) hangup bumps the lead's counters.
  if (type === "call.hangup" && !row.ended_at && row.contact_id) {
    const { error } = await db.rpc("bump_contact_call_stats", {
      p_contact_id: row.contact_id,
      p_called_at: (patch.ended_at as string) ?? new Date().toISOString(),
    });
    if (error) console.error("telnyx-webhook: bump stats failed", error.message);
  }
}
