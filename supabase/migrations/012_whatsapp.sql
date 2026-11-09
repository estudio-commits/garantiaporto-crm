begin;
-- WhatsApp (Cloud API, número exclusivo de la API). Ver docs/WHATSAPP.md.
-- Clients only read through RLS; every write goes through SECURITY DEFINER functions
-- executed by the server (service_role) or narrow RPCs that re-check case access.

-- Same rules as lib/phone.ts whatsappNumber(): Uruguayan mobiles by default, other countries need a prefix.
create or replace function public.wa_number(v text) returns text language plpgsql immutable set search_path=public as $$
declare input text=trim(coalesce(v,'')); n text; intl boolean;
begin
 if input='' or input !~ '^\+?[0-9[:space:]().-]+$' then return null; end if;
 n=regexp_replace(input,'[^0-9]','','g');
 intl=left(input,1)='+' or left(n,2)='00';
 if left(n,2)='00' then n=substr(n,3); end if;
 if n ~ '^59809[0-9]{7}$' then n='598'||substr(n,5); end if;
 if n ~ '^5989[0-9]{7}$' then return n; end if;
 if left(n,3)='598' then return null; end if;
 if intl then return case when n ~ '^[1-9][0-9]{7,14}$' then n end; end if;
 if n ~ '^09[0-9]{7}$' then return '598'||substr(n,2); end if;
 if n ~ '^9[0-9]{7}$' then return '598'||n; end if;
 return null;
end $$;

-- Normalized number used to match incoming chats with existing cases. Not granted to client roles.
alter table public.applications add column if not exists phone_wa text generated always as (public.wa_number(phone)) stored;
create index if not exists applications_phone_wa on public.applications(phone_wa,created_at desc) where phone_wa is not null;

insert into public.client_sources(id,name) values('40000000-0000-4000-8000-000000000003','WhatsApp') on conflict do nothing;

create table public.wa_settings(
 id int primary key default 1 check(id=1),
 auto_greeting boolean not null default true,
 greeting_template text not null default 'saludo_solicitud' check(greeting_template ~ '^[a-z0-9_]+$' and length(greeting_template)<=512),
 reopen_template text not null default 'retomar_conversacion' check(reopen_template ~ '^[a-z0-9_]+$' and length(reopen_template)<=512),
 template_language text not null default 'es_UY' check(template_language ~ '^[a-z]{2}(_[A-Z]{2})?$'),
 auto_reply_enabled boolean not null default true,
 auto_reply_text text not null default 'Hola, gracias por escribir a Garantía Porto. Recibimos tu mensaje y en breve te responde una persona del equipo.' check(length(trim(auto_reply_text)) between 1 and 1000),
 updated_at timestamptz not null default now()
);
insert into public.wa_settings default values;

create table public.wa_conversations(
 id uuid primary key default gen_random_uuid(),
 wa_id text not null unique check(wa_id ~ '^[1-9][0-9]{7,14}$'),
 application_id uuid references public.applications(id),
 profile_name text check(length(profile_name)<=200),
 last_inbound_at timestamptz,
 last_message_at timestamptz,
 unread_count int not null default 0 check(unread_count>=0),
 needs_human boolean not null default false,
 bot_paused boolean not null default false,
 created_at timestamptz not null default now()
);
create index wa_conversations_app on public.wa_conversations(application_id);
create index wa_conversations_recent on public.wa_conversations(last_message_at desc);

create table public.wa_messages(
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.wa_conversations(id),
 application_id uuid references public.applications(id),
 wamid text unique check(length(wamid)<=200),
 direction text not null check(direction in('in','out')),
 author text not null check(author in('customer','bot','human','system')),
 author_id uuid references public.profiles(id),
 kind text not null check(kind in('text','template','image','document','audio','video','sticker','location','contacts','interactive','button','reaction','unsupported')),
 body text not null default '' check(length(body)<=10000),
 media jsonb,
 status text not null check(status in('received','sent','delivered','read','failed')),
 error text check(length(error)<=500),
 created_at timestamptz not null default now(),
 status_at timestamptz
);
create index wa_messages_conversation on public.wa_messages(conversation_id,created_at);
create index wa_messages_application on public.wa_messages(application_id,created_at);

create table public.wa_outbox(
 id uuid primary key default gen_random_uuid(),
 application_id uuid references public.applications(id),
 purpose text not null check(purpose in('greeting','reopen','manual','auto_reply','bot')),
 to_phone text not null check(length(to_phone) between 3 and 40),
 kind text not null check(kind in('text','template')),
 body text check(length(body) between 1 and 4096),
 template jsonb,
 created_by uuid references public.profiles(id),
 status text not null default 'pending' check(status in('pending','sending','sent','failed','cancelled')),
 attempts int not null default 0,
 next_attempt_at timestamptz not null default now(),
 last_error text check(length(last_error)<=500),
 message_id uuid references public.wa_messages(id),
 created_at timestamptz not null default now(),
 check((kind='text' and body is not null) or (kind='template' and template is not null))
);
create unique index wa_outbox_one_greeting on public.wa_outbox(application_id) where purpose='greeting';
create index wa_outbox_due on public.wa_outbox(next_attempt_at) where status in('pending','sending');

