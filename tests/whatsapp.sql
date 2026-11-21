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
 -- Migration 021: voice notes are filed too; videos stay in the chat.
 if (select media_status from wa_messages where wamid='wamid.AUD1') is distinct from 'pending' then raise exception 'Voice note not queued for Drive';end if;
 perform wa_record_inbound('{"wamid":"wamid.VID1","from":"59899000001","kind":"video","media":{"id":"MEDIA3"}}');
 if (select media_status from wa_messages where wamid='wamid.VID1') is not null then raise exception 'Video queued for Drive';end if;
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
 perform wa_mark_unread(c);
 if (select unread_count from wa_conversations where id=c)<>1 then raise exception 'Mark unread failed';end if;
 perform wa_mark_read(c);
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
 update wa_conversations set unread_count=0 where wa_id='59899000001';
 perform set_config('test.conv1',(select id from wa_conversations where wa_id='59899000001')::text,true);
end $$;
-- The id is passed directly: RLS would hide it from this seller anyway, the function must check too.
set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a3';
set local role authenticated;
do $$begin perform wa_mark_unread(current_setting('test.conv1')::uuid);end $$;
reset role;
do $$begin
 if (select unread_count from wa_conversations where wa_id='59899000001')<>0 then raise exception 'Other seller marked chat unread';end if;
 update wa_conversations set unread_count=3 where wa_id='59899000001';
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
 -- Migration 015: a case whose folder was created before the CI arrived is queued again to rename it.
 insert into applications(full_name,phone) values('Sin Cedula Ficticia','099 000 012') returning id into aid;
 perform claim_case_folders(20);
 perform complete_case_folder(aid,'https://drive.google.com/drive/folders/LATECI123456',null,false);
 if (select status from drive_folder_queue where application_id=aid)<>'done' then raise exception 'Folder without CI not stored';end if;
 update applications set summary='Sin cambio de cédula' where id=aid;
 if (select status from drive_folder_queue where application_id=aid)<>'done' then raise exception 'Folder requeued without CI change';end if;
 update applications set national_id='2345678-9' where id=aid;
 if (select status from drive_folder_queue where application_id=aid)<>'pending' then raise exception 'Folder not requeued after CI arrived';end if;
 select count(*) into n from claim_case_folders(20) where application_id=aid and national_id='23456789' and drive_folder_url like '%LATECI123456';
 if n<>1 then raise exception 'Folder rename not claimed';end if;
 perform complete_case_folder(aid,'https://drive.google.com/drive/folders/LATECI123456',null,false);
 if (select status from drive_folder_queue where application_id=aid)<>'done' then raise exception 'Folder rename not completed';end if;
end $$;
set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a2';
set local role authenticated;
do $$begin
 if exists(select 1 from drive_folder_queue) then raise exception 'Seller reads folder queue';end if;
 begin perform claim_case_folders(1);raise exception 'Seller claimed folders';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Etapa 3 (migration 014): assistant activation, takeover, locks and case-update rules.
