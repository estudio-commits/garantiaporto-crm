-- 023: the team can send audio from the CRM chat: voice notes recorded in the browser (Ogg/Opus,
-- sent as WhatsApp voice notes) and audio files. Audio carries no text. Like other files the team
-- sends, they are kept in the chat (media id) and not filed in Drive.
begin;

alter table public.wa_outbox drop constraint if exists wa_outbox_kind_check;
alter table public.wa_outbox drop constraint if exists wa_outbox_check;
alter table public.wa_outbox add constraint wa_outbox_kind_check
 check(kind in('text','template','image','document','video','audio'));
alter table public.wa_outbox add constraint wa_outbox_check check(
 (kind='text' and body is not null)
 or (kind='template' and template is not null)
 or (kind in('image','document','video','audio') and purpose='manual' and jsonb_typeof(media)='object'
     and coalesce(media->>'id','') ~ '^[A-Za-z0-9_-]{1,100}$'
     and (body is null or (kind<>'audio' and length(body)<=1024))));

create or replace function public.wa_complete_outbox(p_id uuid,p_wa_id text,p_wamid text,p_error text,p_retry boolean) returns void language plpgsql security definer set search_path=public as $$
declare o wa_outbox; c wa_conversations; mid uuid; author text; body text;
begin
 select * into o from wa_outbox where id=p_id for update;
 if not found or o.status<>'sending' then return; end if;
 if p_error is not null and p_retry and o.attempts<6 then
  update wa_outbox set status='pending',last_error=left(p_error,500),next_attempt_at=now()+make_interval(mins=>power(2,o.attempts)::int) where id=o.id;
  return;
 end if;
 author=case o.purpose when 'manual' then 'human' when 'reopen' then 'human' when 'bot' then 'bot' else 'system' end;
 body=case when o.kind='template' then coalesce(o.body,'Plantilla: '||(o.template->>'name')) else coalesce(o.body,'') end;
 if p_wa_id is not null and p_wa_id ~ '^[1-9][0-9]{7,14}$' then
  insert into wa_conversations(wa_id) values(p_wa_id) on conflict(wa_id) do nothing;
  select * into c from wa_conversations where wa_id=p_wa_id for update;
  if c.application_id is null and o.application_id is not null then update wa_conversations set application_id=o.application_id where id=c.id; c.application_id=o.application_id; end if;
  insert into wa_messages(conversation_id,application_id,wamid,direction,author,author_id,kind,body,media,status,error)
  values(c.id,coalesce(o.application_id,c.application_id),p_wamid,'out',author,o.created_by,o.kind,body,
         case when o.kind in('image','document','video','audio') then o.media end,
         case when p_error is null then 'sent' else 'failed' end,left(p_error,500))
  returning id into mid;
  update wa_conversations set last_message_at=now(),unread_count=case when o.purpose in('manual','reopen') then 0 else unread_count end where id=c.id;
 end if;
 update wa_outbox set status=case when p_error is null then 'sent' else 'failed' end,last_error=left(p_error,500),message_id=mid where id=o.id;
end $$;
revoke all on function public.wa_complete_outbox(uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.wa_complete_outbox(uuid,text,text,text,boolean) to service_role;
commit;
