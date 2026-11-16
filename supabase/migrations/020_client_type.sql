-- 020: client type. Owners ("propietario") also write in, but they are not guarantee opportunities:
-- they can be finalized without a follow-up date, and the app keeps them out of the pipeline, alerts and statistics.
begin;
alter table public.applications add column if not exists client_type text not null default 'inquilino'
 check(client_type in('inquilino','propietario'));
grant select (client_type) on public.applications to authenticated;
create or replace function public.guard_scheduled_followup()
returns trigger language plpgsql set search_path=public as $$
declare entering boolean; changed_date boolean;
begin
 if new.stage<>'finalizado' or new.guarantee_stage in ('aprobada','rechazada') or new.client_type='propietario' then
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
commit;