create table public.wa_webhook_events(
 id bigint generated always as identity primary key,
 received_at timestamptz not null default now(),
 payload jsonb not null,
 error text check(length(error)<=500)
);
create index wa_webhook_events_received on public.wa_webhook_events(received_at);

alter table public.wa_settings enable row level security;
alter table public.wa_conversations enable row level security;
alter table public.wa_messages enable row level security;
alter table public.wa_outbox enable row level security;
alter table public.wa_webhook_events enable row level security;
-- Explicit grants: never rely on platform default privileges for these tables.
revoke all on public.wa_settings,public.wa_conversations,public.wa_messages,public.wa_outbox,public.wa_webhook_events from public,anon,authenticated;
grant select,update on public.wa_settings to authenticated;
grant select on public.wa_conversations,public.wa_messages,public.wa_outbox,public.wa_webhook_events to authenticated;
grant select,insert,update on public.wa_settings,public.wa_conversations,public.wa_messages,public.wa_outbox,public.wa_webhook_events to service_role;
create policy wa_settings_read on public.wa_settings for select to authenticated using(is_active());
create policy wa_settings_admin on public.wa_settings for update to authenticated using(is_admin()) with check(is_admin());
create policy wa_conversations_read on public.wa_conversations for select to authenticated using(is_admin() or (application_id is not null and can_access(application_id)));
create policy wa_messages_read on public.wa_messages for select to authenticated using(is_admin() or (application_id is not null and can_access(application_id)));
create policy wa_outbox_admin on public.wa_outbox for select to authenticated using(is_admin());
create policy wa_webhook_events_admin on public.wa_webhook_events for select to authenticated using(is_admin());

-- Web leads with recorded WhatsApp consent get one greeting template, sent by the worker.
create function public.wa_enqueue_greeting() returns trigger language plpgsql security definer set search_path=public as $$
declare s wa_settings;
begin
 select * into s from wa_settings where id=1;
 if s.auto_greeting and new.source='web' and coalesce(trim(new.attribution->>'consent_evidence'),'')<>'' then
  insert into wa_outbox(application_id,purpose,to_phone,kind,template)
  values(new.id,'greeting',new.phone,'template',jsonb_build_object('name',s.greeting_template,'language',s.template_language,'params',jsonb_build_array(coalesce(nullif(split_part(trim(new.full_name),' ',1),''),'¡hola!'))))
  on conflict do nothing;
 end if;
 return new;
end $$;
create trigger zz_wa_greeting after insert on public.applications for each row execute function public.wa_enqueue_greeting();

-- Finds the current case for a WhatsApp number or creates a new WhatsApp-origin case.
create function public.wa_case_for(p_wa_id text,p_name text) returns uuid language plpgsql security definer set search_path=public as $$
declare aid uuid; src uuid;
begin
 select id into aid from applications where phone_wa=p_wa_id and not archived order by created_at desc limit 1;
 if aid is not null then return aid; end if;
 select id into src from client_sources where (id='40000000-0000-4000-8000-000000000003' or lower(name)='whatsapp') and not archived order by (id='40000000-0000-4000-8000-000000000003') desc limit 1;
 insert into applications(full_name,phone,source,source_id,completion,attribution)
 values(coalesce(nullif(left(trim(p_name),200),''),'Contacto de WhatsApp'),'+'||p_wa_id,'whatsapp',src,'parte_1_recibida',jsonb_build_object('channel','whatsapp'))
 returning id into aid;
 return aid;
end $$;

