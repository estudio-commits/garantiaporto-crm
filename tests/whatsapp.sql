\set ON_ERROR_STOP on
-- WhatsApp (migration 012). Fictitious data only.
begin;
insert into auth.users(id) values('00000000-0000-4000-8000-0000000000a1'),('00000000-0000-4000-8000-0000000000a2'),('00000000-0000-4000-8000-0000000000a3');
insert into profiles values('00000000-0000-4000-8000-0000000000a1','Admin WA ficticio','admin',true,false),('00000000-0000-4000-8000-0000000000a2','Vendedor WA ficticio','seller',true,false),('00000000-0000-4000-8000-0000000000a3','Otro vendedor ficticio','seller',true,false);
do $$declare r jsonb; aid uuid; ana uuid; o wa_outbox; begin
 if wa_number('099 123 456')<>'59899123456' or wa_number('+598 99 123 456')<>'59899123456' or wa_number('0059899123456')<>'59899123456'
    or wa_number('+54 9 11 1234 5678')<>'5491112345678' or wa_number('2900 0000') is not null or wa_number('abc') is not null or wa_number('+598 2900 0000') is not null then raise exception 'wa_number differs from lib/phone.ts';end if;
 insert into applications(full_name,phone,source,completion,attribution) values('Ana Ficticia','099 000 001','web','parte_1_recibida','{"consent_evidence":"Acepto"}') returning id into ana;
 if (select count(*) from wa_outbox where application_id=ana and purpose='greeting' and template->'params'->>0='Ana')<>1 then raise exception 'Greeting not queued';end if;
 insert into applications(full_name,phone,source,completion) values('Sin Consentimiento','099 000 002','web','parte_1_recibida') returning id into aid;
 if exists(select 1 from wa_outbox where application_id=aid) then raise exception 'Greeting without consent';end if;
 insert into applications(full_name,phone,national_id) values('Manual Ficticio','099 000 004','1234567-8') returning id into aid;
 if exists(select 1 from wa_outbox where application_id=aid) then raise exception 'Greeting for manual case';end if;

 r=wa_record_inbound('{"wamid":"wamid.T1","from":"59899000003","profile_name":"Bruno Ficticio","kind":"text","body":"Hola, quiero una garantía","timestamp":"2026-11-07T12:00:00Z"}');
 aid=(r->>'application_id')::uuid;
 if (select source from applications where id=aid)<>'whatsapp' or (select source_id from applications where id=aid)<>'40000000-0000-4000-8000-000000000003' or (select full_name from applications where id=aid)<>'Bruno Ficticio' then raise exception 'WhatsApp case not created';end if;
 if (select count(*) from wa_outbox where application_id=aid and purpose='auto_reply')<>1 then raise exception 'Auto reply missing';end if;
 if not (wa_record_inbound('{"wamid":"wamid.T1","from":"59899000003","kind":"text","body":"Hola"}')->>'duplicate')::boolean then raise exception 'Duplicate not detected';end if;
 perform wa_record_inbound('{"wamid":"wamid.T2","from":"59899000003","kind":"text","body":"¿Siguen ahí?","timestamp":"2026-11-07T12:05:00Z"}');
 if (select count(*) from wa_outbox where application_id=aid and purpose='auto_reply')<>1 then raise exception 'Auto reply repeated';end if;
 if (select unread_count from wa_conversations where wa_id='59899000003')<>2 then raise exception 'Unread count';end if;
 if (select count(*) from applications where phone_wa='59899000003')<>1 then raise exception 'Second message created another case';end if;
 begin perform wa_record_inbound('{"wamid":"wamid.BAD","from":"abc","kind":"text"}');raise exception 'Invalid sender accepted';exception when raise_exception then if sqlerrm='Invalid sender accepted' then raise;end if;end;

 r=wa_record_inbound('{"wamid":"wamid.T3","from":"59899000001","kind":"text","body":"Soy Ana"}');
 if (r->>'application_id')::uuid<>ana then raise exception 'Known number not linked to existing case';end if;

 -- Outbox: claim, successful delivery and receipts.
 select * into o from wa_claim_outbox(10) where application_id=ana and purpose='greeting';
 if o.id is null or o.status<>'sending' or o.attempts<>1 then raise exception 'Greeting not claimed';end if;
 if exists(select 1 from wa_claim_outbox(10) where id=o.id) then raise exception 'Claimed twice';end if;
 perform wa_complete_outbox(o.id,'59899000001','wamid.OUT1',null,false);
 if (select status from wa_outbox where id=o.id)<>'sent' or not exists(select 1 from wa_messages where wamid='wamid.OUT1' and direction='out' and author='system' and application_id=ana and status='sent') then raise exception 'Greeting not recorded';end if;
 perform wa_record_status('wamid.OUT1','read',now(),null);
 perform wa_record_status('wamid.OUT1','delivered',now(),null);
 if (select status from wa_messages where wamid='wamid.OUT1')<>'read' then raise exception 'Receipt regressed';end if;
 perform wa_record_status('wamid.OUT1','failed',now(),'131026 Mensaje no entregable');
 if (select status from wa_messages where wamid='wamid.OUT1')<>'failed' then raise exception 'Failure not recorded';end if;

 -- Retry, then permanent failure.
 -- The earlier claim (limit 10) also took the auto reply.
 select * into o from wa_outbox where application_id=aid and purpose='auto_reply';
 if o.status is distinct from 'sending' then raise exception 'Auto reply not claimed with the batch';end if;
 perform wa_complete_outbox(o.id,'59899000003',null,'HTTP 503',true);
 if (select status from wa_outbox where id=o.id) is distinct from 'pending' or (select next_attempt_at from wa_outbox where id=o.id)<=now() then raise exception 'Retry not scheduled';end if;
 update wa_outbox set next_attempt_at=now()-interval '1 minute' where id=o.id;
 select * into o from wa_claim_outbox(10) where id=o.id;
 if o.id is null then raise exception 'Retry not reclaimed';end if;
 perform wa_complete_outbox(o.id,'59899000003',null,'131047 Ventana cerrada',false);
 if (select status from wa_outbox where id=o.id)<>'failed' or not exists(select 1 from wa_messages where application_id=aid and direction='out' and status='failed' and error like '131047%') then raise exception 'Permanent failure not visible';end if;

 update applications set assigned_user_id='00000000-0000-4000-8000-0000000000a2' where id=ana;