do $$declare r jsonb; c uuid; aid uuid; begin
 update wa_settings set bot_enabled=true,bot_test_mode=true,bot_test_numbers='{59899000020}',auto_reply_enabled=true;
 r=wa_record_inbound('{"wamid":"wamid.BOT1","from":"59899000020","profile_name":"Bot Ficticio","kind":"text","body":"Hola"}');
 if not (r->>'bot_active')::boolean then raise exception 'Bot not active for test number';end if;
 c=(r->>'conversation_id')::uuid; aid=(r->>'application_id')::uuid;
 if exists(select 1 from wa_outbox where application_id=aid and purpose='auto_reply') then raise exception 'Auto reply sent while bot active';end if;
 r=wa_record_inbound('{"wamid":"wamid.BOT2","from":"59899000021","kind":"text","body":"Hola"}');
 if (r->>'bot_active')::boolean then raise exception 'Bot active outside test list';end if;
 if not exists(select 1 from wa_outbox where application_id=(r->>'application_id')::uuid and purpose='auto_reply') then raise exception 'Auto reply missing outside test list';end if;
 begin update wa_settings set bot_test_numbers='{abc}';raise exception 'Invalid test number accepted';exception when check_violation then null;end;
 if not wa_bot_claim(c) then raise exception 'Claim failed';end if;
 if wa_bot_claim(c) then raise exception 'Double claim';end if;
 perform wa_bot_release(c,'{"income_profile":"empleado"}',true);
 if (select bot_turns from wa_conversations where id=c)<>1 or (select bot_state->>'income_profile' from wa_conversations where id=c)<>'empleado' or (select bot_lock_until from wa_conversations where id=c) is not null then raise exception 'Release state';end if;
 perform wa_bot_update_case(aid,'{"full_name":"Bruno Ficticio Pérez","rent_amount":25000,"rent_currency":"UYU","guarantee_type":"universitaria","national_id":"1.234.567-2"}');
 if (select full_name from applications where id=aid)<>'Bruno Ficticio Pérez' or (select guarantee_type from applications where id=aid)<>'universitaria' or (select rent_amount from applications where id=aid)<>25000 or (select national_id from applications where id=aid)<>'12345672' then raise exception 'Bot case update failed';end if;
 perform wa_bot_update_case(aid,'{"rent_amount":99999,"rent_currency":"USD","national_id":"7.654.321-0"}');
 if (select rent_amount from applications where id=aid)<>25000 or (select rent_currency from applications where id=aid)<>'UYU' or (select national_id from applications where id=aid)<>'12345672' then raise exception 'Bot overwrote case data';end if;
 perform wa_bot_update_case((select id from applications where full_name='Ana Ficticia'),'{"full_name":"Otro Nombre","guarantee_type":"rural"}');
 if not exists(select 1 from applications where full_name='Ana Ficticia' and guarantee_type<>'rural') then raise exception 'Bot changed a web case';end if;
 -- Migration 017: income declared in the chat fills an empty value only.
 perform wa_bot_update_case(aid,'{"monthly_income":60000}');
 if (select monthly_income from application_sensitive where application_id=aid)<>60000 then raise exception 'Bot did not store declared income';end if;
 perform wa_bot_update_case(aid,'{"monthly_income":90000}');
 if (select monthly_income from application_sensitive where application_id=aid)<>60000 then raise exception 'Bot overwrote income';end if;
 perform wa_bot_update_case(aid,'{"monthly_income":"60000; drop table notes"}');
 perform wa_bot_update_case(aid,'{"monthly_income":-5}');
 perform wa_bot_update_case(aid,'{"student_count":3}');
 if (select student_count from applications where id=aid) is distinct from 3 then raise exception 'Bot did not store students';end if;
 perform wa_bot_update_case(aid,'{"student_count":2}');
 if (select student_count from applications where id=aid) is distinct from 3 then raise exception 'Bot overwrote students';end if;
 begin update applications set student_count=40 where id=aid; raise exception 'Student count out of range accepted'; exception when check_violation then null; end;
 insert into wa_messages(conversation_id,application_id,direction,author,kind,body,status) values(c,aid,'out','human','text','Hola, soy Lucía','sent');
 if not (select bot_paused from wa_conversations where id=c) then raise exception 'Human takeover did not pause bot';end if;
 r=wa_record_inbound('{"wamid":"wamid.BOT3","from":"59899000020","kind":"text","body":"Gracias"}');
 if (r->>'bot_active')::boolean then raise exception 'Bot active after takeover';end if;
 perform wa_bot_handoff(c,'Prueba de derivación');
 if not (select needs_human from wa_conversations where id=c) then raise exception 'Handoff flag missing';end if;
 perform set_config('test.botconv',c::text,false);
end $$;
set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a2';
set local role authenticated;
do $$begin
 perform wa_set_bot(current_setting('test.botconv')::uuid,false);
 begin perform wa_bot_claim(current_setting('test.botconv')::uuid);raise exception 'Seller claimed bot turn';exception when insufficient_privilege then null;end;
 begin perform wa_bot_update_case(gen_random_uuid(),'{}');raise exception 'Seller updated case via bot';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$begin if not (select bot_paused from wa_conversations where id=current_setting('test.botconv')::uuid) then raise exception 'Seller without access resumed bot';end if;end $$;
set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a1';
set local role authenticated;
do $$begin
 perform wa_set_bot(current_setting('test.botconv')::uuid,false);
 if (select bot_paused or needs_human from wa_conversations where id=current_setting('test.botconv')::uuid) then raise exception 'Admin could not resume bot';end if;
 update wa_settings set bot_enabled=false;
