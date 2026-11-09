# Reset Dental Media CRM — browser calling with Telnyx (build plan for Claude Code)

You are adding **click-to-call from the browser** to the existing Reset Dental Media CRM. It runs on Supabase. Callers in Pakistan will phone US dentists from inside the CRM using a Telnyx US number. Every call is logged against the lead automatically.

Owner: sketchersmedia74@gmail.com · Timezone Asia/Karachi · Callers are human. **No AI or automated dialing in this build.**

---

## 0. Ground rules (read first)

- **This is a live CRM with real data.** Supabase project ref `relsqcksrcavkqvlrtie`.
  - Only **add** things: new tables, new columns, new functions.
  - Never drop, rename or retype an existing table or column.
  - Never run `delete` or `update` against existing rows.
- **Show the owner every SQL migration and wait for approval before running it.**
- **Never put secrets in frontend code.** That includes the Telnyx API key and the Supabase `service_role` key. Secrets go in Supabase Edge Function secrets only.
- **Do not touch the Sketchers task-board project** (`xvijwivuzlwojlpvjjjq`). It is unrelated.
- **Telnyx APIs change.** Check every endpoint and SDK call below against the current docs at developers.telnyx.com before using it. If something differs, follow the docs and tell the owner.

## 1. Discovery (do this before writing any code)

Read the codebase and report back to the owner:

1. **Frontend stack:** plain HTML/JS, React, Next.js, Vite, or something else. Also how it's built and deployed.
2. **Lead or contact table:**
   - Its name and primary key type.
   - Which columns hold the phone number, the US state and the owner or assigned user.
3. **Auth and roles:** how users sign in, and how admins are told apart from callers (e.g. a `profiles` table with a role, or a members table).
4. **Existing access rules (RLS):** the policy pattern used on the leads table. The new tables must follow the same pattern.
5. **Existing Edge Functions:** whether the repo has a `supabase/` folder and whether the Supabase CLI is linked.

Adjust names in the rest of this plan to match what you find. The plan calls the lead table `leads` and its key `id`.

## 2. Telnyx setup (the owner does this in portal.telnyx.com; you guide them)

