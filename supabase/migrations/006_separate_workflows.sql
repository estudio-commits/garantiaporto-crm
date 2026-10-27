begin;
alter table applications add column guarantee_stage text not null default 'sin_contactar';
alter table applications add column requested_date date;
alter table applications add column drive_folder_url text check(drive_folder_url is null or drive_folder_url ~ '^https://drive[.]google[.]com/drive/(u/[0-9]+/)?folders/[A-Za-z0-9_-]+/?([?][^[:space:]#]*)?(#[^[:space:]]*)?$');
alter table applications add constraint drive_url_length check(length(drive_folder_url)<=2048);
alter table application_sensitive add column rejection_reason text check(rejection_reason in ('ingresos_insuficientes','score_insuficiente','documentacion_insuficiente','clearing'));
alter table audit_log add column visibility text not null default 'case' check(visibility in ('case','admin','clearing'));
alter table audit_log add column actor_name text;
-- Preserve the prior model; a migration is not customer activity.
insert into audit_log(application_id,action,changes,visibility,actor_name)
 select id,'workflow_migration',jsonb_build_object('previous',to_jsonb(a)),'admin','Migración de esquema' from applications a;
alter table applications disable trigger guard_application;
alter table applications disable trigger audit_apps;
alter table applications drop constraint applications_stage_check;
update applications set
 guarantee_stage=case when decision in('aprobada','rechazada') then decision when preapproval<>'no_iniciada' then 'preaprobacion_cargada' when documentation in('completa','recibida_incompleta') then 'documentacion_recibida' when documentation in('solicitada','pendiente_cliente') then 'documentacion_solicitada' else 'sin_contactar' end,
 stage=case when stage='nuevo' then 'nuevo' when stage in('finalizado','descartado') then 'finalizado' else 'en_contacto' end,
 requested_date=(select (min(sent_at) at time zone 'America/Montevideo')::date from form_events where application_id=applications.id);
alter table applications add constraint applications_stage_check check(stage in('nuevo','en_contacto','finalizado'));
alter table applications add constraint guarantee_stage_check check(guarantee_stage in('sin_contactar','documentacion_solicitada','documentacion_recibida','preaprobacion_cargada','aprobada','rechazada'));
alter table applications add constraint guarantee_decision_consistent check((guarantee_stage in('aprobada','rechazada') and decision=guarantee_stage) or (guarantee_stage not in('aprobada','rechazada') and decision not in('aprobada','rechazada')));
alter table applications enable trigger guard_application;
alter table applications enable trigger audit_apps;
create index applications_recency on applications(updated_at desc);
create index applications_guarantee_stage on applications(guarantee_stage,updated_at desc);
drop policy audit_read on audit_log;
create policy audit_read on audit_log for select to authenticated using(is_admin() or (can_access(application_id) and (visibility='case' or (visibility='clearing' and can_clear(application_id)))));
create or replace function public.guard_application() returns trigger language plpgsql set search_path=public as $$
begin
 if current_user not in ('postgres','service_role','supabase_admin') and not is_admin() then
  if TG_OP='INSERT' then
   if new.source<>'manual' or new.completion<>'carga_manual' or new.decision<>'no_presentada' or new.guarantee_stage in ('aprobada','rechazada') or new.archived or new.external_id is not null or new.contact_id is not null then raise exception 'Forbidden fields'; end if;
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

create or replace function public.audit_change() returns trigger language plpgsql security definer set search_path=public as $$
declare aid uuid; delta jsonb; previous jsonb; vis text='case'; who text;
begin
 aid=case when TG_TABLE_NAME='applications' then (to_jsonb(new)->>'id')::uuid else (to_jsonb(new)->>'application_id')::uuid end;
 previous=case when TG_OP='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 select coalesce(jsonb_object_agg(n.key,jsonb_build_object('before',previous->n.key,'after',n.value)),'{}') into delta
 from jsonb_each(to_jsonb(new)) n where n.key not in('updated_at','created_at') and n.value is distinct from previous->n.key;
 if delta='{}'::jsonb then return new;end if;
 if TG_TABLE_NAME='application_sensitive' then vis='admin';
 elsif TG_TABLE_NAME='clearing_records' then vis='clearing';
 elsif TG_TABLE_NAME='custom_field_values' and exists(select 1 from custom_field_definitions where id=(to_jsonb(new)->>'field_id')::uuid and sensitive) then vis='admin';end if;
 select full_name into who from profiles where id=auth.uid();
 insert into audit_log(application_id,action,changes,visibility,actor_name) values(aid,TG_TABLE_NAME||':'||TG_OP,delta,vis,coalesce(who,'Sistema'));
 if TG_TABLE_NAME<>'applications' then update applications set updated_at=clock_timestamp() where id=aid;end if;
 return new;
end $$;
create function public.set_guarantee_decision(a_id uuid,new_stage text,reason text,confirmed_date date,reference text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not is_admin() then raise exception 'Administrator required' using errcode='42501';end if;
 if new_stage not in ('aprobada','rechazada') or confirmed_date is null or nullif(trim(reference),'') is null then raise exception 'Decision evidence required';end if;
 perform 1 from applications where id=a_id for update;if not found then raise exception 'Application not found';end if;
 if new_stage='rechazada' then
  if reason is null or reason not in('ingresos_insuficientes','score_insuficiente','documentacion_insuficiente','clearing') then raise exception 'Rejection reason required';end if;
  insert into application_sensitive(application_id,rejection_reason) values(a_id,reason) on conflict(application_id) do update set rejection_reason=excluded.rejection_reason;
 end if;
 update applications set guarantee_stage=new_stage,decision=new_stage,decision_date=confirmed_date,decision_reference=trim(reference) where id=a_id;
end $$;
revoke all on function set_guarantee_decision(uuid,text,text,date,text) from public,anon;
grant execute on function set_guarantee_decision(uuid,text,text,date,text) to authenticated;
create function public.event_request_date() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update applications set requested_date=(new.sent_at at time zone 'America/Montevideo')::date where id=new.application_id and requested_date is null;
 return new;
end $$;
create trigger form_event_request_date after insert on form_events for each row execute function event_request_date();
commit;
