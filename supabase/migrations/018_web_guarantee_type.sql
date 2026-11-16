-- 018: web forms say which guarantee they are for.
-- The WordPress bridge sends extra.garantia_tipo ("tradicional" | "universitaria" | "rural"); until now every
-- web case was stored as "tradicional". A non-quarantined web event now sets the case's guarantee type,
-- unless the case already has a final decision.
begin;
create or replace function public.event_guarantee_type() returns trigger language plpgsql security definer set search_path=public as $$
declare t text=lower(trim(coalesce(new.payload->'extra'->>'garantia_tipo','')));
begin
 if new.quarantined or t not in('tradicional','universitaria','rural') then return new; end if;
 update applications set guarantee_type=t
 where id=new.application_id and source='web' and guarantee_type is distinct from t
   and guarantee_stage not in('aprobada','rechazada');
 return new;
end $$;
drop trigger if exists form_event_guarantee_type on public.form_events;
create trigger form_event_guarantee_type after insert on public.form_events
 for each row execute function public.event_guarantee_type();
revoke all on function public.event_guarantee_type() from public,anon,authenticated;
commit;
