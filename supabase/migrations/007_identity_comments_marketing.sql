begin;
-- Identification belongs to the assigned case. Income and rejection reasons remain admin-only.
alter table applications add column national_id text check(national_id is null or national_id ~ '^[0-9]{7,8}$');
alter table notes add column kind text not null default 'comentario' check(kind in('comentario','comunicacion','actualizacion'));
create index applications_national_id on applications(national_id) where national_id is not null;
create index notes_latest on notes(application_id,created_at desc);
-- Backfill only parseable identities, preserving original evidence and activity dates.
alter table applications disable trigger guard_application;
alter table applications disable trigger audit_apps;
update applications a set national_id=regexp_replace(trim(s.national_id),'[.\-]','','g') from application_sensitive s
 where s.application_id=a.id and trim(s.national_id) ~ '^([0-9]{6,7}-[0-9]|[0-9]{7,8}|([0-9][.])?[0-9]{3}[.][0-9]{3}-[0-9])$';
alter table applications enable trigger guard_application;
alter table applications enable trigger audit_apps;
create function public.normalize_case_identity() returns trigger language plpgsql set search_path=public as $$
begin
 if new.national_id is not null then
  if trim(new.national_id) !~ '^([0-9]{6,7}-[0-9]|[0-9]{7,8}|([0-9][.])?[0-9]{3}[.][0-9]{3}-[0-9])$' then raise exception 'Invalid identity format';end if;
  new.national_id=regexp_replace(trim(new.national_id),'[.\-]','','g');
 end if;
 if TG_OP='INSERT' and current_user='authenticated' and new.source='manual' and new.national_id is null then raise exception 'Identity required for manual requests';end if;
 return new;
end $$;
-- Runs before the activity guard to avoid a formatting-only edit touching updated_at.
create trigger aa_normalize_identity before insert or update on applications for each row execute function normalize_case_identity();
create function public.capture_event_identity_marketing() returns trigger language plpgsql security definer set search_path=public as $$
declare ci text=nullif(trim(new.payload->'data'->>'national_id'),''); existing text; attrs jsonb;
begin
 select national_id into existing from applications where id=new.application_id for update;
 if ci is not null then
  if ci ~ '^([0-9]{6,7}-[0-9]|[0-9]{7,8}|([0-9][.])?[0-9]{3}[.][0-9]{3}-[0-9])$' then
   ci=regexp_replace(ci,'[.\-]','','g');
   if existing is null then update applications set national_id=ci where id=new.application_id;
   elsif existing<>ci then new.discrepancy=true;end if;
  else new.discrepancy=true;end if;
 end if;
 -- Selected marketing fields in extra are promoted; arbitrary extra data stays in admin-only events.
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into attrs from jsonb_each(coalesce(new.payload->'extra','{}') || coalesce(new.payload->'data','{}'))
 where key in('utm_source','utm_medium','utm_campaign','utm_content','utm_term','button_origin','button_id','source_url','landing_page','referrer','form_id','gclid','gbraid','wbraid','fbclid','consent_evidence') and value<>'null'::jsonb and value<>'""'::jsonb;
 update applications set attribution=attrs || (select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(attribution) where value<>'null'::jsonb and value<>'""'::jsonb) where id=new.application_id;
 return new;
end $$;
create trigger form_event_capture before insert on form_events for each row execute function capture_event_identity_marketing();
revoke all on function normalize_case_identity(),capture_event_identity_marketing() from public,anon,authenticated;
-- Return flags set by event validation triggers as well as the original merge.
create or replace function public.ingest_event(e jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a applications; d jsonb=e->'data'; aid uuid; cid uuid; existing form_events; discrepancy boolean=false; disorder boolean=false;
begin
 -- Lock a request before looking up the event: both steps serialize, including first insert.
 perform pg_advisory_xact_lock(hashtextextended(e->>'solicitud_id',0));
 select * into existing from form_events where event_id=(e->>'event_id')::uuid;
 if found then
  if existing.payload<>e then raise exception 'Event ID conflict'; end if;
  return jsonb_build_object('application_id',existing.application_id,'duplicate',true);
 end if;
 select * into a from applications where external_id=(e->>'solicitud_id')::uuid for update;
 if not found then
  insert into contacts default values returning id into cid;
  insert into applications(contact_id,external_id,full_name,phone,rent_amount,rent_currency,source,completion,attribution)
  values(cid,(e->>'solicitud_id')::uuid,d->>'full_name',d->>'phone',(d->>'rent_amount')::numeric,d->>'rent_currency','web',case when (e->>'step')::int=2 then 'completo' else 'parte_1_recibida' end,d-ARRAY['full_name','phone','rent_amount','rent_currency','national_id','monthly_income']) returning * into a;
  disorder=(e->>'step')::int=2;
 else
  discrepancy=a.full_name is distinct from d->>'full_name' or a.phone is distinct from d->>'phone' or (d->>'rent_amount' is not null and a.rent_amount is not null and a.rent_amount<>(d->>'rent_amount')::numeric) or (d->>'rent_currency' is not null and a.rent_currency is not null and a.rent_currency<>d->>'rent_currency');
  update applications set completion=case when completion='completo' or (e->>'step')::int=2 then 'completo' else completion end,rent_amount=coalesce(rent_amount,(d->>'rent_amount')::numeric),rent_currency=coalesce(rent_currency,d->>'rent_currency'),attribution=jsonb_strip_nulls(d-ARRAY['full_name','phone','rent_amount','rent_currency','national_id','monthly_income'])||attribution where id=a.id;
 end if;
 if (e->>'step')::int=2 then
  if exists(select 1 from application_sensitive s where s.application_id=a.id and ((nullif(d->>'national_id','') is not null and s.national_id<>'' and s.national_id<>d->>'national_id') or (d->>'monthly_income' is not null and s.monthly_income is not null and s.monthly_income<>(d->>'monthly_income')::numeric))) then discrepancy=true; end if;
  insert into application_sensitive(application_id,national_id,monthly_income) values(a.id,coalesce(d->>'national_id',''),(d->>'monthly_income')::numeric) on conflict(application_id) do update set national_id=coalesce(nullif(application_sensitive.national_id,''),excluded.national_id),monthly_income=coalesce(application_sensitive.monthly_income,excluded.monthly_income);
 end if;
 insert into form_events(id,event_id,application_id,step,sent_at,payload,out_of_order,discrepancy) values((e->>'event_id')::uuid,(e->>'event_id')::uuid,a.id,(e->>'step')::int,(e->>'sent_at')::timestamptz,e,disorder,discrepancy) returning form_events.discrepancy,form_events.out_of_order into discrepancy,disorder;
 insert into integration_attempts(event_id,status) values((e->>'event_id')::uuid,'processed');
 insert into audit_log(application_id,action,changes) values(a.id,'form_event',jsonb_build_object('step',e->'step','out_of_order',disorder,'discrepancy',discrepancy));
 return jsonb_build_object('application_id',a.id,'duplicate',false,'discrepancy',discrepancy);
end $$;
commit;