end $$;
reset role;
-- Migration 016: WhatsApp consent stored on the case; team messages add one history entry per day.
do $$declare aid uuid; other uuid; c uuid; begin
 insert into applications(full_name,phone,source,completion,attribution) values('Consentimiento Web','099 000 020','web','parte_1_recibida','{"consent_evidence":"Acepto"}') returning id into aid;
 if not (select wa_consent from applications where id=aid) then raise exception 'Web consent not stored';end if;
 insert into applications(full_name,phone,national_id) values('Escribe Primero','099 000 061','3456789-0') returning id into aid;
 if (select wa_consent from applications where id=aid) then raise exception 'Consent without evidence';end if;
 perform wa_record_inbound('{"wamid":"wamid.C016","from":"59899000061","kind":"text","body":"Hola"}');
 if not (select wa_consent from applications where id=aid) then raise exception 'Inbound message did not record consent';end if;
 select id into c from wa_conversations where wa_id='59899000061';
 if exists(select 1 from notes where application_id=aid) then raise exception 'Inbound message created a history entry';end if;
 insert into wa_messages(conversation_id,application_id,direction,author,author_id,kind,body,status) values
  (c,aid,'out','human','00000000-0000-4000-8000-0000000000a1','text','Primera respuesta','sent'),
  (c,aid,'out','human','00000000-0000-4000-8000-0000000000a1','text','Segunda respuesta','sent'),
  (c,aid,'out','bot',null,'text','Respuesta del asistente','sent');
 if (select count(*) from notes where application_id=aid and kind='comunicacion' and body like 'WhatsApp:%' and author_id='00000000-0000-4000-8000-0000000000a1')<>1 then raise exception 'Team messages must add exactly one history entry per day';end if;
 insert into applications(full_name,phone,national_id) values('Envio Fallido','099 000 062','4567890-1') returning id into other;
 insert into wa_messages(conversation_id,application_id,direction,author,author_id,kind,body,status) values(c,other,'out','human','00000000-0000-4000-8000-0000000000a1','text','No llegó','failed');
 if exists(select 1 from notes where application_id=other) then raise exception 'Failed message added a history entry';end if;
 perform set_config('test.consentcase',aid::text,true);
end $$;
set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a1';
set local role authenticated;
do $$begin
 if not (select wa_consent from applications where id=current_setting('test.consentcase')::uuid) then raise exception 'Admin cannot read consent';end if;
 update applications set wa_consent=false where id=current_setting('test.consentcase')::uuid;
end $$;
reset role;
do $$begin
 if not exists(select 1 from audit_log where application_id=current_setting('test.consentcase')::uuid and changes ? 'wa_consent' and actor_name='Admin WA ficticio') then raise exception 'Consent change not audited';end if;