1. **Verify the account** (Telnyx's identity check, called KYC) and add credit. Outbound calls to the US won't work until the account is verified.
2. **Buy a US local number.** Pick an area code that suits your target dentists.
3. **Create an Outbound Voice Profile.**
   - Allow the US and Canada as destinations.
   - Set a sensible daily spend limit.
4. **Create a Credential Connection** named e.g. `crm-webrtc`.
   - Attach it to the Outbound Voice Profile.
   - Assign the number to it, so inbound calls to the number reach callers' browsers.
   - Set its **webhook URL** to the `telnyx-webhook` Edge Function (step 5). Use API v2 webhooks.
5. **Set caller ID (CNAM)** on the number to "Reset Dental Media".
6. **Collect these values** and put them into Supabase secrets (`supabase secrets set ...`):
   - `TELNYX_API_KEY`: a new API v2 key used only for this.
   - `TELNYX_CONNECTION_ID`: the Credential Connection's ID.
   - `TELNYX_PUBLIC_KEY`: the webhook signing public key (Portal → Keys & Credentials → Public Key).
   - `TELNYX_CALLER_NUMBER`: the number in E.164 format, e.g. `+1XXXXXXXXXX`.

> **Vapi on the same number:** a Telnyx number is assigned to one connection at a time. If inbound calls go to callers' browsers here, Vapi can't also answer inbound calls on that number. **Recommendation:** buy a second number for Vapi later. Not part of this build.

## 3. Database migration (show it to the owner and wait for approval)

Make one migration file, e.g. `supabase/migrations/<timestamp>_calling.sql`. Draft below. Adapt the table and column names and the RLS helpers to what step 1 found.

```sql
-- 3.1 New columns on leads (all optional, nothing existing changes)
alter table public.leads
  add column if not exists timezone       text,          -- IANA, e.g. 'America/Chicago'
  add column if not exists do_not_call    boolean not null default false,
  add column if not exists next_call_at   timestamptz,
  add column if not exists last_called_at timestamptz,
  add column if not exists call_count     integer not null default 0;

-- 3.2 One Telnyx login per CRM user
create table if not exists public.telnyx_credentials (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  credential_id  text not null,       -- Telnyx telephony_credential id
  sip_username   text,
  created_at     timestamptz not null default now()
);
alter table public.telnyx_credentials enable row level security;
-- No policies: only the Edge Function (service role) reads or writes this table.

-- 3.3 Call log
create table if not exists public.calls (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            <same type as leads.id> references public.leads(id) on delete set null,
  user_id            uuid references auth.users(id) on delete set null default auth.uid(),
  direction          text not null default 'outbound' check (direction in ('outbound','inbound')),
  to_number          text,
  from_number        text,
  status             text not null default 'dialing',  -- dialing, ringing, answered, ended, failed
  outcome            text check (outcome in ('no_answer','voicemail','interested','call_back',
                                             'not_interested','wrong_number','do_not_call')),
  notes              text,
  call_session_id    text,      -- from Telnyx
  call_control_id    text,      -- from Telnyx
  hangup_cause       text,
  started_at         timestamptz not null default now(),
  answered_at        timestamptz,
  ended_at           timestamptz,
  duration_seconds   integer,
  recording_url      text,      -- phase 2
  created_at         timestamptz not null default now()
);
create index if not exists calls_lead_idx    on public.calls(lead_id, started_at desc);
create index if not exists calls_user_idx    on public.calls(user_id, started_at desc);
create index if not exists calls_session_idx on public.calls(call_session_id);

alter table public.calls enable row level security;
-- Policies: copy the leads table's pattern. Typically:
--   select: signed-in team members (or admins plus the user's own calls)
--   insert: signed-in team members, with user_id = auth.uid()
--   update: the caller who made the call (to set outcome and notes) or admins
--   delete: admins only
-- Add calls to the realtime publication if the CRM already uses realtime.
```

## 4. Edge Function: `telnyx-token`

**Purpose:** give a signed-in CRM user a short-lived token to log in to Telnyx WebRTC.

1. Require a valid Supabase JWT and get the user from it. Reject anyone who isn't an allowed team member (same check the CRM already uses).
2. Look up `telnyx_credentials` for that user. If there's no row:
   - Create a telephony credential: `POST https://api.telnyx.com/v2/telephony_credentials` with body `{ "connection_id": TELNYX_CONNECTION_ID, "name": "<user email>" }`.
   - Save the returned `id` in `telnyx_credentials`.
3. Generate a token: `POST https://api.telnyx.com/v2/telephony_credentials/{id}/token`. The response is a JWT string.
4. Return `{ token, callerNumber: TELNYX_CALLER_NUMBER }`. Never return the API key.
5. Handle CORS for the CRM's address(es).

## 5. Edge Function: `telnyx-webhook`

**Purpose:** turn Telnyx call events into rows in `calls`.

1. Deploy with `--no-verify-jwt`, because Telnyx calls it and has no Supabase login.
2. **Verify the signature on every request:**
   - Telnyx sends the `telnyx-signature-ed25519` and `telnyx-timestamp` headers.
   - Verify them against `TELNYX_PUBLIC_KEY` using the raw body.
   - Reject requests older than about 5 minutes.
   - Return 401 if verification fails.
3. Read `data.event_type` and `data.payload`.
4. **Match the event to a row:**
   - The frontend sends `clientState` = base64 of the `calls.id` it created (step 6). Telnyx echoes it back as `payload.client_state`.
   - Decode it to find the row.
   - If there's no client state, fall back to matching `call_session_id`.
5. **Handle these events:**
   - `call.initiated`: set `call_session_id`, `call_control_id` and `status = 'ringing'`. For **inbound** calls with no client state, insert a new row with `direction = 'inbound'` and try to match `from_number` to a lead's phone.
   - `call.answered`: set `answered_at` and `status = 'answered'`.
   - `call.hangup`: set `ended_at`, `hangup_cause`, `status = 'ended'`, and `duration_seconds` (from `answered_at`; 0 if never answered). Also set `leads.last_called_at` and add 1 to `leads.call_count`.
6. Always return 200 quickly once the signature is valid, so Telnyx doesn't keep retrying. Log errors.

## 6. Frontend

**SDK:** `@telnyx/webrtc`, from npm or its official CDN build, matching the stack found in step 1.

**Phone service** (a single module):
- On first use, fetch a token from `telnyx-token`.
- Create the client with `new TelnyxRTC({ login_token })` and connect.
- Fetch a fresh token and reconnect whenever the token expires or the connection drops.
- Ask for microphone permission up front. Show a clear message if it's denied.

**Call button on each lead**, plus a "Call" action in lead lists. When clicked, run these checks before dialing:
1. Is a phone number present? Convert it to E.164; US numbers become `+1XXXXXXXXXX`.
2. If `do_not_call` is set, block the call and say why.
3. **Calling-hours check:**
   - Work out the dentist's local time from `leads.timezone`. If that's empty, derive the time zone from the lead's US state and save it.
   - Block calls outside **8:00am–9:00pm local time**.
   - Admins may override, and the override is logged.

**Dialing:**
1. Insert a `calls` row (`status = 'dialing'`, `lead_id`, `to_number`, `from_number`) and get its `id`.
2. Call `client.newCall({ destinationNumber, callerNumber, clientState: btoa(callId) })`.

**Call bar** (fixed at the bottom of the screen):
- Shows the lead's name, live state (ringing / connected), a timer, mute, hang up and a keypad for phone menus.
- Updates its state from the SDK's notification events.

**After hang-up: outcome panel** (required):
- The caller must pick an outcome, can type notes, and can set a call-back date and time (writes `leads.next_call_at`).
- Picking "do not call" sets `leads.do_not_call = true`.
- Save the outcome and notes to the `calls` row.

**Next lead button:**
- Loads the next lead in the caller's queue.
- Leads come up if they are due (`next_call_at` empty or in the past), not on do-not-call, and inside calling hours right now.
- Sort by `next_call_at` first, then never-called leads.

**Call history:**
- Each lead page lists past calls with date, caller, duration, outcome and notes.

**Inbound calls:**
- When a call comes in, show an incoming-call bar with Answer / Decline. Show the matching lead if the number is known.

## 7. Test checklist

1. Calling-hours check: blocked outside the window, allowed inside it, admin override works and is logged.
2. Do-not-call flag blocks dialing.
3. Owner calls their own phone from the CRM:
   - It rings and shows the Telnyx number and the "Reset Dental Media" caller name.
   - Audio works both ways.
4. Hang up: the outcome panel appears; the `calls` row shows answered/ended times and duration; the lead's `call_count` goes up.
5. Unanswered call: logged with duration 0 and the hangup cause.
6. Inbound call to the number rings in the browser and is logged as inbound.
7. Webhook with a bad signature gets 401.
8. A non-team user can't get a token or read `calls`.
9. No secrets in the frontend bundle (search the built files for the API key prefix `KEY`).
10. No errors in the browser console.

## 8. Later phases (not in this build)

- **Recording:**
  - Turn on recording for the connection, or start it through Call Control.
  - Save `recording_url`.
  - Play an automatic "this call may be recorded" notice, or skip recording for **all-party-consent states**: CA, FL, IL, MD, MA, MT, NH, PA, WA, and check for others.
- **Reports:** calls per caller per day, connect rate, outcomes, and best times to call.
- **Second number for Vapi:** an AI receptionist for inbound calls and follow-ups with leads who opted in. AI calls to cold leads stay off, because the FCC treats AI voices as "artificial voice" under the TCPA, which requires consent.
- **Spam-label protection:** register the numbers with the free caller registry the US carriers use, and add a second number if one gets flagged.