create function public.wa_record_inbound(m jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare c wa_conversations; wa text=m->>'from'; created boolean=false; reopened boolean; s wa_settings; mid uuid; ts timestamptz=coalesce((m->>'timestamp')::timestamptz,now());
begin
 if wa is null or wa !~ '^[1-9][0-9]{7,14}$' then raise exception 'Invalid WhatsApp sender'; end if;
 perform pg_advisory_xact_lock(hashtextextended('wa:'||wa,0));
 if exists(select 1 from wa_messages where wamid=m->>'wamid') then return jsonb_build_object('duplicate',true); end if;
 select * into c from wa_conversations where wa_id=wa for update;
 if not found then
  insert into wa_conversations(wa_id,profile_name) values(wa,left(m->>'profile_name',200)) returning * into c; created=true;
 end if;
 if c.application_id is null or exists(select 1 from applications where id=c.application_id and archived) then
  c.application_id=wa_case_for(wa,coalesce(m->>'profile_name',c.profile_name));
 end if;
 reopened=created or c.last_message_at is null or c.last_message_at<ts-interval '12 hours';
 insert into wa_messages(conversation_id,application_id,wamid,direction,author,kind,body,media,status,created_at)
 values(c.id,c.application_id,m->>'wamid','in','customer',coalesce(m->>'kind','unsupported'),left(coalesce(m->>'body',''),10000),m->'media','received',ts)
 returning id into mid;
 update wa_conversations set application_id=c.application_id,profile_name=coalesce(left(m->>'profile_name',200),profile_name),
  last_inbound_at=greatest(coalesce(last_inbound_at,ts),ts),last_message_at=greatest(coalesce(last_message_at,ts),ts),unread_count=unread_count+1
 where id=c.id;
 select * into s from wa_settings where id=1;
 if reopened and s.auto_reply_enabled and not c.bot_paused and coalesce(m->>'kind','') not in('reaction') then
  insert into wa_outbox(application_id,purpose,to_phone,kind,body) values(c.application_id,'auto_reply','+'||wa,'text',s.auto_reply_text);
 end if;
 return jsonb_build_object('duplicate',false,'conversation_id',c.id,'application_id',c.application_id,'message_id',mid,'new_conversation',created);
end $$;

-- Delivery receipts only move forward (sent < delivered < read); failures are always recorded.
create function public.wa_record_status(p_wamid text,p_status text,p_at timestamptz,p_error text) returns void language plpgsql security definer set search_path=public as $$
begin
 update wa_messages set status=p_status,status_at=coalesce(p_at,now()),error=coalesce(left(p_error,500),error)
 where wamid=p_wamid and (p_status='failed' or array_position(array['sent','delivered','read'],p_status)>coalesce(array_position(array['sent','delivered','read'],status),0));
end $$;

create function public.wa_claim_outbox(n int) returns setof wa_outbox language sql security definer set search_path=public as $$
 update wa_outbox set status='sending',attempts=attempts+1,next_attempt_at=now()
 where id in(select id from wa_outbox where (status='pending' and next_attempt_at<=now()) or (status='sending' and next_attempt_at<=now()-interval '5 minutes')
  order by created_at for update skip locked limit greatest(1,least(n,50)))
 returning *;
$$;

create function public.wa_complete_outbox(p_id uuid,p_wa_id text,p_wamid text,p_error text,p_retry boolean) returns void language plpgsql security definer set search_path=public as $$
declare o wa_outbox; c wa_conversations; mid uuid; author text; body text;
begin
 select * into o from wa_outbox where id=p_id for update;
 if not found or o.status<>'sending' then return; end if;
 if p_error is not null and p_retry and o.attempts<6 then
  update wa_outbox set status='pending',last_error=left(p_error,500),next_attempt_at=now()+make_interval(mins=>power(2,o.attempts)::int) where id=o.id;
  return;
 end if;
 author=case o.purpose when 'manual' then 'human' when 'reopen' then 'human' when 'bot' then 'bot' else 'system' end;
 body=coalesce(o.body,'Plantilla: '||(o.template->>'name'));
 if p_wa_id is not null and p_wa_id ~ '^[1-9][0-9]{7,14}$' then
  insert into wa_conversations(wa_id) values(p_wa_id) on conflict(wa_id) do nothing;
  select * into c from wa_conversations where wa_id=p_wa_id for update;
  if c.application_id is null and o.application_id is not null then update wa_conversations set application_id=o.application_id where id=c.id; c.application_id=o.application_id; end if;
  insert into wa_messages(conversation_id,application_id,wamid,direction,author,author_id,kind,body,status,error)
  values(c.id,coalesce(o.application_id,c.application_id),p_wamid,'out',author,o.created_by,o.kind,body,case when p_error is null then 'sent' else 'failed' end,left(p_error,500))
  returning id into mid;
  update wa_conversations set last_message_at=now(),unread_count=case when o.purpose in('manual','reopen') then 0 else unread_count end where id=c.id;
 end if;
 update wa_outbox set status=case when p_error is null then 'sent' else 'failed' end,last_error=left(p_error,500),message_id=mid where id=o.id;
end $$;

-- Opening a chat in the CRM marks it read, only for people who can access the case.
create function public.wa_mark_read(p_conversation uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 update wa_conversations set unread_count=0 where id=p_conversation and (is_admin() or (application_id is not null and can_access(application_id)));
end $$;

revoke all on function public.wa_number(text),public.wa_enqueue_greeting(),public.wa_case_for(text,text),public.wa_record_inbound(jsonb),public.wa_record_status(text,text,timestamptz,text),public.wa_claim_outbox(int),public.wa_complete_outbox(uuid,text,text,text,boolean),public.wa_mark_read(uuid) from public,anon,authenticated;
grant execute on function public.wa_record_inbound(jsonb),public.wa_record_status(text,text,timestamptz,text),public.wa_claim_outbox(int),public.wa_complete_outbox(uuid,text,text,text,boolean) to service_role;
grant execute on function public.wa_mark_read(uuid) to authenticated;
-- The generated column calls wa_number for any role that writes applications.phone.
grant execute on function public.wa_number(text) to authenticated,service_role;
commit;
