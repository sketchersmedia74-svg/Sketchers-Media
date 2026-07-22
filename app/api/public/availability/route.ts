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
    // Anything reaching here is an infra problem (Google Calendar not
    // connected, or its token expired/revoked) — never leak the raw error
    // (e.g. Google's "invalid_grant") to an external visitor.
    console.error("GET /api/public/availability failed:", err);
    return NextResponse.json(
      { error: "Booking temporarily unavailable, please check back soon." },
      { status: 503 }
    );
  }
}
