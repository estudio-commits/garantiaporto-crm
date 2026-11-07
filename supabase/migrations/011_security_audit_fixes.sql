begin;
-- Security audit 2026-11-06 (see docs/SECURITY-AUDIT-2026-11.md).
-- 1) Sellers may not create cases with attribution or decision evidence (parity with the UPDATE guard).
-- 2) The web continuation identifier (external_id = solicitud_id) and contact_id are no longer readable by
--    client roles, nor copied into case-visible audit rows.
-- 3) ingest_event quarantines web events that target a case outside the normal web flow (archived, decided
--    or older than 30 days): the event is kept for admin review but does not modify the case.

create or replace function public.guard_application() returns trigger language plpgsql set search_path=public as $$
begin
 if current_user not in ('postgres','service_role','supabase_admin') and not is_admin() then
  if TG_OP='INSERT' then
   if new.source<>'manual' or new.completion<>'carga_manual' or new.decision<>'no_presentada' or new.guarantee_stage in ('aprobada','rechazada') or new.archived or new.external_id is not null or new.contact_id is not null
      or new.attribution is distinct from '{}'::jsonb or new.decision_date is not null or new.decision_reference is not null then raise exception 'Forbidden fields'; end if;
  else
   if new.assigned_user_id is distinct from old.assigned_user_id or new.decision is distinct from old.decision or new.decision_date is distinct from old.decision_date or new.decision_reference is distinct from old.decision_reference or new.archived is distinct from old.archived or new.external_id is distinct from old.external_id or new.contact_id is distinct from old.contact_id or new.source is distinct from old.source or new.completion is distinct from old.completion or new.attribution is distinct from old.attribution or new.created_at is distinct from old.created_at or new.id<>old.id or (new.guarantee_stage is distinct from old.guarantee_stage and (new.guarantee_stage in ('aprobada','rechazada') or old.guarantee_stage in ('aprobada','rechazada'))) then raise exception 'Forbidden fields'; end if;
  end if;
 end if;
 if TG_OP='UPDATE' then
  new.first_contact_at=old.first_contact_at; new.first_contact_by=old.first_contact_by;
 else new.first_contact_at=null; new.first_contact_by=null; end if;
 if new.contact_status='contactado' and new.first_contact_at is null then new.first_contact_at=now(); new.first_contact_by=auth.uid(); end if;

 if TG_OP='UPDATE' then
  new.created_at=old.created_at;
  if new.guarantee_stage is distinct from old.guarantee_stage then
   if new.guarantee_stage in ('aprobada','rechazada') then new.decision=new.guarantee_stage;
   elsif old.guarantee_stage in ('aprobada','rechazada') then new.decision='no_presentada';new.decision_date=null;new.decision_reference=null;end if;
  end if;
 end if;
 if new.guarantee_stage='rechazada' and (TG_OP='INSERT' or new.guarantee_stage is distinct from old.guarantee_stage) then
  if not exists(select 1 from application_sensitive where application_id=new.id and rejection_reason is not null) then raise exception 'Rejection reason required';end if;
 end if;
 if TG_OP='INSERT' then new.created_at=clock_timestamp();new.updated_at=new.created_at;
 elsif (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') or pg_trigger_depth()>1 then new.updated_at=clock_timestamp();
 else new.updated_at=old.updated_at;end if;
 return new;
end $$;

-- Column-level read access: every application column except external_id and contact_id.
revoke select on public.applications from authenticated, anon;
grant select (id,full_name,phone,rent_amount,rent_currency,guarantee_type,source,assigned_user_id,created_at,updated_at,completion,contact_status,first_contact_at,first_contact_by,stage,preapproval,documentation,decision,decision_date,decision_reference,summary,archived,attribution,source_id,guarantee_stage,requested_date,drive_folder_url,national_id,issued_date,issued_reference,decision_date_unknown,issued_reference_unknown,follow_up_date) on public.applications to authenticated;

create or replace function public.audit_change() returns trigger language plpgsql security definer set search_path=public as $$
declare aid uuid; delta jsonb; previous jsonb; vis text='case'; who text;
begin
 aid=case when TG_TABLE_NAME='applications' then (to_jsonb(new)->>'id')::uuid else (to_jsonb(new)->>'application_id')::uuid end;
 previous=case when TG_OP='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 select coalesce(jsonb_object_agg(n.key,jsonb_build_object('before',previous->n.key,'after',n.value)),'{}') into delta
 from jsonb_each(to_jsonb(new)) n where n.key not in('updated_at','created_at','external_id','contact_id') and n.value is distinct from previous->n.key;
 if delta='{}'::jsonb then return new;end if;
 if TG_TABLE_NAME='application_sensitive' then vis='admin';
 elsif TG_TABLE_NAME='clearing_records' then vis='clearing';
 elsif TG_TABLE_NAME='custom_field_values' and exists(select 1 from custom_field_definitions where id=(to_jsonb(new)->>'field_id')::uuid and sensitive) then vis='admin';end if;
 select full_name into who from profiles where id=auth.uid();
 insert into audit_log(application_id,action,changes,visibility,actor_name) values(aid,TG_TABLE_NAME||':'||TG_OP,delta,vis,coalesce(who,'Sistema'));
 if TG_TABLE_NAME<>'applications' then update applications set updated_at=clock_timestamp() where id=aid;end if;
 return new;
end $$;
revoke all on function public.audit_change() from public,anon,authenticated;
update public.audit_log set changes=changes-'external_id'-'contact_id' where action like 'applications:%' and (changes ? 'external_id' or changes ? 'contact_id');

-- Quarantined events are stored for admin review without touching the case.
alter table public.form_events add column if not exists quarantined boolean not null default false;

create or replace function public.capture_event_identity_marketing() returns trigger language plpgsql security definer set search_path=public as $$
declare ci text=nullif(trim(new.payload->'data'->>'national_id'),''); existing text; attrs jsonb;
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

create or replace function public.ingest_event(e jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a applications; d jsonb=e->'data'; cid uuid; existing form_events; discrepancy boolean=false; disorder boolean=false; quarantine boolean=false; sid uuid=(e->>'solicitud_id')::uuid;
begin
 -- Lock on the normalized UUID so textual variants of one request serialize.
 perform pg_advisory_xact_lock(hashtextextended(sid::text,0));
 select * into existing from form_events where event_id=(e->>'event_id')::uuid;
 if found then
  if existing.payload<>e then raise exception 'Event ID conflict'; end if;
  return jsonb_build_object('application_id',existing.application_id,'duplicate',true);
 end if;
 select * into a from applications where external_id=sid for update;
 if not found then
  insert into contacts default values returning id into cid;
  insert into applications(contact_id,external_id,full_name,phone,rent_amount,rent_currency,source,completion,attribution)
  values(cid,sid,d->>'full_name',d->>'phone',(d->>'rent_amount')::numeric,d->>'rent_currency','web',case when (e->>'step')::int=2 then 'completo' else 'parte_1_recibida' end,d-ARRAY['full_name','phone','rent_amount','rent_currency','national_id','monthly_income']) returning * into a;
  disorder=(e->>'step')::int=2;
 else
  quarantine=a.archived or a.guarantee_stage in ('aprobada','rechazada') or a.created_at<clock_timestamp()-interval '30 days';
  discrepancy=quarantine or a.full_name is distinct from d->>'full_name' or a.phone is distinct from d->>'phone' or (d->>'rent_amount' is not null and a.rent_amount is not null and a.rent_amount<>(d->>'rent_amount')::numeric) or (d->>'rent_currency' is not null and a.rent_currency is not null and a.rent_currency<>d->>'rent_currency');
  if not quarantine then
   update applications set completion=case when completion='completo' or (e->>'step')::int=2 then 'completo' else completion end,rent_amount=coalesce(rent_amount,(d->>'rent_amount')::numeric),rent_currency=coalesce(rent_currency,d->>'rent_currency'),attribution=jsonb_strip_nulls(d-ARRAY['full_name','phone','rent_amount','rent_currency','national_id','monthly_income'])||attribution where id=a.id;
  end if;
 end if;
 if (e->>'step')::int=2 and not quarantine then
  if exists(select 1 from application_sensitive s where s.application_id=a.id and ((nullif(d->>'national_id','') is not null and s.national_id<>'' and s.national_id<>d->>'national_id') or (d->>'monthly_income' is not null and s.monthly_income is not null and s.monthly_income<>(d->>'monthly_income')::numeric))) then discrepancy=true; end if;
  insert into application_sensitive(application_id,national_id,monthly_income) values(a.id,coalesce(d->>'national_id',''),(d->>'monthly_income')::numeric) on conflict(application_id) do update set national_id=coalesce(nullif(application_sensitive.national_id,''),excluded.national_id),monthly_income=coalesce(application_sensitive.monthly_income,excluded.monthly_income);
 end if;
 insert into form_events(id,event_id,application_id,step,sent_at,payload,out_of_order,discrepancy,quarantined) values((e->>'event_id')::uuid,(e->>'event_id')::uuid,a.id,(e->>'step')::int,(e->>'sent_at')::timestamptz,e,disorder,discrepancy,quarantine) returning form_events.discrepancy,form_events.out_of_order into discrepancy,disorder;
 insert into integration_attempts(event_id,status) values((e->>'event_id')::uuid,'processed');
 insert into audit_log(application_id,action,changes,visibility) values(a.id,'form_event',jsonb_build_object('step',e->'step','out_of_order',disorder,'discrepancy',discrepancy,'quarantined',quarantine),case when quarantine then 'admin' else 'case' end);
 return jsonb_build_object('application_id',a.id,'duplicate',false,'discrepancy',discrepancy,'quarantined',quarantine);
end $$;
revoke all on function public.ingest_event(jsonb) from public,anon,authenticated;
grant execute on function public.ingest_event(jsonb) to service_role;
commit;
