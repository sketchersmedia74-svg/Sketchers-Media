import { NextRequest, NextResponse } from "next/server";
import { checkApiKey } from "@/lib/apiAuth";
import { getOpenSlots } from "@/lib/booking";

// GET /api/availability -> open slots on the shared calendar (x-api-key protected, for Make.com).
// force-dynamic: guarantees this is never statically cached (see app/api/public/availability/route.ts).
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  try {
    const slots = await getOpenSlots();
    return NextResponse.json(slots);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load availability" }, { status: 500 });
  }
}
