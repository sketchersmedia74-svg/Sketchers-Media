import { NextRequest, NextResponse } from "next/server";

/**
 * Checks the "x-api-key" header against CRM_API_KEY.
 * Use at the top of every /api/* route that Make.com or a voice-AI
 * platform will call directly (i.e. not through the logged-in dashboard).
 *
 * Usage:
 *   const authError = checkApiKey(req);
 *   if (authError) return authError;
 */
export function checkApiKey(req: NextRequest): NextResponse | null {
  const key = req.headers.get("x-api-key");
  if (!key || key !== process.env.CRM_API_KEY) {
    return NextResponse.json({ error: "Unauthorized: invalid or missing x-api-key" }, { status: 401 });
  }
  return null;
}
