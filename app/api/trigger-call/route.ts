import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { checkApiKey } from "@/lib/apiAuth";

/**
 * POST /api/trigger-call
 * Body: { contact_id: "uuid" }
 *
 * This is the OTHER direction: called from the CRM dashboard (e.g. a
 * "Call now" button on a contact) to kick off an AI call. It looks up the
 * contact's phone number and forwards it to a Make.com webhook, which then
 * runs your scenario to actually place the Bland.ai/Vapi call.
 *
 * Set MAKE_OUTBOUND_WEBHOOK_URL in your env to the Make.com "Custom Webhook"
 * trigger URL for that scenario.
 */
export async function POST(req: NextRequest) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const { contact_id } = await req.json();
  if (!contact_id) return NextResponse.json({ error: "contact_id is required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: contact, error } = await db
    .from("contacts")
    .select("*")
    .eq("id", contact_id)
    .single();

  if (error || !contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  if (!contact.phone) return NextResponse.json({ error: "Contact has no phone number" }, { status: 400 });

  const webhookUrl = process.env.MAKE_OUTBOUND_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json(
      { error: "MAKE_OUTBOUND_WEBHOOK_URL is not configured on the server" },
      { status: 500 }
    );
  }

  const makeRes = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contact_id: contact.id,
      first_name: contact.first_name,
      last_name: contact.last_name,
      phone_number: contact.phone,
      email: contact.email,
    }),
  });

  if (!makeRes.ok) {
    return NextResponse.json({ error: "Make.com webhook call failed" }, { status: 502 });
  }

  return NextResponse.json({ success: true, message: `Call triggered for ${contact.first_name}` });
}
