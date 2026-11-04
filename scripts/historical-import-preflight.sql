-- SQL Editor administrator only; never expose this script as a public RPC.
create temporary table porto_import_result(inserted integer default 0,skipped integer default 0) on commit drop;
insert into porto_import_result default values;
create or replace function pg_temp.import_phone(v text) returns text language sql immutable as $$
 select case when d ~ '^09[0-9]{7}$' then '598'||substr(d,2) when d ~ '^9[0-9]{7}$' then '598'||d when d ~ '^00598' then substr(d,3) else d end
 from (select regexp_replace(coalesce(v,''),'[^0-9]','','g') d) n
$$;
create or replace function pg_temp.import_name(v text) returns text language sql immutable as $$
 select trim(regexp_replace(lower(translate(coalesce(v,''),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')),'[^a-z0-9]+',' ','g'))
$$;
-- Blocks concurrent writes during the preflight and insert so a race cannot create duplicates.
lock table public.applications in share row exclusive mode;
do $preflight$
declare payload jsonb; c jsonb; d jsonb; target uuid; clash uuid;
begin
 if current_user not in ('postgres','supabase_admin') then raise exception 'Run in Supabase SQL Editor as database administrator';end if;
 select p.payload into payload from porto_import_payload p;
 select u.id into target from auth.users u join public.profiles p on p.id=u.id where lower(u.email)=lower(payload->>'owner_email') and p.active;
 if target is null then raise exception 'No existe un perfil activo para %. Crealo primero en Equipo, o vincula el usuario Auth a profiles.',payload->>'owner_email';end if;
 for c in select value from jsonb_array_elements(payload->'cases') loop
  d=c->'data';
  if exists(select 1 from public.applications where id=(c->>'id')::uuid) then
   if not exists(select 1 from public.audit_log where id=(c->>'marker_id')::uuid and application_id=(c->>'id')::uuid and changes->>'source_digest'=c->>'digest') then
    raise exception 'El registro % ya existe con otro lote/contenido. No se sobrescribio nada.',c->>'key';
   end if;
   continue;
  end if;
  select a.id into clash from public.applications a where
    (nullif(d->>'national_id','') is not null and regexp_replace(coalesce(a.national_id,''),'[^0-9]','','g')=d->>'national_id') or
    (length(pg_temp.import_phone(d->>'phone'))>=8 and pg_temp.import_phone(a.phone)=pg_temp.import_phone(d->>'phone')) or
    pg_temp.import_name(a.full_name)=pg_temp.import_name(d->>'full_name') limit 1;
  if clash is not null then raise exception 'Posible duplicado para %: ficha existente %. No se cargo el lote; revisar antes de fusionar.',c->>'key',clash;end if;
  if exists(select 1 from public.form_events e join jsonb_array_elements(c->'events') v on e.event_id=(v->>'id')::uuid) then raise exception 'Correos de % ya importados en otra ficha; revisar.',c->>'key';end if;
 end loop;
end $preflight$;
