# Company CRM

Internal CRM: contacts, companies, deal pipeline (New → Contacted → Proposal → Won/Lost),
plus AI call logging (Bland.ai / Vapi via Make.com) shown right on each deal in "Contacted".

## 1. Set up Supabase (database + team login)
1. Create a free project at https://supabase.com
2. Go to SQL Editor → paste the contents of `supabase/schema.sql` → Run
3. Go to Authentication → Users → add one user per team member (email + password)
4. Go to Settings → API → copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - anon public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - service_role key → `SUPABASE_SERVICE_ROLE_KEY` (keep secret, server-only)

## 2. Configure environment
Copy `.env.example` to `.env.local` and fill in the values above, plus:
- `CRM_API_KEY` — generate with `openssl rand -hex 32`. This is what Make.com
  and your voice-AI platform will send to talk to the CRM's API.
- `MAKE_OUTBOUND_WEBHOOK_URL` — the "Custom Webhook" URL from the Make.com
  scenario that places outbound AI calls (see step 4).

## 3. Run locally / deploy
```
npm install
npm run dev        # http://localhost:3000
```
To deploy: push this folder to a GitHub repo, then import it in Vercel
(https://vercel.com/new) and paste the same env vars into Vercel's project settings.
Vercel gives you the public URL Make.com will call.

## 4. Wire up Make.com (both directions)

### A) CRM → Make.com → place an AI call
- In the dashboard, clicking **"Call now"** on a contact sends their name/phone
  to `MAKE_OUTBOUND_WEBHOOK_URL`.
- Build a Make.com scenario: **Webhooks (Custom webhook)** trigger → connect to
  **Bland.ai** / **Vapi** module to place the call, passing along the phone number.
- Pass `contact_id` through to the AI platform as metadata — you'll need it back
  in step B so the summary lands on the right contact.

### B) AI call finishes → Make.com → CRM (log the summary)
- Add a step in the same (or a follow-up) Make.com scenario that fires when the
  Bland.ai/Vapi call completes and its summary/transcript is ready.
- Add an **HTTP → Make a request** module:
  - URL: `https://your-deployed-app.vercel.app/api/calls`
  - Method: `POST`
  - Headers: `x-api-key: <your CRM_API_KEY>`, `Content-Type: application/json`
  - Body (map from the AI platform's output):
    ```json
    {
      "contact_id": "{{the contact_id you passed in step A}}",
      "phone_number": "{{phone number}}",
      "summary": "{{AI-generated call summary}}",
      "transcript": "{{full transcript}}",
      "outcome": "{{e.g. interested / no_answer}}",
      "duration_seconds": "{{call duration}}"
    }
    ```
- The CRM automatically moves the related deal to **Contacted** and shows the
  summary right on that card.

### C) Capturing email live on the call
- Your Vapi assistant should ask for and confirm an email address during "interested" 
  outcomes, then include it as `captured_email` in the payload sent to `/api/calls`.
- The CRM automatically saves this onto the contact record — no separate step needed.
- Your follow-up-email scenario should then pull the contact's (now updated) email via 
  `GET /api/contacts/:id` before sending, rather than relying on scraped data, since 
  Google Maps scrapes often don't include a reliable email at all.

### D) Get notified when a lead says "interested"
- When Make.com posts a call to `/api/calls` with `"outcome": "interested"`,
  the CRM automatically forwards the contact's name, phone, owner, and the
  call summary to `MAKE_NOTIFY_WEBHOOK_URL`.
- Build one more small Make.com scenario: **Webhooks (Custom webhook)** trigger
  → **Gmail/Outlook/Slack** module → send an email or message to the deal
  owner (or a shared sales inbox) saying "🔥 Interested lead: {{contact_name}} — {{summary}}".
- No extra API keys needed — this reuses the same webhook pattern as the outbound call.

## What's new: search, filtering, notifications
- **Pipeline board**: search box (matches deal title or contact name) and an
  "owner" dropdown filter, with a live count per stage.
- **Contacts page**: search box matching name, email, phone, or company.
- **Interested-lead alerts**: see section C above — fully automatic once you
  add `MAKE_NOTIFY_WEBHOOK_URL` and the Make.com scenario.

### Other useful endpoints for Make.com (all require `x-api-key` header)
- `GET /api/contacts` — list contacts (e.g. to sync new leads out to another tool)
- `POST /api/contacts` — create a contact (e.g. from a web form via Make)
- `POST /api/deals` — create a deal
- `PATCH /api/deals/:id` — move a deal's stage
- `GET /api/calls?contact_id=...` — pull call history for a contact

## Notes
- The dashboard (browser) uses Supabase Auth + Row Level Security — only signed-in
  team members can read/write there.
- The `/api/*` routes use the service role key server-side and are protected by the
  `x-api-key` header instead — that's what Make.com and your AI voice platform use.
- Add more team members anytime via Supabase → Authentication → Users, no code changes needed.
