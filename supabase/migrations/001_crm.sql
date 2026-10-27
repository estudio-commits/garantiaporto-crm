begin;
create extension if not exists pgcrypto;
create table public.profiles(id uuid primary key references auth.users(id),full_name text not null,role text not null check(role in ('admin','seller')),active boolean not null default true,can_clearing boolean not null default false);
create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from profiles where id=auth.uid() and active and role='admin')$$;
create function public.is_active() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from profiles where id=auth.uid() and active)$$;
create table public.contacts(id uuid primary key default gen_random_uuid(),created_at timestamptz not null default now());
create table public.applications(
 id uuid primary key default gen_random_uuid(), contact_id uuid references contacts(id), external_id uuid unique,
 full_name text not null check(length(full_name) between 1 and 200),phone text not null check(length(phone) between 3 and 40),rent_amount numeric(16,2) check(rent_amount>=0),rent_currency text check(rent_currency in ('UYU','USD')),
 guarantee_type text not null default 'tradicional',source text not null default 'manual',assigned_user_id uuid references profiles(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 completion text not null default 'carga_manual' check(completion in ('parte_1_recibida','completo','carga_manual')),
 contact_status text not null default 'no_contactado' check(contact_status in ('no_contactado','contactado')),first_contact_at timestamptz, first_contact_by uuid references profiles(id),
 stage text not null default 'nuevo' check(stage in ('nuevo','en_gestion','esperando_respuesta','finalizado','descartado')),
 preapproval text not null default 'no_iniciada' check(preapproval in ('no_iniciada','en_proceso','preaprobado','no_preaprobado')),
 documentation text not null default 'no_solicitada' check(documentation in ('no_solicitada','solicitada','pendiente_cliente','recibida_incompleta','completa')),
 decision text not null default 'no_presentada' check(decision in ('no_presentada','en_evaluacion','aprobada','rechazada')),decision_date date, decision_reference text,
 summary text not null default '' check(length(summary)<=10000),archived boolean not null default false,attribution jsonb not null default '{}',
 check(decision not in ('aprobada','rechazada') or (decision_date is not null and length(trim(decision_reference))>0))
);
create function public.can_access(a uuid) returns boolean language sql stable security definer set search_path=public as $$select is_active() and exists(select 1 from applications where id=a and (is_admin() or assigned_user_id=auth.uid()))$$;
create function public.can_clear(a uuid) returns boolean language sql stable security definer set search_path=public as $$select can_access(a) and (is_admin() or exists(select 1 from profiles where id=auth.uid() and can_clearing))$$;
create table public.application_sensitive(application_id uuid primary key references applications(id),national_id text not null default '',monthly_income numeric(16,2) check(monthly_income>=0));
create table public.clearing_records(application_id uuid primary key references applications(id),result text not null default 'no_consultado' check(result in ('no_consultado','figura','no_figura','indeterminado')),detail text not null default '');
create table public.notes(id uuid primary key default gen_random_uuid(),application_id uuid not null references applications(id),author_id uuid not null default auth.uid() references profiles(id),body text not null check(length(trim(body)) between 1 and 10000),created_at timestamptz not null default now());
create table public.audit_log(id uuid primary key default gen_random_uuid(),application_id uuid references applications(id),actor_id uuid default auth.uid(),action text not null,changes jsonb,created_at timestamptz not null default now());
create table public.custom_field_definitions(id uuid primary key default gen_random_uuid(),label text not null check(length(label) between 1 and 100),type text not null check(type in ('text','number','date','select','boolean')),options jsonb not null default '[]',sensitive boolean not null default false,archived boolean not null default false);
create table public.custom_field_values(application_id uuid references applications(id),field_id uuid references custom_field_definitions(id),value text not null check(length(value)<=2000),primary key(application_id,field_id));
create table public.form_events(id uuid primary key,event_id uuid not null unique,application_id uuid not null references applications(id),step int not null check(step in(1,2)),sent_at timestamptz not null,received_at timestamptz not null default now(),payload jsonb not null,out_of_order boolean not null default false,discrepancy boolean not null default false);
create table public.integration_attempts(id uuid primary key default gen_random_uuid(),event_id uuid,status text not null,code text,created_at timestamptz not null default now());
create index applications_assigned_created on applications(assigned_user_id,created_at desc);
create index applications_stage on applications(stage,archived);
create index applications_phone on applications(phone);
create index notes_application on notes(application_id,created_at);
create index audit_application on audit_log(application_id,created_at);
create index events_application on form_events(application_id);

create function public.guard_application() returns trigger language plpgsql set search_path=public as $$
begin
 if current_user not in ('postgres','service_role','supabase_admin') and not is_admin() then
  if TG_OP='INSERT' then
   if new.source<>'manual' or new.completion<>'carga_manual' or new.decision<>'no_presentada' or new.archived or new.external_id is not null or new.contact_id is not null then raise exception 'Forbidden fields'; end if;
  else
   if new.assigned_user_id is distinct from old.assigned_user_id or new.decision is distinct from old.decision or new.decision_date is distinct from old.decision_date or new.decision_reference is distinct from old.decision_reference or new.archived is distinct from old.archived or new.external_id is distinct from old.external_id or new.contact_id is distinct from old.contact_id or new.source is distinct from old.source or new.completion is distinct from old.completion or new.attribution is distinct from old.attribution or new.created_at is distinct from old.created_at or new.id<>old.id then raise exception 'Forbidden fields'; end if;
  end if;
 end if;
 if TG_OP='UPDATE' then
  new.first_contact_at=old.first_contact_at; new.first_contact_by=old.first_contact_by;
 else new.first_contact_at=null; new.first_contact_by=null; end if;
 if new.contact_status='contactado' and new.first_contact_at is null then new.first_contact_at=now(); new.first_contact_by=auth.uid(); end if;
 new.updated_at=now(); return new;
end $$;
create trigger guard_application before insert or update on applications for each row execute function guard_application();
create function public.audit_change() returns trigger language plpgsql security definer set search_path=public as $$
declare aid uuid; delta jsonb;
begin
 aid=case when TG_TABLE_NAME='applications' then (to_jsonb(new)->>'id')::uuid else (to_jsonb(new)->>'application_id')::uuid end;
 if TG_TABLE_NAME='applications' then
  if TG_OP='UPDATE' then select coalesce(jsonb_object_agg(n.key,jsonb_build_object('before',to_jsonb(old)->n.key,'after',n.value)),'{}') into delta from jsonb_each(to_jsonb(new)) n where n.value is distinct from to_jsonb(old)->n.key and n.key not in ('updated_at','full_name','phone','summary','attribution'); else delta='{}'; end if;
 else delta=jsonb_build_object('entity',TG_TABLE_NAME); end if;
 insert into audit_log(application_id,action,changes) values(aid,TG_TABLE_NAME||':'||TG_OP,delta);
 return new;
end $$;
create trigger audit_apps after insert or update on applications for each row execute function audit_change();
create trigger audit_notes after insert on notes for each row execute function audit_change();
create trigger audit_sensitive after insert or update on application_sensitive for each row execute function audit_change();
create trigger audit_clearing after insert or update on clearing_records for each row execute function audit_change();
create trigger audit_custom after insert or update on custom_field_values for each row execute function audit_change();

alter table profiles enable row level security;
create policy profiles_read on profiles for select to authenticated using(is_active() and (is_admin() or id=auth.uid()));
create policy profiles_admin on profiles for all to authenticated using(is_admin()) with check(is_admin());
alter table contacts enable row level security;
create policy contacts_admin on contacts for all to authenticated using(is_admin()) with check(is_admin());
alter table applications enable row level security;
create policy app_read on applications for select to authenticated using(is_active() and (is_admin() or assigned_user_id=auth.uid()));
create policy app_insert on applications for insert to authenticated with check(is_active() and (is_admin() or assigned_user_id=auth.uid()));
create policy app_update on applications for update to authenticated using(can_access(id)) with check(is_active() and (is_admin() or assigned_user_id=auth.uid()));
alter table application_sensitive enable row level security;
-- Sensitive identity/income are admin-only in V1; sellers see ordinary assigned case data.
create policy sensitive_admin on application_sensitive for all to authenticated using(is_admin()) with check(is_admin());
alter table clearing_records enable row level security;
create policy clearing_read on clearing_records for select to authenticated using(can_clear(application_id));
create policy clearing_insert on clearing_records for insert to authenticated with check(can_clear(application_id));
create policy clearing_update on clearing_records for update to authenticated using(can_clear(application_id)) with check(can_clear(application_id));
alter table notes enable row level security;
create policy notes_read on notes for select to authenticated using(can_access(application_id));
create policy notes_insert on notes for insert to authenticated with check(can_access(application_id) and author_id=auth.uid());
alter table audit_log enable row level security;
create policy audit_read on audit_log for select to authenticated using(can_access(application_id) or is_admin());
alter table custom_field_definitions enable row level security;
create policy fields_read on custom_field_definitions for select to authenticated using(is_active() and (not sensitive or is_admin()));
create policy fields_admin on custom_field_definitions for all to authenticated using(is_admin()) with check(is_admin());
alter table custom_field_values enable row level security;
create function public.can_field(a uuid,f uuid) returns boolean language sql stable security definer set search_path=public as $$select can_access(a) and exists(select 1 from custom_field_definitions where id=f and (not sensitive or is_admin()))$$;
create policy values_read on custom_field_values for select to authenticated using(can_field(application_id,field_id));
create policy values_insert on custom_field_values for insert to authenticated with check(can_field(application_id,field_id));
create policy values_update on custom_field_values for update to authenticated using(can_field(application_id,field_id)) with check(can_field(application_id,field_id));
alter table form_events enable row level security;
create policy events_admin on form_events for select to authenticated using(is_admin());
alter table integration_attempts enable row level security;
create policy attempts_admin on integration_attempts for select to authenticated using(is_admin());
grant select,insert,update on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
revoke execute on function audit_change() from public;
commit;
