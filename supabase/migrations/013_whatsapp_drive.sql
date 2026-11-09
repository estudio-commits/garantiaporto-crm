begin;
-- Etapa 2: los documentos que llegan por WhatsApp se guardan en la carpeta de Google Drive del caso.
-- Los archivos nunca se guardan en la base: solo el identificador y el enlace de Drive.

alter table public.wa_messages
 add column if not exists media_status text check(media_status in('pending','processing','stored','rejected','failed')),
 add column if not exists media_attempts int not null default 0,
 add column if not exists media_next_at timestamptz,
 add column if not exists media_error text check(length(media_error)<=500);
create index if not exists wa_messages_media_due on public.wa_messages(media_next_at) where media_status in('pending','processing');

-- Only documents and images are filed; audio, video and stickers stay as chat messages.
create or replace function public.wa_mark_media() returns trigger language plpgsql set search_path=public as $$
begin
 if new.direction='in' and new.media is not null and new.kind in('document','image') and new.media_status is null then
  new.media_status='pending'; new.media_next_at=now();
 end if;
 return new;
end $$;
create trigger wa_messages_media before insert on public.wa_messages for each row execute function public.wa_mark_media();

create or replace function public.wa_claim_media(n int) returns table(id uuid,application_id uuid,kind text,media jsonb,created_at timestamptz,attempts int) language sql security definer set search_path=public as $$
 update wa_messages m set media_status='processing',media_attempts=m.media_attempts+1,media_next_at=now()
 where m.id in(select x.id from wa_messages x where x.application_id is not null and ((x.media_status='pending' and x.media_next_at<=now()) or (x.media_status='processing' and x.media_next_at<=now()-interval '10 minutes'))
  order by x.created_at for update skip locked limit greatest(1,least(n,10)))
 returning m.id,m.application_id,m.kind,m.media,m.created_at,m.media_attempts;
$$;

-- Case data the Drive worker needs to name or locate the folder.
create or replace function public.wa_media_case(p_application uuid) returns table(full_name text,national_id text,phone text,created_at timestamptz,drive_folder_url text) language sql stable security definer set search_path=public as $$
 select full_name,national_id,phone,created_at,drive_folder_url from applications where id=p_application;
$$;

create or replace function public.wa_complete_media(p_id uuid,p_status text,p_file_id text,p_file_url text,p_folder_url text,p_error text,p_retry boolean) returns void language plpgsql security definer set search_path=public as $$
declare m wa_messages;
begin
 select * into m from wa_messages where id=p_id for update;
 if not found or m.media_status<>'processing' then return; end if;
 if p_status='stored' then
  if p_file_url is null or p_file_url !~ '^https://drive[.]google[.]com/' then raise exception 'Invalid Drive file URL'; end if;
  update wa_messages set media_status='stored',media_error=null,media=coalesce(media,'{}'::jsonb)||jsonb_build_object('drive_file_id',p_file_id,'drive_url',p_file_url) where id=p_id;
  if p_folder_url is not null then
   update applications set drive_folder_url=p_folder_url where id=m.application_id and drive_folder_url is null;
  end if;
 elsif p_status='rejected' then
  update wa_messages set media_status='rejected',media_error=left(p_error,500) where id=p_id;
 elsif p_retry and m.media_attempts<6 then
  update wa_messages set media_status='pending',media_error=left(p_error,500),media_next_at=now()+make_interval(mins=>power(2,m.media_attempts)::int) where id=p_id;
 else
  update wa_messages set media_status='failed',media_error=left(p_error,500) where id=p_id;
 end if;
end $$;

-- Lets an admin or the assigned seller retry a failed upload (e.g. after sharing the case folder).
create or replace function public.wa_retry_media(p_message uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 update wa_messages set media_status='pending',media_attempts=0,media_next_at=now(),media_error=null
 where id=p_message and media_status='failed' and (is_admin() or (application_id is not null and can_access(application_id)));
end $$;

revoke all on function public.wa_mark_media(),public.wa_claim_media(int),public.wa_media_case(uuid),public.wa_complete_media(uuid,text,text,text,text,text,boolean),public.wa_retry_media(uuid) from public,anon,authenticated;
grant execute on function public.wa_claim_media(int),public.wa_media_case(uuid),public.wa_complete_media(uuid,text,text,text,text,text,boolean) to service_role;
grant execute on function public.wa_retry_media(uuid) to authenticated;
-- Every new case gets its own folder in the shared drive (Clientes garantiaporto.com.uy / Solicitudes),
-- created by the server shortly after the case enters the CRM.
create table public.drive_folder_queue(
 application_id uuid primary key references public.applications(id),
 status text not null default 'pending' check(status in('pending','processing','done','failed')),
 attempts int not null default 0,
 next_at timestamptz not null default now(),
 error text check(length(error)<=500),
 created_at timestamptz not null default now()
);
alter table public.drive_folder_queue enable row level security;
revoke all on public.drive_folder_queue from public,anon,authenticated;
grant select on public.drive_folder_queue to authenticated;
grant select,insert,update on public.drive_folder_queue to service_role;
create policy drive_folder_queue_admin on public.drive_folder_queue for select to authenticated using(is_admin());

create or replace function public.enqueue_case_folder() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.drive_folder_url is null then
  insert into drive_folder_queue(application_id) values(new.id) on conflict do nothing;
 end if;
 return new;
end $$;
create trigger zz_case_folder after insert on public.applications for each row execute function public.enqueue_case_folder();

create or replace function public.claim_case_folders(n int) returns table(application_id uuid,full_name text,national_id text,phone text,created_at timestamptz,drive_folder_url text) language sql security definer set search_path=public as $$
 with c as(
  update drive_folder_queue q set status='processing',attempts=q.attempts+1,next_at=now()
  where q.application_id in(select x.application_id from drive_folder_queue x where (x.status='pending' and x.next_at<=now()) or (x.status='processing' and x.next_at<=now()-interval '10 minutes')
   order by x.created_at for update skip locked limit greatest(1,least(n,20)))
  returning q.application_id)
 select a.id,a.full_name,a.national_id,a.phone,a.created_at,a.drive_folder_url from applications a join c on c.application_id=a.id;
$$;

create or replace function public.complete_case_folder(p_application uuid,p_folder_url text,p_error text,p_retry boolean) returns void language plpgsql security definer set search_path=public as $$
declare q drive_folder_queue;
begin
 select * into q from drive_folder_queue where application_id=p_application for update;
 if not found or q.status<>'processing' then return; end if;
 if p_folder_url is not null then
  update applications set drive_folder_url=p_folder_url where id=p_application and drive_folder_url is null;
  update drive_folder_queue set status='done',error=null where application_id=p_application;
 elsif p_retry and q.attempts<6 then
  update drive_folder_queue set status='pending',error=left(p_error,500),next_at=now()+make_interval(mins=>power(2,q.attempts)::int) where application_id=p_application;
 else
  update drive_folder_queue set status='failed',error=left(p_error,500) where application_id=p_application;
 end if;
end $$;

revoke all on function public.enqueue_case_folder(),public.claim_case_folders(int),public.complete_case_folder(uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_case_folders(int),public.complete_case_folder(uuid,text,text,boolean) to service_role;
commit;
