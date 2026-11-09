-- Lets the caller who answered an inbound call take ownership of its log row so they
-- can save the outcome and notes. Inbound rows are created by the webhook with no owner,
-- and callers can't otherwise update rows they don't own. ADD-ONLY: one new function.

create or replace function public.claim_inbound_call(p_session_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  update public.call_logs
     set user_id = auth.uid()
   where call_session_id = p_session_id
     and direction = 'inbound'
     and user_id is null
  returning id into v_id;

  -- Already claimed by this same caller (e.g. pressed Save twice): return it again.
  if v_id is null then
    select id into v_id
      from public.call_logs
     where call_session_id = p_session_id
       and direction = 'inbound'
       and user_id = auth.uid()
     limit 1;
  end if;

  return v_id;
end;
$$;

revoke all on function public.claim_inbound_call(text) from public, anon;
grant execute on function public.claim_inbound_call(text) to authenticated;
