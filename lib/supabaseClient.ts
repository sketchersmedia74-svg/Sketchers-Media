import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

// Browser-side client, used for team login (Supabase Auth) and reading data
// under Row Level Security. Uses the public anon key — safe to expose.
//
// Must be the auth-helpers cookie-aware client, not a plain createClient():
// a plain client only ever stores the session in localStorage, so it never
// writes the auth cookie that server-side routes (createRouteHandlerClient /
// createMiddlewareClient) read. That mismatch is why direct browser queries
// to Supabase (which send the session as an Authorization header) succeed
// while our own /api/* routes see no session at all and return 401.
export const supabaseBrowser = createClientComponentClient();
