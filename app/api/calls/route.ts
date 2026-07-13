import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { checkApiKey } from "@/lib/apiAuth";

/**
 * POST /api/calls
 *
 * This is the endpoint your Make.com scenario calls after an AI voice call
 * (Bland.ai / Vapi / similar) finishes, to log the call summary against the
 * right contact. Point Make's "HTTP > Make a request" module here with:
 *   URL:    https://your-deployed-app.com/api/calls
 *   Method: POST
 *   Headers: x-api-key: <your CRM_API_KEY>
 *   Body (JSON): see below
 *
 * Expected body — map these from whatever Bland.ai/Vapi returns in Make:
 * {
 *   "contact_id": "uuid"            // required — which CRM contact this call was for
 *                                    //   (pass this along when YOU trigger the call,
 *                                    //    so it comes back on the completion webhook)
 *   "phone_number": "+923001234567",
 *   "call_date": "2026-07-09T10:00:00Z",   // optional, defaults to now
 *   "duration_seconds": 132,
 *   "summary": "Prospect is interested, wants a demo next Tuesday.",
 *   "transcript": "full transcript text...",   // optional
 *   "outcome": "interested",                   // optional: interested / no_answer / callback_requested / not_interested
 *   "captured_email": "owner@practice.com",     // optional — email the AI captured live on the call;
 *                                                //   automatically saved onto the contact record
 *   "recording_url": "https://...",            // optional
 *   "deal_id": "uuid"                          // optional — also update a specific deal's stage
 * }
 *
 * On success, if the related deal is still in "New" stage, it's auto-moved
 * to "Contacted" so the pipeline reflects that an AI call has happened.
 *
 * If outcome is "interested", this also notifies your team by forwarding
 * the call details to MAKE_NOTIFY_WEBHOOK_URL — point that at a Make.com
 * scenario with an Email/Gmail/Slack module to alert whoever owns the deal.
 */
export async function POST(req: NextRequest) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const body = await req.json();
  if (!body.contact_id) {
    return NextResponse.json({ error: "contact_id is required" }, { status: 400 });
  }

  const db = supabaseAdmin();

  const { data: call, error } = await db
    .from("calls")
    .insert({
      contact_id: body.contact_id,
      deal_id: body.deal_id ?? null,
      phone_number: body.phone_number ?? null,
      call_date: body.call_date ?? new Date().toISOString(),
      duration_seconds: body.duration_seconds ?? null,
      summary: body.summary ?? null,
      transcript: body.transcript ?? null,
      outcome: body.outcome ?? null,
      recording_url: body.recording_url ?? null,
      raw_payload: body,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Track how many AI call attempts have been made against this contact, and
  // flag it once 3 straight no-answers pile up so automated dialers can skip it.
  const { data: contactForAttempts } = await db
    .from("contacts")
    .select("call_attempts")
    .eq("id", body.contact_id)
    .single();

  const nextAttempts = (contactForAttempts?.call_attempts ?? 0) + 1;
  const contactUpdate: Record<string, any> = { call_attempts: nextAttempts };
  if (nextAttempts >= 3 && body.outcome === "no_answer") {
    contactUpdate.max_attempts_reached = true;
  }
  if (body.captured_email) {
    contactUpdate.email = body.captured_email;
  }
  await db.from("contacts").update(contactUpdate).eq("id", body.contact_id);

  // Auto-advance the deal from "New" -> "Contacted" once an AI call is logged.
  await db
    .from("deals")
    .update({ stage: "Contacted" })
    .eq("contact_id", body.contact_id)
    .eq("stage", "New");

  // Notify the team when the AI call flags the lead as "interested".
  if (body.outcome === "interested" && process.env.MAKE_NOTIFY_WEBHOOK_URL) {
    const { data: contact } = await db
      .from("contacts")
      .select("first_name, last_name, email, phone, owner")
      .eq("id", body.contact_id)
      .single();

    // Fire-and-forget: don't block/fail the response if the notify webhook is slow or down.
    fetch(process.env.MAKE_NOTIFY_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contact_name: contact ? `${contact.first_name} ${contact.last_name || ""}`.trim() : null,
        owner: contact?.owner ?? null,
        phone_number: body.phone_number,
        summary: body.summary,
        outcome: body.outcome,
        call_date: call.call_date,
      }),
    }).catch(() => {});
  }

  return NextResponse.json(call, { status: 201 });
}

// GET /api/calls?contact_id=... -> list call logs for a contact
export async function GET(req: NextRequest) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const contactId = req.nextUrl.searchParams.get("contact_id");
  const db = supabaseAdmin();
  let query = db.from("calls").select("*").order("call_date", { ascending: false });
  if (contactId) query = query.eq("contact_id", contactId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
