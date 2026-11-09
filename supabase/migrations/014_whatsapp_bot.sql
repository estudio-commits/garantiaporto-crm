begin;
-- Etapa 3: asistente automático de WhatsApp (ver docs/WHATSAPP.md y docs/WHATSAPP-FAQ.md).
-- The assistant runs on the server (service_role). Clients only read state and pause/resume it
-- on conversations they can access.

create or replace function public.wa_valid_numbers(v text[]) returns boolean language sql immutable as $$
 select coalesce(bool_and(x ~ '^[1-9][0-9]{7,14}$'),true) from unnest(v) x;
$$;
alter table public.wa_settings
 add column if not exists bot_enabled boolean not null default false,
 add column if not exists bot_test_mode boolean not null default true,
 add column if not exists bot_test_numbers text[] not null default '{}' check(wa_valid_numbers(bot_test_numbers) and cardinality(bot_test_numbers)<=20),
 add column if not exists handoff_name text not null default 'Lucía Ussumorel' check(length(trim(handoff_name)) between 1 and 100),
 add column if not exists hours_start time not null default '09:00',
 add column if not exists hours_end time not null default '17:00',
 add column if not exists business_days int[] not null default '{1,2,3,4,5}';

alter table public.wa_conversations
 add column if not exists bot_state jsonb not null default '{}',
 add column if not exists bot_turns int not null default 0,
 add column if not exists bot_lock_until timestamptz,
 add column if not exists bot_last_run_at timestamptz,
 add column if not exists handoff_reason text check(length(handoff_reason)<=500);

-- Is the assistant allowed to answer this number right now?
create or replace function public.wa_bot_active(s wa_settings,c wa_conversations) returns boolean language sql stable as $$
 select s.bot_enabled and not c.bot_paused and (not s.bot_test_mode or c.wa_id=any(s.bot_test_numbers));
$$;

-- Same as 012, plus: no generic auto reply when the assistant will answer, and report bot_active.
create or replace function public.wa_record_inbound(m jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare c wa_conversations; wa text=m->>'from'; created boolean=false; reopened boolean; s wa_settings; mid uuid; ts timestamptz=coalesce((m->>'timestamp')::timestamptz,now()); active boolean;
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
 active=wa_bot_active(s,c) and coalesce(m->>'kind','') not in('reaction');
 if reopened and not active and s.auto_reply_enabled and not c.bot_paused and coalesce(m->>'kind','') not in('reaction') then
  insert into wa_outbox(application_id,purpose,to_phone,kind,body) values(c.application_id,'auto_reply','+'||wa,'text',s.auto_reply_text);
 end if;
 return jsonb_build_object('duplicate',false,'conversation_id',c.id,'application_id',c.application_id,'message_id',mid,'new_conversation',created,'bot_active',active);
end $$;

-- A person writing from the CRM takes over the conversation: the assistant pauses.
create or replace function public.wa_human_takeover() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.direction='out' and new.author='human' and new.status<>'failed' then
  update wa_conversations set bot_paused=true,needs_human=false where id=new.conversation_id;
 end if;
 return new;
end $$;
create trigger wa_messages_takeover after insert on public.wa_messages for each row execute function public.wa_human_takeover();

-- One assistant turn at a time per conversation.
create or replace function public.wa_bot_claim(p_conversation uuid) returns boolean language plpgsql security definer set search_path=public as $$
begin
 update wa_conversations set bot_lock_until=now()+interval '90 seconds'
 where id=p_conversation and (bot_lock_until is null or bot_lock_until<now());
 return found;
end $$;

create or replace function public.wa_bot_release(p_conversation uuid,p_state jsonb,p_turn boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 update wa_conversations set bot_lock_until=null,bot_last_run_at=now(),
  bot_state=case when p_state is null then bot_state else bot_state||p_state end,
  bot_turns=bot_turns+case when p_turn then 1 else 0 end
 where id=p_conversation;
end $$;

create or replace function public.wa_bot_handoff(p_conversation uuid,p_reason text) returns void language plpgsql security definer set search_path=public as $$
begin
 update wa_conversations set bot_paused=true,needs_human=true,handoff_reason=left(p_reason,500) where id=p_conversation;
end $$;

-- Case data the assistant may fill. Web cases: only empty fields. WhatsApp-origin cases still
-- untouched by the team may also get a real name and the guarantee type.
create or replace function public.wa_bot_update_case(p_application uuid,f jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a applications; changed text[]='{}'; early boolean;
begin
 select * into a from applications where id=p_application for update;
 if not found then raise exception 'Application not found'; end if;
 early=a.source='whatsapp' and a.contact_status='no_contactado' and a.assigned_user_id is null and not a.archived;
 if nullif(trim(f->>'full_name'),'') is not null and early and length(trim(f->>'full_name')) between 3 and 200 then
  update applications set full_name=trim(f->>'full_name') where id=a.id and full_name is distinct from trim(f->>'full_name');
  if found then changed=array_append(changed,'full_name'); end if;
 end if;
 if f->>'national_id' is not null and a.national_id is null and trim(f->>'national_id') ~ '^([0-9]{6,7}-[0-9]|[0-9]{7,8}|([0-9][.])?[0-9]{3}[.][0-9]{3}-[0-9])$' then
  update applications set national_id=trim(f->>'national_id') where id=a.id; changed=array_append(changed,'national_id');
 end if;
 if f->>'rent_amount' is not null and a.rent_amount is null and (f->>'rent_amount')::numeric between 1 and 1e9 and f->>'rent_currency' in('UYU','USD') then
  update applications set rent_amount=(f->>'rent_amount')::numeric,rent_currency=f->>'rent_currency' where id=a.id; changed=array_append(changed,'rent_amount');
 end if;
 if f->>'guarantee_type' in('tradicional','universitaria','rural') and early and a.guarantee_type is distinct from f->>'guarantee_type' then
  update applications set guarantee_type=f->>'guarantee_type' where id=a.id; changed=array_append(changed,'guarantee_type');
 end if;
 return to_jsonb(changed);
end $$;

-- Pause or resume the assistant on a conversation the caller can access.
create or replace function public.wa_set_bot(p_conversation uuid,p_paused boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 update wa_conversations set bot_paused=p_paused,needs_human=case when p_paused then needs_human else false end,
  handoff_reason=case when p_paused then handoff_reason else null end
 where id=p_conversation and (is_admin() or (application_id is not null and can_access(application_id)));
end $$;

revoke all on function public.wa_bot_active(wa_settings,wa_conversations),public.wa_human_takeover(),public.wa_bot_claim(uuid),public.wa_bot_release(uuid,jsonb,boolean),public.wa_bot_handoff(uuid,text),public.wa_bot_update_case(uuid,jsonb),public.wa_set_bot(uuid,boolean) from public,anon,authenticated;
grant execute on function public.wa_bot_claim(uuid),public.wa_bot_release(uuid,jsonb,boolean),public.wa_bot_handoff(uuid,text),public.wa_bot_update_case(uuid,jsonb) to service_role;
grant execute on function public.wa_set_bot(uuid,boolean) to authenticated;
commit;
