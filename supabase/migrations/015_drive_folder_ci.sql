-- 015: Drive folders get the client's CI once it arrives.
-- The web form sends the CI after the case (and its Drive folder) already exists, so the folder kept the
-- placeholder "Nombre · Solicitud xxxxxxxx". Now the case is queued again when its CI is set and the
-- server renames the folder (only CRM-created folders that still carry the placeholder name).
begin;

-- Accept CIs typed with spaces (e.g. "1 234 567-8").
create or replace function public.capture_event_identity_marketing() returns trigger language plpgsql security definer set search_path=public as $$
declare ci text=nullif(regexp_replace(coalesce(new.payload->'data'->>'national_id',''),'\s','','g'),''); existing text; attrs jsonb;
begin
 if new.quarantined then return new; end if;
 select national_id into existing from applications where id=new.application_id for update;
 if ci is not null then
  if ci ~ '^([0-9]{6,7}-[0-9]|[0-9]{7,8}|([0-9][.])?[0-9]{3}[.][0-9]{3}-[0-9])$' then
   ci=regexp_replace(ci,'[.\-]','','g');
   if existing is null then update applications set national_id=ci where id=new.application_id;
   elsif existing<>ci then new.discrepancy=true;end if;
  else new.discrepancy=true;end if;
 end if;
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into attrs from jsonb_each(coalesce(new.payload->'extra','{}') || coalesce(new.payload->'data','{}'))
 where key in('utm_source','utm_medium','utm_campaign','utm_content','utm_term','button_origin','button_id','source_url','landing_page','referrer','form_id','gclid','gbraid','wbraid','fbclid','consent_evidence') and value<>'null'::jsonb and value<>'""'::jsonb;
 update applications set attribution=attrs || (select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(attribution) where value<>'null'::jsonb and value<>'""'::jsonb) where id=new.application_id;
 return new;
end $$;
revoke all on function public.capture_event_identity_marketing() from public,anon,authenticated;

create or replace function public.requeue_case_folder_name() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.national_id is null and new.national_id is not null and new.drive_folder_url is not null then
  update drive_folder_queue set status='pending',attempts=0,next_at=now(),error=null
  where application_id=new.id and status in('done','failed');
 end if;
 return new;
end $$;
drop trigger if exists zz_case_folder_name on public.applications;
create trigger zz_case_folder_name after update of national_id on public.applications
 for each row execute function public.requeue_case_folder_name();
revoke all on function public.requeue_case_folder_name() from public,anon,authenticated;

-- Fix recent folders already created with the placeholder name.
update drive_folder_queue q set status='pending',attempts=0,next_at=now(),error=null
from applications a
where a.id=q.application_id and q.status='done' and a.national_id is not null and a.drive_folder_url is not null
 and q.created_at>now()-interval '30 days';
commit;
