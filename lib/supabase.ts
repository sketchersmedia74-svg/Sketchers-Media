import { createClient } from "@supabase/supabase-js";

// Server-side client using the SERVICE ROLE key.
// Only import this in API routes (server), never in client components —
// it bypasses Row Level Security, which is exactly what Make.com/webhooks need.
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