end $$;

-- Etapa 2 (migration 013): documents are queued for Drive, links recorded, case folder set once.
do $$declare r jsonb; m uuid; ana uuid=(select id from applications where full_name='Ana Ficticia'); begin
 r=wa_record_inbound('{"wamid":"wamid.DOC1","from":"59899000001","kind":"document","body":"recibo.pdf","media":{"id":"MEDIA1","mime_type":"application/pdf","filename":"recibo.pdf"}}');
 m=(r->>'message_id')::uuid;
 if (select media_status from wa_messages where id=m) is distinct from 'pending' then raise exception 'Document not queued for Drive';end if;
 perform wa_record_inbound('{"wamid":"wamid.AUD1","from":"59899000001","kind":"audio","media":{"id":"MEDIA2"}}');
 if (select media_status from wa_messages where wamid='wamid.AUD1') is not null then raise exception 'Audio queued for Drive';end if;
 if not exists(select 1 from wa_claim_media(5) where id=m) then raise exception 'Media not claimed';end if;
 begin perform wa_complete_media(m,'stored','F1','https://evil.example/x',null,null,false);raise exception 'Non-Drive URL accepted';exception when raise_exception then if sqlerrm='Non-Drive URL accepted' then raise;end if;end;
 perform wa_complete_media(m,'stored','F1','https://drive.google.com/file/d/F1/view','https://drive.google.com/drive/folders/NEWFOLDER123',null,false);
 if (select media->>'drive_url' from wa_messages where id=m) is distinct from 'https://drive.google.com/file/d/F1/view' or (select drive_folder_url from applications where id=ana) is distinct from 'https://drive.google.com/drive/folders/NEWFOLDER123' then raise exception 'Drive result not recorded';end if;
 r=wa_record_inbound('{"wamid":"wamid.DOC2","from":"59899000001","kind":"image","media":{"id":"MEDIA3","mime_type":"image/jpeg"}}');
 m=(r->>'message_id')::uuid;
 perform wa_claim_media(5);
 perform wa_complete_media(m,'stored','F2','https://drive.google.com/file/d/F2/view','https://drive.google.com/drive/folders/OTHER9999999',null,false);
 if (select drive_folder_url from applications where id=ana) is distinct from 'https://drive.google.com/drive/folders/NEWFOLDER123' then raise exception 'Case folder overwritten';end if;
 r=wa_record_inbound('{"wamid":"wamid.DOC3","from":"59899000001","kind":"document","media":{"id":"MEDIA4"}}');
 m=(r->>'message_id')::uuid;
 perform wa_claim_media(5);
 perform wa_complete_media(m,'failed',null,null,null,'Error temporal',true);
 if (select media_status from wa_messages where id=m) is distinct from 'pending' then raise exception 'Media retry not scheduled';end if;
 update wa_messages set media_next_at=now()-interval '1 minute' where id=m;
 perform wa_claim_media(5);
 perform wa_complete_media(m,'failed',null,null,null,'La carpeta no existe',false);
 if (select media_status from wa_messages where id=m) is distinct from 'failed' then raise exception 'Media failure not recorded';end if;
 perform set_config('test.doc3',m::text,false);
