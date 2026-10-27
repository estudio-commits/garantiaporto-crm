begin;
create table public.client_sources (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 100),
 archived boolean not null default false
);
create unique index client_sources_unique_name on public.client_sources(lower(trim(name)));
insert into public.client_sources(id,name) values
 ('40000000-0000-4000-8000-000000000001','garantiaporto.com.uy'),
 ('40000000-0000-4000-8000-000000000002','Negocio inmobiliario');
alter table public.client_sources enable row level security;
create policy sources_read on public.client_sources for select to authenticated using(public.is_active());
create policy sources_create on public.client_sources for insert to authenticated with check(public.is_admin());
create policy sources_update on public.client_sources for update to authenticated using(public.is_admin()) with check(public.is_admin());
grant select,insert,update on public.client_sources to authenticated;
grant all on public.client_sources to service_role;
alter table public.applications add column source_id uuid references public.client_sources(id);
-- Only verified web provenance can be backfilled. Manual does not mean estate agency.
update public.applications set source_id='40000000-0000-4000-8000-000000000001' where source='web';
create index applications_source on public.applications(source_id);
alter table public.applications drop constraint applications_stage_check;
alter table public.applications add constraint applications_stage_check check(stage in('nuevo','en_gestion','en_preaprobacion','esperando_respuesta','finalizado','descartado'));
create function public.validate_client_source() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if TG_OP='INSERT' and new.source='web' and new.source_id is null then
  new.source_id='40000000-0000-4000-8000-000000000001';
  -- The authenticated web receiver keeps its stable source even if hidden for manual selection.
  return new;
 end if;
 if new.source_id is not null and (TG_OP='INSERT' or new.source_id is distinct from old.source_id) then
  if not exists(select 1 from client_sources where id=new.source_id and not archived) then raise exception 'Origin is not active';end if;
 end if;
 return new;
end $$;
create trigger validate_client_source before insert or update on applications for each row execute function validate_client_source();
-- Source and commercial stage changes are covered by the existing application audit trigger.
commit;
