begin;
-- Only imported historical cases with original email evidence.
-- ALTER holds an exclusive lock until commit; no concurrent write bypasses the guard.
alter table public.applications disable trigger guard_application;
with originals as (
  select a.id, a.created_at as previous_date, min(e.sent_at) as original_date
  from public.applications a
  join public.form_events e on e.application_id=a.id
  where e.payload->>'historical'='true'
    and exists (
      select 1 from public.audit_log h
      where h.application_id=a.id and h.action='historical_import'
    )
  group by a.id,a.created_at
), corrected as (
  update public.applications a
  set created_at=o.original_date
  from originals o
  where a.id=o.id and o.original_date<a.created_at
  returning a.id,o.previous_date,a.created_at
)
insert into public.audit_log
  (application_id,action,actor_name,visibility,changes)
select id,'historical_entry_date','Corrección de fecha histórica','case',
  jsonb_build_object(
    'created_at',jsonb_build_object('before',previous_date,'after',created_at),
    'respaldo','Fecha del primer formulario original. La carga al CRM permanece registrada en el historial.'
  )
from corrected;
alter table public.applications enable trigger guard_application;
commit;