end $$;
-- Seller A sees only the conversation of the case assigned to them; client roles cannot write.
set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a2';
set local role authenticated;
do $$declare c uuid; begin
 if (select count(*) from wa_conversations)<>1 or exists(select 1 from wa_messages where application_id<>(select id from applications where full_name='Ana Ficticia')) then raise exception 'WhatsApp RLS leak';end if;
 if not exists(select 1 from wa_messages where body='Soy Ana') then raise exception 'Assigned seller cannot read chat';end if;
 if exists(select 1 from wa_outbox) or exists(select 1 from wa_webhook_events) then raise exception 'Seller reads outbox or webhook log';end if;
 select id into c from wa_conversations;
 perform wa_mark_read(c);
 if (select unread_count from wa_conversations where id=c)<>0 then raise exception 'Mark read failed';end if;
 begin insert into wa_messages(conversation_id,direction,author,kind,status) values(c,'out','human','text','sent');raise exception 'Seller forged message';exception when insufficient_privilege then null;end;
 begin update wa_conversations set bot_paused=true where id=c;raise exception 'Seller updated conversation';exception when insufficient_privilege then null;end;
 begin perform wa_record_inbound('{"wamid":"wamid.X","from":"59899000009","kind":"text"}');raise exception 'Seller called server function';exception when insufficient_privilege then null;end;
 begin perform wa_claim_outbox(1);raise exception 'Seller claimed outbox';exception when insufficient_privilege then null;end;
 update wa_settings set auto_greeting=false;
 if not (select auto_greeting from wa_settings) then raise exception 'Seller changed settings';end if;
 begin perform phone_wa from applications limit 1;raise exception 'Seller reads phone_wa';exception when insufficient_privilege then null;end;
 perform wa_retry_media(current_setting('test.doc3')::uuid);
 if (select media_status from wa_messages where id=current_setting('test.doc3')::uuid) is distinct from 'pending' then raise exception 'Assigned seller cannot retry upload';end if;
 begin perform wa_claim_media(1);raise exception 'Seller claimed media';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a3';
set local role authenticated;
do $$declare c uuid; begin
 if exists(select 1 from wa_conversations) or exists(select 1 from wa_messages) then raise exception 'Other seller sees chats';end if;
 select id into c from wa_conversations limit 1;
end $$;
reset role;
do $$begin
 update wa_conversations set unread_count=3 where wa_id='59899000001';
 update wa_messages set media_status='failed' where id=current_setting('test.doc3')::uuid;
end $$;
set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a3';
set local role authenticated;
do $$begin perform wa_mark_read((select id from wa_conversations where wa_id='59899000001'));perform wa_retry_media(current_setting('test.doc3')::uuid);end $$;
reset role;
do $$begin
 if (select unread_count from wa_conversations where wa_id='59899000001')<>3 then raise exception 'Other seller marked chat read';end if;
 if (select media_status from wa_messages where id=current_setting('test.doc3')::uuid) is distinct from 'failed' then raise exception 'Other seller retried upload';end if;
end $$;
set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a1';
set local role authenticated;
do $$begin
 if (select count(*) from wa_conversations)<2 or not exists(select 1 from wa_outbox) then raise exception 'Admin cannot see WhatsApp data';end if;
 update wa_settings set auto_reply_text='Texto ficticio de prueba';
 if (select auto_reply_text from wa_settings)<>'Texto ficticio de prueba' then raise exception 'Admin cannot edit settings';end if;
end $$;
reset role;
-- New cases queue their Drive folder; completion stores the link once and never overwrites it.
do $$declare aid uuid; n int; begin
 insert into applications(full_name,phone,national_id) values('Carpeta Ficticia','099 000 010','1234567-8') returning id into aid;
 if not exists(select 1 from drive_folder_queue where application_id=aid and status='pending') then raise exception 'Case folder not queued';end if;
 select count(*) into n from claim_case_folders(20) where application_id=aid and national_id='12345678';
 if n<>1 then raise exception 'Case folder not claimed';end if;
 perform complete_case_folder(aid,null,'Error temporal de Drive',true);
 if (select status from drive_folder_queue where application_id=aid)<>'pending' then raise exception 'Folder retry not scheduled';end if;
 update drive_folder_queue set next_at=now()-interval '1 minute' where application_id=aid;
 perform claim_case_folders(20);
 perform complete_case_folder(aid,'https://drive.google.com/drive/folders/CASEFOLDER123',null,false);
 if (select drive_folder_url from applications where id=aid)<>'https://drive.google.com/drive/folders/CASEFOLDER123' or (select status from drive_folder_queue where application_id=aid)<>'done' then raise exception 'Case folder not stored';end if;
 insert into applications(full_name,phone,national_id,drive_folder_url) values('Con Carpeta','099 000 011','1234567-8','https://drive.google.com/drive/folders/MANUAL123456') returning id into aid;
 if exists(select 1 from drive_folder_queue where application_id=aid) then raise exception 'Folder queued for case with folder';end if;
end $$;
set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a2';
set local role authenticated;
do $$begin
 if exists(select 1 from drive_folder_queue) then raise exception 'Seller reads folder queue';end if;
 begin perform claim_case_folders(1);raise exception 'Seller claimed folders';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
\echo 'WhatsApp checks passed'
