# Project Notes — Sketchers Media CRM

Internal reference for picking this project back up in a new session. Last updated 2026-07-14.

- **Live app**: https://sketchers-media.vercel.app
- **GitHub**: https://github.com/sketchersmedia74-svg/Sketchers-Media
- **Stack**: Next.js 14.2.5 (App Router only, no `pages/`), Supabase (Postgres + Auth), deployed on Vercel.

---

## 1. Project structure & key files

```
app/
  page.tsx                     # Login page
  layout.tsx                   # Root layout: theme-init script, PWA manifest link, SW registration
  globals.css                  # All CSS: theme vars, sidebar, dataviz (bar/funnel), overview layout
  overview/page.tsx            # Landing page after login (was /dashboard before this session)
  dashboard/page.tsx           # Pipeline kanban board (still lives at /dashboard route)
  contacts/page.tsx            # Contacts list, CSV import/export, New Contact modal
  contacts/[id]/page.tsx       # Contact detail: notes, tasks, do-not-call, delete
  companies/page.tsx           # Companies list, inline project edit, Edit Company modal
  projects/page.tsx            # Project (niche) management
  team/page.tsx                # Admin-only: list/add team members, set full_name
  settings/calendar/page.tsx   # Admin-only: connect Google Calendar, set working hours/duration
  bookings/page.tsx            # All team: read-only list of bookings (contact, deal, calendar event link)
  book/page.tsx                # Public booking page (no login) — /book
  components/Sidebar.tsx       # Left icon rail, collapsible, dark/light toggle, sign-out
  components/RegisterServiceWorker.tsx
  api/
    contacts/route.ts, contacts/[id]/route.ts   # x-api-key protected (Make.com/Apify)
    companies/route.ts
    deals/route.ts, deals/[id]/route.ts
    calls/route.ts             # Make.com webhook: logs calls, call_attempts, max_attempts_reached
    trigger-call/route.ts      # x-api-key protected outbound call trigger; checks do_not_call
    internal/trigger-call/route.ts   # session-cookie protected version (dashboard "Call now" button)
    team-members/route.ts      # admin-only GET/POST; self-heals missing profiles rows
    calendar/oauth/start, oauth/callback/route.ts   # admin-only Google OAuth connect flow
    calendar/settings/route.ts # admin-only GET/PATCH shared availability config
    availability/route.ts, bookings/route.ts        # x-api-key protected (Make.com), same logic as public/*
    public/availability/route.ts, public/bookings/route.ts   # no auth, backs the /book page

lib/
  supabaseClient.ts   # Browser client — MUST use createClientComponentClient() (see §4.1)
  supabase.ts         # supabaseAdmin() — service-role client, server-only
  apiAuth.ts          # checkApiKey() for x-api-key protected routes
  adminAuth.ts        # requireAdminSession() — session-cookie + profiles.role check for admin-only routes
  googleCalendar.ts   # OAuth2 client, freebusy query, event creation — shared company calendar
  booking.ts          # getOpenSlots()/createBooking() — shared logic behind both API pairs and /book
  email.ts            # sendBookingConfirmationEmail() — currently a stub, no provider wired up
  csv.ts              # parseCsv / downloadCsv helpers

middleware.ts         # Refreshes the Supabase auth cookie on every request (see §4.1)
supabase/schema.sql   # "Intended" full schema — see §4.5 about drift risk
electron/             # Separate mini-project: Electron wrapper around the live Vercel URL
public/manifest.json, public/sw.js, public/icons/   # PWA support
```

No `pages/` directory, no i18n config anywhere.

---

## 2. Branding

- **Name**: "Sketchers Media CRM" (was "Company CRM" originally).
- **Accent color**: burgundy `#5C1A2E`, used identically in light and dark mode. Tint color: `#F5E9EC` (light) / `#3A1B22` (dark), used for hover states and highlight boxes.
- **Dark mode**: near-black surfaces (`#121212` bg, `#1e1e1e` cards). Toggle lives at the bottom of the sidebar; auto-detects system preference on first visit, manual choice persisted in `localStorage`.
- **Sidebar**: fixed dark near-black rail (`#1B0F13`), icon-only by default, expandable (persisted in `localStorage`) to show text labels. Logo sits stacked directly under the hamburger toggle in both states.
- **Logo**: `public/logo.png` — actually a small non-square JPEG (247×135) mislabeled `.png`. Rendered with `object-fit: contain` everywhere (not `cover`) to avoid cropping. A separate 512×512 padded version was generated for the Electron app icon and PWA icons (logo centered on the brand color).

