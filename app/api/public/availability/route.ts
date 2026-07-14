import { NextResponse } from "next/server";
import { getOpenSlots } from "@/lib/booking";

// GET /api/public/availability -> open slots for the public /book page. No auth (public by design).
// force-dynamic: this GET takes no NextRequest/cookies/headers, so Next.js would
// otherwise statically cache the response at build/deploy time and keep serving
// a stale "not connected" (or stale slots) result forever.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const slots = await getOpenSlots();
    return NextResponse.json(slots);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load availability" }, { status: 500 });
  }
}
