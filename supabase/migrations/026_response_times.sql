-- 026: data for the response-time statistics.
-- wa_response_turns: each time a client writes (first message after the team's last reply), when it
-- happened and the first reply from a team member, with who answered. Assistant and automatic messages
-- are not replies from the team. Runs with the caller's permissions: each person only gets the
-- conversations of the cases they can see (RLS on wa_messages).
-- wa_business_hours: the team's attention hours set in Integraciones, to measure in working time.
begin;

create or replace function public.wa_response_turns(p_since timestamptz)
returns table(application_id uuid,author_id uuid,asked_at timestamptz,answered_at timestamptz)
language sql stable security invoker set search_path=public as $$
 with m as (
  select id,conversation_id,application_id,direction,author_id,created_at
  from wa_messages
  where application_id is not null and created_at>=p_since
    and (direction='in' or (direction='out' and author_id is not null and status<>'failed'))
 ), seq as (
  select m.*,lag(direction) over(partition by conversation_id order by created_at,id) as prev
  from m
 )
 select s.application_id,r.author_id,s.created_at,r.created_at
 from seq s
 left join lateral (
  select o.author_id,o.created_at from m o
  where o.conversation_id=s.conversation_id and o.direction='out' and o.created_at>=s.created_at
  order by o.created_at,o.id limit 1
 ) r on true
 where s.direction='in' and (s.prev is null or s.prev='out')
$$;
revoke all on function public.wa_response_turns(timestamptz) from public,anon;
grant execute on function public.wa_response_turns(timestamptz) to authenticated;

create or replace function public.wa_business_hours()
returns table(hours_start time,hours_end time,business_days int[])
language sql stable security definer set search_path=public as $$
 select hours_start,hours_end,business_days from wa_settings where id=1 and auth.uid() is not null
$$;
revoke all on function public.wa_business_hours() from public,anon;
grant execute on function public.wa_business_hours() to authenticated;
commit;
