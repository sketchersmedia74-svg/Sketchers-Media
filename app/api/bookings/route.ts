import { NextRequest, NextResponse } from "next/server";
import { checkApiKey } from "@/lib/apiAuth";
import { createBooking } from "@/lib/booking";

// POST /api/bookings -> create a booking on the shared calendar (x-api-key protected, for Make.com).
// Body: { contact_id?, name?, email?, phone?, start, end }
// Either contact_id, or name (+ email/phone), must be provided.
export async function POST(req: NextRequest) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const body = await req.json();
  if (!body.start || !body.end) {
    return NextResponse.json({ error: "start and end are required" }, { status: 400 });
  }
  if (!body.contact_id && !body.name) {
    return NextResponse.json({ error: "contact_id or name is required" }, { status: 400 });
  }

  try {
    const result = await createBooking({
      start: body.start,
      end: body.end,
      name: body.name ?? "",
      email: body.email,
      phone: body.phone,
      contact_id: body.contact_id,
      source: "api",
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to create booking" }, { status: 400 });
  }
}