end $$;
-- Migration 022: photos, PDFs and videos sent from the CRM chat.
do $$declare aid uuid; o wa_outbox; m wa_messages; begin
 insert into applications(full_name,phone,national_id) values('Envio Archivo','099 000 063','5678901-2') returning id into aid;
 insert into wa_outbox(application_id,purpose,to_phone,kind,body,media,created_by)
 values(aid,'manual','+59899000063','document','Te mando el contrato','{"id":"MEDIA_022","filename":"Contrato.pdf","mime_type":"application/pdf"}','00000000-0000-4000-8000-0000000000a1')
 returning * into o;
 begin insert into wa_outbox(application_id,purpose,to_phone,kind) values(aid,'manual','+59899000063','image');raise exception 'Media row without media id';exception when check_violation then null;end;
 begin insert into wa_outbox(application_id,purpose,to_phone,kind,media) values(aid,'manual','+59899000063','image','{"id":"../x"}');raise exception 'Unsafe media id accepted';exception when check_violation then null;end;
 begin insert into wa_outbox(application_id,purpose,to_phone,kind,media) values(aid,'bot','+59899000063','image','{"id":"MEDIA_1"}');raise exception 'Only the team sends files';exception when check_violation then null;end;
 begin insert into wa_outbox(application_id,purpose,to_phone,kind,media) values(aid,'manual','+59899000063','sticker','{"id":"MEDIA_1"}');raise exception 'Sticker kind accepted';exception when check_violation then null;end;
 select * into o from wa_claim_outbox(10) where id=o.id;
 if o.media->>'id'<>'MEDIA_022' then raise exception 'Claim lost the media';end if;
 perform wa_complete_outbox(o.id,'59899000063','wamid.OUT022',null,false);
 select * into m from wa_messages where wamid='wamid.OUT022';
 if m.kind<>'document' or m.body<>'Te mando el contrato' or m.media->>'id'<>'MEDIA_022' or m.direction<>'out' or m.author<>'human' then raise exception 'Sent file not recorded: %',row_to_json(m);end if;
 if m.media_status is not null then raise exception 'Sent file queued for Drive';end if;
 -- A photo without caption is recorded with an empty text, never as "Plantilla: …".
 insert into wa_outbox(application_id,purpose,to_phone,kind,media,created_by)
 values(aid,'manual','+59899000063','image','{"id":"MEDIA_023","mime_type":"image/jpeg"}','00000000-0000-4000-8000-0000000000a1') returning * into o;
 select * into o from wa_claim_outbox(10) where id=o.id;
 perform wa_complete_outbox(o.id,'59899000063','wamid.OUT023',null,false);
 if (select body from wa_messages where wamid='wamid.OUT023')<>'' then raise exception 'Photo without caption got a text';end if;
 -- Templates still read "Plantilla: name".
 if not exists(select 1 from wa_messages where wamid='wamid.OUT1' and body like 'Plantilla: %') then raise exception 'Template text changed';end if;
end $$;
-- Migration 023: voice notes and audio files sent from the CRM chat (no text).
do $$declare aid uuid; o wa_outbox; m wa_messages; begin
 select id into aid from applications where full_name='Envio Archivo';
 begin insert into wa_outbox(application_id,purpose,to_phone,kind,body,media) values(aid,'manual','+59899000063','audio','Hola','{"id":"AUDIO_1"}');raise exception 'Audio with text accepted';exception when check_violation then null;end;
 insert into wa_outbox(application_id,purpose,to_phone,kind,media,created_by)
 values(aid,'manual','+59899000063','audio','{"id":"AUDIO_023","mime_type":"audio/ogg","filename":"Nota de voz.ogg","voice":true}','00000000-0000-4000-8000-0000000000a1') returning * into o;
 select * into o from wa_claim_outbox(10) where id=o.id;
 perform wa_complete_outbox(o.id,'59899000063','wamid.OUT024',null,false);
 select * into m from wa_messages where wamid='wamid.OUT024';
 if m.kind<>'audio' or m.body<>'' or (m.media->>'voice')::boolean is not true or m.author<>'human' then raise exception 'Voice note not recorded: %',row_to_json(m);end if;
 if m.media_status is not null then raise exception 'Team voice note queued for Drive';end if;
