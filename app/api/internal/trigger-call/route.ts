import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Same job as /api/trigger-call, but for the dashboard's "Call now" button.
 * Auth here is the logged-in team member's Supabase session (cookie-based),
 * not the x-api-key used by Make.com/Bland.ai. Keeps the external API key
 * out of the browser bundle entirely.
 */
export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { contact_id } = await req.json();
  if (!contact_id) return NextResponse.json({ error: "contact_id is required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: contact, error } = await db.from("contacts").select("*").eq("id", contact_id).single();
  if (error || !contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  if (!contact.phone) return NextResponse.json({ error: "Contact has no phone number" }, { status: 400 });
  if (contact.do_not_call) {
    return NextResponse.json({ error: "This contact is marked Do Not Call" }, { status: 403 });
  }

  const webhookUrl = process.env.MAKE_OUTBOUND_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({ error: "MAKE_OUTBOUND_WEBHOOK_URL not configured" }, { status: 500 });
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

  if (!makeRes.ok) return NextResponse.json({ error: "Make.com webhook failed" }, { status: 502 });
  return NextResponse.json({ success: true });
}
