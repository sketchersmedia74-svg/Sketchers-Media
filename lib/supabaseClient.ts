import { createClient } from "@supabase/supabase-js";

// Browser-side client, used for team login (Supabase Auth) and reading data
// under Row Level Security. Uses the public anon key — safe to expose.
export const supabaseBrowser = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
