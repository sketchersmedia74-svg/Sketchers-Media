-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query)

create extension if not exists "uuid-ossp";

-- Companies
create table if not exists companies (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  website text,
  industry text,
  notes text,
  created_at timestamptz not null default now()
);

-- Contacts
create table if not exists contacts (
  id uuid primary key default uuid_generate_v4(),
  first_name text not null,
  last_name text,
  email text,
  phone text,                         -- E.164 format recommended, e.g. +923001234567
  company_id uuid references companies(id) on delete set null,
  owner text,                         -- team member responsible
  created_at timestamptz not null default now()
);

-- Deals (pipeline)
create table if not exists deals (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  contact_id uuid references contacts(id) on delete cascade,
  company_id uuid references companies(id) on delete set null,
  value numeric default 0,
  stage text not null default 'New'
    check (stage in ('New','Contacted','Proposal','Won','Lost')),
  owner text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  outcome text,                       -- e.g. "interested", "no answer", "callback requested"
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