---

## 3. Environment variables in use

From `.env.example` (real values live in `.env.local`, gitignored):

| Var | Used by | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser client | public, RLS-scoped |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase.ts` (`supabaseAdmin()`) | server-only, bypasses RLS |
| `CRM_API_KEY` | `lib/apiAuth.ts` | shared secret for Make.com/Bland.ai/Vapi-facing `/api/*` routes (`x-api-key` header) |
| `MAKE_OUTBOUND_WEBHOOK_URL` | trigger-call routes | Make.com scenario that places outbound AI calls |
| `MAKE_NOTIFY_WEBHOOK_URL` | `api/calls/route.ts` | notifies team on "interested" outcome |
| `MAKE_BOOKING_NOTIFY_WEBHOOK_URL` | `lib/booking.ts` | optional, fired on every new booking (public page or API) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI` | `lib/googleCalendar.ts` | OAuth app credentials for the shared company calendar connection |

No other env vars. Electron app has none of its own — it just points at the deployed URL (hardcoded `APP_URL` in `electron/main.js`).

---

## 4. Known pending issues / things to watch out for

### 4.1 Session-cookie bug (fixed — don't regress this)
`lib/supabaseClient.ts` **must** use `createClientComponentClient()` from `@supabase/auth-helpers-nextjs`, not a plain `createClient()` from `@supabase/supabase-js`. A plain client only ever persists the session in `localStorage` and never writes the httpOnly cookie that server-side routes (`createRouteHandlerClient`, `createMiddlewareClient`) depend on. This caused a confusing "Not signed in" 401 on `/api/team-members` that looked session-related but was actually a client-config mismatch. `middleware.ts` was added to keep that cookie refreshed on every request — **don't remove either piece** without re-reading why they're there.

### 4.2 No Node/npm in the assistant's sandbox
Every `package.json` change and every `schema.sql` change made by Claude in this project was **never locally build-tested** — no `npm install` / `npm run build` / `next dev` was ever run by the assistant. All verification has been "read the diff carefully" plus the human running builds on Vercel. Budget for a real `npm run build` check after any nontrivial change.

### 4.3 TypeScript build failures already hit twice
`app/api/team-members/route.ts` — `supabase.auth.admin.listUsers()`'s `data.users` was resolving to a `never[]` element type under strict TS after the error-narrowing check, breaking `.filter()`/`.map()` calls twice in a row before being fixed by casting to an explicit local type before any chaining. If this file is touched again, make sure that cast is still there and still needed.

### 4.4 `useSearchParams()` needs a Suspense boundary
Next.js App Router build-fails without it. Already applied in `app/overview/page.tsx` and `app/dashboard/page.tsx` (both split into an outer default-export wrapper with `<Suspense>` and an inner `*Content` component). Keep this pattern for any new page that reads query params.

### 4.5 `schema.sql` vs. live database drift risk
`schema.sql` is meant to represent the full intended schema, but in practice every new column/table this session was applied to the **live** Supabase DB via hand-written incremental SQL snippets pasted into chat and run manually by the user in the SQL Editor — not by re-running the whole file. There's a real chance schema.sql and the live DB have drifted. **Before building a new feature that touches the schema, sanity-check the live DB structure directly rather than trusting schema.sql blindly.**

### 4.6 `profiles` RLS history — don't loosen the UPDATE policy
The `profiles` table's SELECT policy changed from "read only your own row" to "any authenticated user can read the whole roster" (needed for name dropdowns). The UPDATE policy (self-edit `full_name`) has a `WITH CHECK` subquery that re-reads the pre-update `role`, specifically to prevent a member from self-promoting to admin. If this policy is ever touched, preserve that guard.

### 4.7 First-run bootstrap for roles
When the role system was introduced, pre-existing Supabase Auth users had no `profiles` row and were locked out of admin-gated pages until a manual backfill (`insert into profiles ... select ... from auth.users`, defaulting to `role = 'admin'`) was run. `GET /api/team-members` now self-heals any missing profile row going forward (defaults new ones to `'member'`) — but remember this if a new environment/DB is ever spun up from scratch.

### 4.8 Duplicate-creation bugs (fixed, but check for the same pattern elsewhere)
CSV import was recreating companies because the in-memory company list used for dedup was loaded once at page-mount and could be stale vs. the DB — fixed by checking the DB directly (case-insensitive) before creating. Contact dedup was upgraded from phone-only matching to a full-record signature (name+phone+email+company). **Likely still-unmerged duplicate rows exist in `companies`/`contacts` from before this fix** — cleanup SQL (merge by case-insensitive name / full signature, re-point dependent rows, then delete) was given in chat; not confirmed whether it was actually run.

### 4.9 GHSA-36qx — unresolved, not "decided to ignore"
User asked whether this advisory applies. Only a partial/truncated ID was given (real GHSA IDs are longer), so it was never actually looked up — this was **never verified either way**. What we did confirm: this app uses Next.js 14.2.5, pure App Router (no `pages/`), no i18n config. If this comes up again, get the full advisory ID/URL and check its actual affected-versions/conditions against those facts.

### 4.10 Data-model simplifications (intentional, not bugs)
- "Leads" and "Deals" are the same underlying `deals` table — there's no separate leads entity, so some Overview stats (e.g. Total Leads vs. Total Deals) will always show identical numbers.
- Contacts don't have a reliably-set "owner" through any UI form (only `deals.owner` is actually used/set) — several features (Overview's team filter for tasks/notes, notifications) infer a contact's owner indirectly via its linked deal.
- Pipeline's "All owners" filter dropdown still derives its options from existing deal records rather than the `profiles` roster, so it can show legacy/raw values; only the New Deal form, the card-level owner editor, and Overview's filters use the profiles-based name mapping.

### 4.11 Electron app is online-only
`electron/` wraps the **live Vercel URL** — it is not an offline/local build of the Next.js server. It's a separate npm project (own `package.json`); run `npm install` inside `electron/` separately from the root project. The app icon is a plain PNG (fine on Windows/Linux); would need `.icns` conversion for a polished macOS build.

### 4.12 PWA service worker is intentionally a no-op
`public/sw.js` exists only to satisfy Chrome/Android's installability requirement for "Add to Home Screen" — it does no caching and passes every request straight to the network. Don't add real caching logic casually; this is an internal tool that always needs fresh data.

### 4.13 Misc cleanup done this session
Removed a stray, oddly-named empty directory literally called `app/api/{contacts,companies,deals,calls,pipeline}` (likely leftover from a shell brace-expansion mistake at some point) — held no files, just noting in case anyone remembers seeing it.

### 4.14 Booking confirmation email is a stub, not decided-to-skip
`lib/email.ts`'s `sendBookingConfirmationEmail()` only logs — no email provider is wired
up yet (Resend/Zoho/SMTP were considered; Zoho was the stated intent once it's set up).
The call site in `lib/booking.ts` is already in place, so wiring a real provider is a
one-function change. `calendar_settings` (the shared calendar/availability config,
including the Google refresh token) has **no RLS select policy at all** — it's only ever
read via `supabaseAdmin()` server-side. Don't add an `authenticated`-read policy to it the
way other tables have; that would leak the refresh token to any signed-in browser client.

### 4.15 Next.js caches Supabase's fetch() calls unless disabled — costly to rediscover
`supabaseAdmin()` in `lib/supabase.ts` explicitly passes `global: { fetch: ... cache: "no-store" }`
to `createClient()`. Without it, Next.js App Router's patched global `fetch` silently caches
PostgREST's GET requests, so `supabaseAdmin()` queries can keep returning a stale result
(observed: `calendar_settings` kept reporting "not connected" long after the row was updated,
across dev-server restarts) with no error. If a future refactor touches this client
construction, keep that fetch override — it cost a long debugging session to find once already.

### 4.16 `bookings.google_event_link` added after initial schema — check for drift
The initial Google Calendar integration only stored `google_event_id`; a `google_event_link`
column (used by the `/bookings` page to link out to the calendar event) was added afterward.
Per §4.5, this was applied as a manual `alter table` snippet, not a full schema.sql re-run —
sanity-check the live DB has it before relying on that column.

---

## Current dependencies (package.json)

```json
"dependencies": {
  "@hello-pangea/dnd": "^17.0.0",
  "@supabase/auth-helpers-nextjs": "^0.10.0",
  "@supabase/supabase-js": "^2.45.4",
  "googleapis": "^144.0.0",
  "next": "14.2.5",
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "uuid": "^9.0.1"
},
"devDependencies": {
  "@types/node": "^20.14.0",
  "@types/react": "^18.3.3",
  "typescript": "^5.5.3"
}
```
