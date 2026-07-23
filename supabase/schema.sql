-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query)

create extension if not exists "uuid-ossp";

-- Profiles: one row per Supabase Auth user, carrying app-level role.
-- id matches auth.users.id. Created automatically whenever a team member is
-- added via POST /api/team-members.
create table if not exists profiles (
  id uuid primary key,
  email text not null,
  full_name text,
  role text not null default 'member'
    check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
-- Any signed-in team member can read the whole roster (email/name/role aren't
-- sensitive inside an internal CRM) — needed so dropdowns elsewhere in the app
-- can show a colleague's name instead of their raw email.
create policy "Authenticated team can read profiles" on profiles
  for select using (auth.role() = 'authenticated');

-- Users may update their own display name, but the WITH CHECK subquery reads
-- the row's role as it stood before this statement, so a user can never use
-- this policy to escalate their own role to admin.
create policy "Users can update their own name" on profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id and role = (select p.role from profiles p where p.id = auth.uid()));

-- Name-only roster for attributing deals/notes to a specific person when
-- several team members share one login (profiles/auth.users requires a
-- unique email per login account, which doesn't fit that setup). These are
-- plain display names with no login of their own — just something to pick
-- in the Owner dropdown so "who actually worked this deal" survives a
-- shared account, even though the CRM session itself can't tell who's
-- currently typing.
create table if not exists team_names (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table team_names enable row level security;
create policy "Authenticated team can read team_names" on team_names
  for select using (auth.role() = 'authenticated');
create policy "Authenticated team can write team_names" on team_names
  for all using (auth.role() = 'authenticated');

-- Projects (organize leads by niche, e.g. Dentists, Chiropractors, Med Spas)
create table if not exists projects (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  color text not null default '#5C1A2E',
  created_at timestamptz not null default now()
);

alter table projects enable row level security;
create policy "Authenticated team can read projects" on projects
  for select using (auth.role() = 'authenticated');
create policy "Authenticated team can write projects" on projects
  for all using (auth.role() = 'authenticated');

-- Companies
create table if not exists companies (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  website text,
  industry text,
  notes text,
  project_id uuid references projects(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_companies_project on companies(project_id);

-- Contacts
create table if not exists contacts (
  id uuid primary key default uuid_generate_v4(),
  first_name text not null,
  last_name text,
  email text,
  phone text,                         -- E.164 format recommended, e.g. +923001234567
  company_id uuid references companies(id) on delete set null,
  owner text,                         -- team member responsible
  source text not null default 'manual',   -- e.g. manual / apify_scrape / referral
  call_attempts int not null default 0,
  max_attempts_reached boolean not null default false,
  do_not_call boolean not null default false,
  -- Set by POST /api/calls to ~1-2 days from now whenever a call outcome is
  -- "no_answer" or "voicemail" (and the 3-attempt cap hasn't been hit yet).
  -- GET /api/contacts/due-for-retry surfaces contacts once this has passed,
  -- for a scheduled Make.com scenario to redial automatically. Cleared
  -- (set null) once any other outcome is logged.
  next_retry_at timestamptz,
  created_at timestamptz not null default now()
);
alter table contacts add column if not exists next_retry_at timestamptz;

create index if not exists idx_contacts_next_retry_at on contacts(next_retry_at);

-- Deals (pipeline)
create table if not exists deals (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  contact_id uuid references contacts(id) on delete cascade,
  company_id uuid references companies(id) on delete set null,
  value numeric default 0,
  stage text not null default 'New'
    check (stage in ('New','Contacted','Proposal','Won','Lost')),
  lost_reason text
    check (lost_reason in ('not_interested','no_budget','bad_timing','competitor','other')),
  owner text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Notes / activity timeline on a contact
create table if not exists notes (
  id uuid primary key default uuid_generate_v4(),
  contact_id uuid references contacts(id) on delete cascade,
  text text not null,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_notes_contact on notes(contact_id);

alter table notes enable row level security;
create policy "Authenticated team can read notes" on notes
  for select using (auth.role() = 'authenticated');
create policy "Authenticated team can write notes" on notes
  for all using (auth.role() = 'authenticated');

-- Tasks / reminders on a contact
create table if not exists tasks (
  id uuid primary key default uuid_generate_v4(),
  contact_id uuid references contacts(id) on delete cascade,
  description text not null,
  due_date date,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_tasks_contact on tasks(contact_id);
create index if not exists idx_tasks_due_date on tasks(due_date);

alter table tasks enable row level security;
create policy "Authenticated team can read tasks" on tasks
  for select using (auth.role() = 'authenticated');
create policy "Authenticated team can write tasks" on tasks
  for all using (auth.role() = 'authenticated');

-- AI call logs (populated by Bland.ai / Vapi via Make.com webhook)
create table if not exists calls (
  id uuid primary key default uuid_generate_v4(),
  contact_id uuid references contacts(id) on delete cascade,
  deal_id uuid references deals(id) on delete set null,
  phone_number text,
  call_date timestamptz not null default now(),
  duration_seconds int,
  summary text,                       -- AI-generated call summary
  transcript text,                    -- full transcript (optional)
  outcome text,                       -- e.g. "interested", "no_answer", "voicemail", "callback_requested", "not_interested"
  recording_url text,
  raw_payload jsonb,                  -- original webhook payload, kept for debugging
  created_at timestamptz not null default now()
);

create index if not exists idx_calls_contact on calls(contact_id);
create index if not exists idx_deals_contact on deals(contact_id);
create index if not exists idx_deals_stage on deals(stage);

-- Auto-update updated_at on deals
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_deals_updated_at on deals;
create trigger trg_deals_updated_at
before update on deals
for each row execute procedure set_updated_at();

-- Row Level Security: only authenticated team members (via Supabase Auth) can
-- read/write through the browser dashboard. The API routes use the service
-- role key (server-side only) so they bypass RLS safely for Make.com/webhooks.
alter table companies enable row level security;
alter table contacts enable row level security;
alter table deals enable row level security;
alter table calls enable row level security;

create policy "Authenticated team can read companies" on companies
  for select using (auth.role() = 'authenticated');
create policy "Authenticated team can write companies" on companies
  for all using (auth.role() = 'authenticated');

create policy "Authenticated team can read contacts" on contacts
  for select using (auth.role() = 'authenticated');
create policy "Authenticated team can write contacts" on contacts
  for all using (auth.role() = 'authenticated');

create policy "Authenticated team can read deals" on deals
  for select using (auth.role() = 'authenticated');
create policy "Authenticated team can write deals" on deals
  for all using (auth.role() = 'authenticated');

create policy "Authenticated team can read calls" on calls
  for select using (auth.role() = 'authenticated');
create policy "Authenticated team can write calls" on calls
  for all using (auth.role() = 'authenticated');

-- Google Calendar integration: single shared company calendar.
-- calendar_settings holds the OAuth refresh token + shared availability config.
-- Intentionally has NO row-level-security policies at all: it's only ever
-- read/written via supabaseAdmin() (service role) in server routes, never via
-- the browser client, because it stores a refresh token.
create table if not exists calendar_settings (
  id smallint primary key default 1 check (id = 1),
  google_refresh_token text,
  connected_email text,
  calendar_id text not null default 'primary',
  timezone text not null default 'America/New_York',
  slot_duration_minutes int not null default 30,
  buffer_minutes int not null default 0,
  working_hours jsonb not null default '{
    "mon": {"start": "09:00", "end": "17:00"}, "tue": {"start": "09:00", "end": "17:00"},
    "wed": {"start": "09:00", "end": "17:00"}, "thu": {"start": "09:00", "end": "17:00"},
    "fri": {"start": "09:00", "end": "17:00"}
  }'::jsonb,
  -- Set to true when a Google Calendar API call fails with invalid_grant
  -- (the stored refresh token was revoked/expired) — surfaces a "Reconnect
  -- Google Calendar" warning on the admin dashboard. Cleared automatically
  -- the next time an admin successfully completes the OAuth connect flow.
  needs_reconnect boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table calendar_settings add column if not exists needs_reconnect boolean not null default false;
alter table calendar_settings enable row level security;

-- One row per booking made through the public /book page or POST /api/bookings.
create table if not exists bookings (
  id uuid primary key default uuid_generate_v4(),
  contact_id uuid references contacts(id) on delete set null,
  deal_id uuid references deals(id) on delete set null,
  google_event_id text,
  google_event_link text,
  start_time timestamptz not null,
  end_time timestamptz not null,
  attendee_name text,
  attendee_email text,
  attendee_phone text,
  source text not null check (source in ('public_page', 'api')),
  timezone text,
  created_at timestamptz not null default now()
);

create index if not exists idx_bookings_start on bookings(start_time);

alter table bookings enable row level security;
create policy "Authenticated team can read bookings" on bookings
  for select using (auth.role() = 'authenticated');