end $$;
-- Migration 025: a team member's WhatsApp message moves the case to "En contacto", audited as that person.
do $$declare aid uuid; arch uuid; fin uuid; c uuid; begin
 perform set_config('request.jwt.claim.sub','',true); -- as the webhook/worker: no signed-in user
 insert into applications(full_name,phone,national_id) values('Contacto Nuevo','099 000 064','6789012-3') returning id into aid;
 insert into applications(full_name,phone,national_id,archived) values('Contacto Archivado','099 000 065','7890123-4',true) returning id into arch;
 insert into applications(full_name,phone,national_id,stage,follow_up_date) values('Contacto Finalizado','099 000 066','8901234-5','finalizado',(now() at time zone 'America/Montevideo')::date+7) returning id into fin;
 perform wa_record_inbound('{"wamid":"wamid.C025","from":"59899000064","kind":"text","body":"Hola"}');
 select id into c from wa_conversations where wa_id='59899000064';
 insert into wa_messages(conversation_id,application_id,direction,author,author_id,kind,body,status) values
  (c,aid,'out','bot',null,'text','Respuesta del asistente','sent'),
  (c,aid,'out','human','00000000-0000-4000-8000-0000000000a1','text','Envío fallido','failed');
 if (select stage from applications where id=aid)<>'nuevo' then raise exception 'Bot or failed message moved the case';end if;
 insert into wa_messages(conversation_id,application_id,direction,author,author_id,kind,body,status)
  values(c,aid,'out','human','00000000-0000-4000-8000-0000000000a1','text','Hola, te escribo del equipo','sent');
 if (select stage||'/'||contact_status from applications where id=aid)<>'en_contacto/contactado' then raise exception 'Team message did not mark contact: %',(select stage||'/'||contact_status from applications where id=aid);end if;
 if (select first_contact_by from applications where id=aid) is distinct from '00000000-0000-4000-8000-0000000000a1'::uuid then raise exception 'First contact not attributed';end if;
 if not exists(select 1 from audit_log where application_id=aid and changes->'stage'->>'after'='en_contacto' and actor_name='Admin WA ficticio') then raise exception 'Stage change not audited as the team member';end if;
 if coalesce(current_setting('request.jwt.claim.sub',true),'')<>'' then raise exception 'Acting user leaked: %',current_setting('request.jwt.claim.sub',true);end if;
 insert into wa_messages(conversation_id,application_id,direction,author,author_id,kind,body,status) values
  (c,arch,'out','human','00000000-0000-4000-8000-0000000000a1','text','Archivado','sent'),
  (c,fin,'out','human','00000000-0000-4000-8000-0000000000a1','text','Finalizado','sent');
 if (select stage from applications where id=arch)<>'nuevo' then raise exception 'Archived case moved';end if;
 if (select stage||'/'||contact_status from applications where id=fin)<>'finalizado/contactado' then raise exception 'Finalized case reopened: %',(select stage from applications where id=fin);end if;
end $$;
-- Migration 025 backfill: cases written to before the migration.
alter table wa_messages disable trigger zz_wa_message_effects;
do $$declare aid uuid; c uuid; begin
 insert into applications(full_name,phone,national_id) values('Contacto Anterior','099 000 067','9012345-6') returning id into aid;
 perform wa_record_inbound('{"wamid":"wamid.C025b","from":"59899000067","kind":"text","body":"Hola"}');
 select id into c from wa_conversations where wa_id='59899000067';
 insert into wa_messages(conversation_id,application_id,direction,author,author_id,kind,body,status)
  values(c,aid,'out','human','00000000-0000-4000-8000-0000000000a2','text','Mensaje anterior','sent');
 if (select stage from applications where id=aid)<>'nuevo' then raise exception 'Setup: trigger still active';end if;
 perform set_config('test.backfill',aid::text,true);
end $$;
alter table wa_messages enable trigger zz_wa_message_effects;
do $$declare r record; begin
 for r in
  select distinct on (a.id) a.id,m.author_id
  from applications a join wa_messages m on m.application_id=a.id
  where not a.archived and (a.contact_status='no_contactado' or a.stage='nuevo')
    and m.direction='out' and m.author_id is not null and m.status<>'failed'
  order by a.id,m.created_at
 loop
  perform wa_mark_contacted(r.id,r.author_id);
 end loop;
end $$;
do $$begin
 if (select stage||'/'||contact_status from applications where id=current_setting('test.backfill')::uuid)<>'en_contacto/contactado' then raise exception 'Backfill did not mark contact';end if;
 if not exists(select 1 from audit_log where application_id=current_setting('test.backfill')::uuid and changes->'stage'->>'after'='en_contacto' and actor_name='Vendedor WA ficticio') then raise exception 'Backfill not attributed to the first writer';end if;
