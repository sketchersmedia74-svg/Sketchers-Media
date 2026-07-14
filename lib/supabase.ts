import { createClient } from "@supabase/supabase-js";

// Server-side client using the SERVICE ROLE key.
// Only import this in API routes (server), never in client components —
// it bypasses Row Level Security, which is exactly what Make.com/webhooks need.
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
      // Next.js's App Router patches the global fetch() to cache GET requests
      // by default. Supabase's client makes plain GET requests to PostgREST,
      // so without this override Next.js would cache query results (e.g. a
      // "not connected yet" result from before Google Calendar was connected)
      // and keep serving that stale response indefinitely, even across restarts.
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    }
  );
}
