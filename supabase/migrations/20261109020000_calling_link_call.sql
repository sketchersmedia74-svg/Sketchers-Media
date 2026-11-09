-- For the manual dialer: after calling a number that isn't in the CRM, the caller can
-- "Save as new contact". This links that call's log row to the new contact.
-- ADD-ONLY: one new function. (call_logs.contact_id is already nullable and
-- to_number already exists from the first calling migration, so nothing else changes.)
--
-- Why a function instead of letting browsers update contact_id directly: callers may only
-- edit outcome/notes/status on call_logs. This function allows exactly one extra change:
-- attaching an UNLINKED call you made (or any, if you're an admin) to a contact.

create or replace function public.link_call_to_contact(p_log_id uuid, p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log public.call_logs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select * into v_log from public.call_logs where id = p_log_id for update;
  if not found then
    raise exception 'call not found';
  end if;
  if v_log.contact_id is not null then
    raise exception 'call is already linked to a contact';
  end if;
  if v_log.user_id is distinct from auth.uid()
     and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then
    raise exception 'not your call';
  end if;
  if not exists (select 1 from public.contacts where id = p_contact_id) then
    raise exception 'contact not found';
  end if;

  update public.call_logs set contact_id = p_contact_id where id = p_log_id;

  -- The webhook skips the call counters when a call has no contact. If the call had already
  -- ended, count it now so the new contact's call_count / last_called_at are right.
  if v_log.ended_at is not null then
    update public.contacts
       set call_count = call_count + 1,
           last_called_at = v_log.ended_at
     where id = p_contact_id;
  end if;
end;
$$;

revoke all on function public.link_call_to_contact(uuid, uuid) from public, anon;
grant execute on function public.link_call_to_contact(uuid, uuid) to authenticated;