end $$;
-- Migration 026: response turns (same rule as responseTurns in lib/analytics.ts) and attention hours.
do $$declare aid uuid; c uuid; t0 timestamptz='2026-11-20 13:00:00+00'; got text; begin
 insert into applications(full_name,phone,national_id,assigned_user_id) values('Tiempos Respuesta','099 000 068','1123456-7','00000000-0000-4000-8000-0000000000a2') returning id into aid;
 insert into wa_conversations(wa_id,application_id) values('59899000068',aid) returning id into c;
 insert into wa_messages(conversation_id,application_id,direction,author,author_id,kind,body,status,created_at) values
  (c,aid,'in','customer',null,'text','uno','received',t0),
  (c,aid,'in','customer',null,'text','dos','received',t0+interval '5 min'),
  (c,aid,'out','bot',null,'text','asistente','sent',t0+interval '6 min'),
  (c,aid,'out','human','00000000-0000-4000-8000-0000000000a1','text','fallido','failed',t0+interval '20 min'),
  (c,aid,'out','human','00000000-0000-4000-8000-0000000000a1','text','respuesta','sent',t0+interval '30 min'),
  (c,aid,'out','human','00000000-0000-4000-8000-0000000000a1','text','otra','sent',t0+interval '31 min'),
  (c,aid,'in','customer',null,'text','tres','received',t0+interval '60 min'),
  (c,aid,'out','human','00000000-0000-4000-8000-0000000000a2','text','respuesta 2','sent',t0+interval '120 min'),
  (c,aid,'in','customer',null,'text','cuatro','received',t0+interval '180 min');
 select string_agg(to_char(asked_at at time zone 'UTC','HH24:MI')||'>'||coalesce(to_char(answered_at at time zone 'UTC','HH24:MI'),'-')||'>'||coalesce(right(author_id::text,2),'-'),' ' order by asked_at)
 into got from wa_response_turns(t0-interval '1 day') where application_id=aid;
 if got<>'13:00>13:30>a1 14:00>15:00>a2 16:00>->-' then raise exception 'Response turns: %',got;end if;
 perform set_config('test.timescase',aid::text,true);
end $$;
set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a3';
set local role authenticated;
do $$begin
 if exists(select 1 from wa_response_turns('2026-11-19') where application_id=current_setting('test.timescase')::uuid) then raise exception 'Other seller sees response turns';end if;
 if (select hours_start from wa_business_hours())<>'09:00'::time then raise exception 'Attention hours not readable';end if;
end $$;
set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a2';
do $$begin
 if (select count(*) from wa_response_turns('2026-11-19') where application_id=current_setting('test.timescase')::uuid)<>3 then raise exception 'Assigned seller cannot see own response turns';end if;
end $$;
reset role;
-- Migration 027: weekly learning proposals; only administration reads and decides them.
do $$declare l uuid; begin
 insert into wa_bot_lessons(kind,question,answer,reason,evidence,week) values('pregunta','¿Se aceptan mascotas?','No depende de la garantía.','Derivó 3 veces',3,'2026-11-16') returning id into l;
 begin insert into wa_bot_lessons(kind,answer,week) values('pregunta','Sin pregunta','2026-11-16');raise exception 'Question lesson without question';exception when check_violation then null;end;
 insert into wa_bot_learning_runs(week,status) values('2026-11-16','lista');
 perform set_config('test.lesson',l::text,true);
end $$;
set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a2';
set local role authenticated;
do $$begin
 if exists(select 1 from wa_bot_lessons) or exists(select 1 from wa_bot_learning_runs) then raise exception 'Seller reads learning';end if;
 update wa_bot_lessons set status='aprobada' where id=current_setting('test.lesson')::uuid;
 begin insert into wa_bot_lessons(kind,question,answer,week) values('pregunta','x','y','2026-11-16');raise exception 'Seller inserted lesson';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$begin if (select status from wa_bot_lessons where id=current_setting('test.lesson')::uuid)<>'propuesta' then raise exception 'Seller approved a lesson';end if;end $$;
set local request.jwt.claim.sub='00000000-0000-4000-8000-0000000000a1';
set local role authenticated;
do $$begin
 update wa_bot_lessons set status='aprobada',answer='No depende de la garantía: lo define el contrato.' where id=current_setting('test.lesson')::uuid;
 begin update wa_bot_lessons set kind='estilo' where id=current_setting('test.lesson')::uuid;raise exception 'Admin changed lesson kind';exception when insufficient_privilege then null;end;
 begin update wa_bot_lessons set decided_by=null where id=current_setting('test.lesson')::uuid;raise exception 'Admin forged decision author';exception when insufficient_privilege then null;end;
 if (select count(*) from wa_bot_learning_runs)<>1 then raise exception 'Admin cannot read runs';end if;
end $$;
reset role;
do $$begin
 if (select status||'/'||decided_by::text from wa_bot_lessons where id=current_setting('test.lesson')::uuid)<>'aprobada/00000000-0000-4000-8000-0000000000a1' then raise exception 'Decision not recorded';end if;
end $$;
rollback;
\echo 'WhatsApp checks passed'
