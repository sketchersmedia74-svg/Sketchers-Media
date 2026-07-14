import { NextRequest, NextResponse } from "next/server";
import { createBooking } from "@/lib/booking";

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
    return NextResponse.json({ error: err.message || "Failed to create booking" }, { status: 400 });
  }
}
