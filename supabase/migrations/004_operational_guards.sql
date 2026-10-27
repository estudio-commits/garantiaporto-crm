begin;
create table public.integration_rate_windows(window_start timestamptz primary key,requests integer not null);
alter table integration_rate_windows enable row level security;
create function public.take_integration_slot() returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;begin
 delete from integration_rate_windows where window_start<now()-interval '1 day';
 insert into integration_rate_windows values(date_trunc('minute',now()),1) on conflict(window_start) do update set requests=integration_rate_windows.requests+1 returning requests into n;
 return n<=120;
end $$;
revoke all on function take_integration_slot() from public,anon,authenticated;
grant execute on function take_integration_slot() to service_role;
create function public.note_timestamp() returns trigger language plpgsql as $$begin new.created_at=now();return new;end $$;
create trigger notes_timestamp before insert on notes for each row execute function note_timestamp();
commit;
