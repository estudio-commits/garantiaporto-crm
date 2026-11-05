begin;
alter table public.applications add column if not exists follow_up_date date;
create or replace function public.guard_scheduled_followup()
returns trigger language plpgsql set search_path=public as $$
declare entering boolean; changed_date boolean;
begin
 if new.stage<>'finalizado' or new.guarantee_stage in ('aprobada','rechazada') then
  new.follow_up_date=null;
  return new;
 end if;
 if TG_OP='INSERT' then
  entering=true;
  changed_date=new.follow_up_date is not null;
 else
  entering=old.stage<>'finalizado';
  changed_date=new.follow_up_date is distinct from old.follow_up_date;
 end if;
 if entering and new.follow_up_date is null then
  raise exception 'Elegí una fecha de seguimiento para finalizar con garantía pendiente';
 end if;
 if new.follow_up_date is not null and (entering or changed_date) then
  if not isfinite(new.follow_up_date) or new.follow_up_date<(now() at time zone 'America/Montevideo')::date then
   raise exception 'La fecha de seguimiento debe ser hoy o posterior';
  end if;
 end if;
 return new;
end $$;
drop trigger if exists zzz_guard_scheduled_followup on public.applications;
create trigger zzz_guard_scheduled_followup before insert or update on public.applications
for each row execute function public.guard_scheduled_followup();
revoke all on function public.guard_scheduled_followup() from public,anon,authenticated;
commit;
