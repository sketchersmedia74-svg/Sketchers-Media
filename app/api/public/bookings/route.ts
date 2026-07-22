import { NextRequest, NextResponse } from "next/server";
import { createBooking, BookingUserError } from "@/lib/booking";

// POST /api/public/bookings -> create a booking from the public /book page. No auth (public by design).
// Body: { name, email?, phone?, start, end }
export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.start || !body.end) {
    return NextResponse.json({ error: "start and end are required" }, { status: 400 });
  }
  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!body.email && !body.phone) {
    return NextResponse.json({ error: "email or phone is required" }, { status: 400 });
  }

  try {
    const result = await createBooking({
      start: body.start,
      end: body.end,
      name: body.name,
      email: body.email,
      phone: body.phone,
      source: "public_page",
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    // BookingUserError messages (e.g. "that slot is taken") are plain domain
    // text, safe to show as-is. Anything else — Google Calendar not
    // connected, an expired/revoked token, or any other infra failure — must
    // never surface its raw error message to an external visitor.
    if (err instanceof BookingUserError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("POST /api/public/bookings failed:", err);
    return NextResponse.json(
      { error: "Booking temporarily unavailable, please check back soon." },
      { status: 503 }
    );
  }
}
