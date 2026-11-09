-- Browser calling (Telnyx). ADD-ONLY migration: no existing table/column is
-- dropped, renamed or retyped, and no existing row is updated or deleted.
-- Existing public.calls (AI call logs from Make.com) is NOT touched.

begin;

-- 1. New optional columns on contacts ---------------------------------------
-- (contacts.do_not_call already exists and is reused.)
alter table public.contacts
  add column if not exists state          text,          -- 2-letter US state, e.g. 'TX'
  add column if not exists timezone       text,          -- IANA, e.g. 'America/Chicago'
  add column if not exists next_call_at   timestamptz,   -- human call-back time
  add column if not exists last_called_at timestamptz,
  add column if not exists call_count     integer not null default 0;

alter table public.contacts
  add constraint contacts_state_format_chk
  check (state is null or state ~ '^[A-Z]{2}$');

create index if not exists idx_contacts_next_call_at on public.contacts (next_call_at);
-- For matching an inbound caller's number to a contact regardless of phone formatting.
create index if not exists idx_contacts_phone_last10
  on public.contacts (right(regexp_replace(phone, '\D', '', 'g'), 10));

-- 2. One Telnyx login per CRM user ------------------------------------------
create table if not exists public.telnyx_credentials (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  credential_id  text not null,
  sip_username   text,
  created_at     timestamptz not null default now()
);
alter table public.telnyx_credentials enable row level security;
-- Intentionally NO policies: only Edge Functions (service role) read/write it.
revoke all on public.telnyx_credentials from anon, authenticated;

-- 3. Call log (new table; separate from the existing AI-call table "calls") --
create table if not exists public.call_logs (
  id                      uuid primary key default gen_random_uuid(),
  contact_id              uuid references public.contacts(id) on delete set null,
  deal_id                 uuid references public.deals(id) on delete set null,
  user_id                 uuid references auth.users(id) on delete set null default auth.uid(),
  direction               text not null default 'outbound'
                            check (direction in ('outbound','inbound')),
  to_number               text,
  from_number             text,
  status                  text not null default 'dialing'
                            check (status in ('dialing','ringing','answered','ended','failed')),
  outcome                 text
                            check (outcome in ('no_answer','voicemail','interested','call_back',
                                               'not_interested','wrong_number','do_not_call')),
  notes                   text,
  call_session_id         text,
  call_control_id         text,
  hangup_cause            text,
  outside_hours_override  boolean not null default false,  -- admin overrode 8am-9pm check
  started_at              timestamptz not null default now(),
  answered_at             timestamptz,
  ended_at                timestamptz,
  duration_seconds        integer,
  recording_url           text,                            -- phase 2
  created_at              timestamptz not null default now()
);

create index if not exists call_logs_contact_idx on public.call_logs (contact_id, started_at desc);
create index if not exists call_logs_user_idx    on public.call_logs (user_id, started_at desc);
create index if not exists call_logs_session_idx on public.call_logs (call_session_id);

alter table public.call_logs enable row level security;

drop policy if exists "Authenticated team can read call_logs"   on public.call_logs;
drop policy if exists "Callers can insert their own call_logs"  on public.call_logs;
drop policy if exists "Callers or admins can update call_logs"  on public.call_logs;
drop policy if exists "Admins can delete call_logs"             on public.call_logs;

-- Same pattern as contacts/deals/calls: any signed-in team member can read.
create policy "Authenticated team can read call_logs" on public.call_logs
  for select using (auth.role() = 'authenticated');

-- A caller can only create rows stamped with their own user id.
create policy "Callers can insert their own call_logs" on public.call_logs
  for insert with check (auth.role() = 'authenticated' and user_id = auth.uid());

-- The caller who made the call (or an admin) can update it (outcome/notes/status only, see grants).
create policy "Callers or admins can update call_logs" on public.call_logs
  for update
  using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy "Admins can delete call_logs" on public.call_logs
  for delete using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Browser users may only edit these fields after the fact. Timing, numbers,
-- Telnyx ids and user_id are written by the insert or by the webhook (service role).
revoke all on public.call_logs from anon;
revoke update on public.call_logs from authenticated;
grant  update (outcome, notes, status) on public.call_logs to authenticated;

-- 4. Atomic counter bump, used by the telnyx-webhook Edge Function -----------
create or replace function public.bump_contact_call_stats(p_contact_id uuid, p_called_at timestamptz)
returns void
language sql
security definer
set search_path = public
as $$
  update public.contacts
     set call_count = call_count + 1,
         last_called_at = p_called_at
   where id = p_contact_id;
$$;
revoke all on function public.bump_contact_call_stats(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.bump_contact_call_stats(uuid, timestamptz) to service_role;

commit;
