\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002'),('00000000-0000-4000-8000-000000000003');
insert into profiles values('00000000-0000-4000-8000-000000000001','Admin Ficticio','admin',true,true),('00000000-0000-4000-8000-000000000002','Vendedor A Ficticio','seller',true,false),('00000000-0000-4000-8000-000000000003','Vendedor B Ficticio','seller',true,true);
insert into applications(id,full_name,phone,assigned_user_id) values('10000000-0000-4000-8000-000000000001','Caso A','000001','00000000-0000-4000-8000-000000000002'),('10000000-0000-4000-8000-000000000002','Caso B','000002','00000000-0000-4000-8000-000000000003');
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
do $$begin
 if (select count(*) from applications)<>1 then raise exception 'RLS leak';end if;
 if exists(select 1 from application_sensitive) then raise exception 'Sensitive leak';end if;
 update applications set stage='en_contacto' where id='10000000-0000-4000-8000-000000000001';
 begin update applications set stage='finalizado' where id='10000000-0000-4000-8000-000000000001';raise exception 'Missing followup accepted';exception when raise_exception then if sqlerrm='Missing followup accepted' then raise;end if;end;
 begin update applications set stage='finalizado',follow_up_date='2000-01-01' where id='10000000-0000-4000-8000-000000000001';raise exception 'Past followup accepted';exception when raise_exception then if sqlerrm='Past followup accepted' then raise;end if;end;
 update applications set stage='finalizado',follow_up_date=(now() at time zone 'America/Montevideo')::date where id='10000000-0000-4000-8000-000000000001';
 if not exists(select 1 from audit_log where application_id='10000000-0000-4000-8000-000000000001' and changes ? 'follow_up_date') then raise exception 'Schedule not audited';end if;
 update applications set follow_up_date=current_date+1 where id='10000000-0000-4000-8000-000000000002';if found then raise exception 'Other seller schedule editable';end if;
 update applications set stage='en_contacto' where id='10000000-0000-4000-8000-000000000001';
 if exists(select 1 from applications where id='10000000-0000-4000-8000-000000000001' and follow_up_date is not null) then raise exception 'Reopening did not clear schedule';end if;

 update applications set guarantee_stage='preaprobacion_cargada',source_id='40000000-0000-4000-8000-000000000002' where id='10000000-0000-4000-8000-000000000001';
 if (select decision from applications where id='10000000-0000-4000-8000-000000000001')<>'no_presentada' then raise exception 'Pipeline altered formal decision';end if;
 if (select count(*) from client_sources where id in('40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002'))<>2 then raise exception 'Seller cannot read origins';end if;
 begin insert into client_sources(name) values('Forbidden seller origin');raise exception 'Seller can create origin';exception when insufficient_privilege then null;end;
 update client_sources set name='Forbidden rename' where id='40000000-0000-4000-8000-000000000002';if found then raise exception 'Seller can rename origin';end if;

 begin update applications set assigned_user_id='00000000-0000-4000-8000-000000000002' where id='10000000-0000-4000-8000-000000000002'; if found then raise exception 'Other seller editable';end if;end;
 begin update applications set decision='aprobada',decision_date=current_date,decision_reference='Ficticio' where id='10000000-0000-4000-8000-000000000001';raise exception 'Formal approval allowed'; exception when raise_exception then if sqlerrm='Formal approval allowed' then raise;end if;end;
 begin insert into clearing_records(application_id,result) values('10000000-0000-4000-8000-000000000001','figura');raise exception 'Clearing allowed';exception when insufficient_privilege then null;end;
 begin insert into audit_log(application_id,action) values('10000000-0000-4000-8000-000000000001','forged');raise exception 'Audit forge allowed';exception when insufficient_privilege then null;end;
 insert into notes(application_id,body) values('10000000-0000-4000-8000-000000000001','Nota ficticia');
 begin perform ingest_event('{}');raise exception 'Seller may ingest';exception when insufficient_privilege then null;end;
 begin perform set_guarantee_decision('10000000-0000-4000-8000-000000000001','aprobada',null,current_date,'Ficticio');raise exception 'Seller approved guarantee';exception when insufficient_privilege then null;end;
 begin update applications set drive_folder_url='javascript:alert(1)' where id='10000000-0000-4000-8000-000000000001';raise exception 'Unsafe Drive URL accepted';exception when check_violation then null;end;
 if not exists(select 1 from applications where id='10000000-0000-4000-8000-000000000001' and stage='en_contacto' and guarantee_stage='preaprobacion_cargada') then raise exception 'Axes not independent';end if;

end $$;
reset role;
do $$declare e jsonb; r jsonb; aid uuid;begin
 e=jsonb_build_object('schema_version',1,'event_id','20000000-0000-4000-8000-000000000001','solicitud_id','30000000-0000-4000-8000-000000000001','step',2,'sent_at','2026-10-26T12:00:00Z','data',jsonb_build_object('full_name','Persona Ficticia','phone','000000','national_id','DEMO','monthly_income',60000));
 r=ingest_event(e);aid=(r->>'application_id')::uuid;
 if not (ingest_event(e)->>'duplicate')::boolean then raise exception 'No idempotency';end if;
 if (select source_id from applications where id=aid)<>'40000000-0000-4000-8000-000000000001' then raise exception 'Web origin not set';end if;
 e=jsonb_set(jsonb_set(e,'{step}','1'),'{event_id}','"20000000-0000-4000-8000-000000000002"');perform ingest_event(e);
 if (select completion from applications where id=aid)<>'completo' then raise exception 'Completion downgraded';end if;
 if (select count(*) from form_events where application_id=aid)<>2 then raise exception 'Duplicate events';end if;
 if not exists(select 1 from form_events where application_id=aid and out_of_order) then raise exception 'Order unrecorded';end if;
 e=jsonb_set(e,'{data,phone}','"000099"');
 begin perform ingest_event(e);raise exception 'Conflicting event accepted';exception when raise_exception then if sqlerrm='Conflicting event accepted' then raise;end if;end;
 e=jsonb_set(jsonb_set(e,'{event_id}','"20000000-0000-4000-8000-000000000003"'),'{solicitud_id}','"30000000-0000-4000-8000-000000000002"');r=ingest_event(e);
 if r->>'application_id'=aid::text then raise exception 'Independent request merged';end if;
end $$;
do $$declare n integer;begin
 for i in 1..120 loop if not take_integration_slot() then raise exception 'Premature rate limit';end if;end loop;
 if take_integration_slot() then raise exception 'Rate limit not enforced';end if;
end $$;
update client_sources set archived=true where id='40000000-0000-4000-8000-000000000002';
do $$begin
 update applications set stage='finalizado',follow_up_date=(now() at time zone 'America/Montevideo')::date where id='10000000-0000-4000-8000-000000000001';
 begin update applications set source_id='40000000-0000-4000-8000-000000000002' where id='10000000-0000-4000-8000-000000000002';raise exception 'Archived origin accepted';exception when raise_exception then if sqlerrm='Archived origin accepted' then raise;end if;end;
 if not exists(select 1 from audit_log where changes->'source_id'->>'after'='40000000-0000-4000-8000-000000000002') then raise exception 'Source change unaudited';end if;
end $$;

set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$declare prev timestamptz;cnt bigint;begin
 begin perform set_guarantee_decision('10000000-0000-4000-8000-000000000001','rechazada',null,current_date,'Referencia ficticia');raise exception 'Missing reason accepted';exception when raise_exception then if sqlerrm='Missing reason accepted' then raise;end if;end;
 perform set_guarantee_decision('10000000-0000-4000-8000-000000000001','rechazada','clearing',current_date,'Referencia ficticia');
 if exists(select 1 from applications where id='10000000-0000-4000-8000-000000000001' and follow_up_date is not null) then raise exception 'Rejected retains followup';end if;
 if not exists(select 1 from applications where id='10000000-0000-4000-8000-000000000001' and guarantee_stage='rechazada' and stage='finalizado') then raise exception 'Guarantee decision modified commercial axis';end if;
 if not exists(select 1 from application_sensitive where application_id='10000000-0000-4000-8000-000000000001' and rejection_reason='clearing') then raise exception 'Reason missing';end if;
 select updated_at into prev from applications where id='10000000-0000-4000-8000-000000000001';select count(*) into cnt from audit_log;
 update applications set full_name=full_name,updated_at=now()+interval '10 days' where id='10000000-0000-4000-8000-000000000001';
 if (select updated_at from applications where id='10000000-0000-4000-8000-000000000001')<>prev then raise exception 'No-op reset recency';end if;
 if (select count(*) from audit_log)<>cnt then raise exception 'No-op generated history';end if;
 update applications set full_name='Nombre Corregido Ficticio',drive_folder_url='https://drive.google.com/drive/folders/folder-ficticio',requested_date='2026-10-25' where id='10000000-0000-4000-8000-000000000001';
 if not exists(select 1 from audit_log where changes->'full_name'->>'before'='Caso A' and changes->'full_name'->>'after'='Nombre Corregido Ficticio') then raise exception 'Full data audit absent';end if;
 select updated_at into prev from applications where id='10000000-0000-4000-8000-000000000001';
 insert into notes(application_id,body) values('10000000-0000-4000-8000-000000000001','Seguimiento ficticio de prueba');
 if (select updated_at from applications where id='10000000-0000-4000-8000-000000000001')<=prev then raise exception 'Followup did not touch activity';end if;
end $$;
reset role;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
set local role authenticated;
do $$begin
 if exists(select 1 from audit_log where visibility='admin') then raise exception 'Private audit leaked';end if;
 begin update applications set guarantee_stage='sin_contactar' where id='10000000-0000-4000-8000-000000000001';raise exception 'Seller reopened formal decision';exception when raise_exception then if sqlerrm='Seller reopened formal decision' then raise;end if;end;
end $$;
-- Identity visible only within assigned cases; income and originals stay restricted.
do $$declare oldtime timestamptz; n uuid; begin
 update applications set national_id='000.000-0' where id='10000000-0000-4000-8000-000000000001';
 if (select national_id from applications where id='10000000-0000-4000-8000-000000000001')<>'0000000' then raise exception 'CI normalization failed';end if;
 select updated_at into oldtime from applications where id='10000000-0000-4000-8000-000000000001';
 update applications set national_id='000.000-0' where id='10000000-0000-4000-8000-000000000001';
 if (select updated_at from applications where id='10000000-0000-4000-8000-000000000001')<>oldtime then raise exception 'Formatted CI caused false activity';end if;
 begin update applications set national_id='BAD' where id='10000000-0000-4000-8000-000000000001';raise exception 'Invalid CI accepted';exception when raise_exception then if sqlerrm='Invalid CI accepted' then raise;end if;end;
 begin insert into applications(full_name,phone,assigned_user_id) values('Ficticio sin CI','000',auth.uid());raise exception 'Manual CI not required';exception when raise_exception then if sqlerrm='Manual CI not required' then raise;end if;end;
 insert into applications(full_name,phone,national_id,assigned_user_id) values('Ficticio con CI','000','0.000.000-0',auth.uid()) returning id into n;
 insert into notes(application_id,body,kind,created_at) values(n,'Seguimiento ficticio','comunicacion','2000-01-01');
 if not exists(select 1 from notes where application_id=n and kind='comunicacion' and created_at=now()) then raise exception 'Typed note/server timestamp missing';end if;
 if exists(select 1 from form_events) then raise exception 'Original payload leaked to seller';end if;
end $$;
reset role;
do $$declare e jsonb; r jsonb; aid uuid; begin
 e=jsonb_build_object('schema_version',1,'event_id',gen_random_uuid(),'solicitud_id',gen_random_uuid(),'step',1,'sent_at',now(),'data',jsonb_build_object('full_name','Marketing ficticio','phone','000','utm_campaign','Primera ficticia','button_origin','cotizador'),'extra',jsonb_build_object('landing_page','https://example.test','custom_private','original-only'));
 r=ingest_event(e);aid=(r->>'application_id')::uuid;
 if (select national_id from applications where id=aid) is not null then raise exception 'Missing CI invented';end if;
 e=jsonb_set(jsonb_set(jsonb_set(e,'{event_id}',to_jsonb(gen_random_uuid())),'{step}','2'),'{data,national_id}','"0.000.000-0"');
 e=jsonb_set(e,'{data,utm_campaign}','"Segunda ficticia"');perform ingest_event(e);
 if (select national_id from applications where id=aid)<>'00000000' then raise exception 'Step 2 identity missing';end if;
 if (select attribution->>'utm_campaign' from applications where id=aid)<>'Primera ficticia' then raise exception 'First attribution overwritten';end if;
 if (select attribution->>'landing_page' from applications where id=aid)<>'https://example.test' then raise exception 'Extra marketing not projected';end if;
 if (select attribution ? 'custom_private' from applications where id=aid) then raise exception 'Private extra projected';end if;
 if not exists(select 1 from form_events where application_id=aid and payload->'data'->>'utm_campaign'='Segunda ficticia' and payload->'extra'->>'custom_private'='original-only') then raise exception 'Original payload lost';end if;
 update applications set national_id='00000010' where id=aid;
 e=jsonb_set(e,'{event_id}',to_jsonb(gen_random_uuid()));perform ingest_event(e);
 if (select national_id from applications where id=aid)<>'00000010' then raise exception 'Corrected identity overwritten';end if;
 if not exists(select 1 from form_events where event_id=(e->>'event_id')::uuid and discrepancy) then raise exception 'Identity discrepancy not recorded';end if;
end $$;
reset role;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$begin
 begin update applications set issued_date=current_date,issued_reference='FICTICIO' where id='10000000-0000-4000-8000-000000000001';raise exception 'Unapproved issuance allowed';exception when raise_exception then if sqlerrm='Unapproved issuance allowed' then raise;end if;end;
 perform set_guarantee_decision('10000000-0000-4000-8000-000000000001','aprobada',null,current_date,'Aprobación ficticia');
 begin update applications set issued_date=current_date where id='10000000-0000-4000-8000-000000000001';raise exception 'Incomplete issuance allowed';exception when check_violation then null;end;
 begin update applications set issued_date=current_date,issued_reference='  ' where id='10000000-0000-4000-8000-000000000001';raise exception 'Empty reference allowed';exception when check_violation then null;end;
 update applications set issued_date=current_date,issued_reference='POLIZA-FICTICIA' where id='10000000-0000-4000-8000-000000000001';
 if not exists(select 1 from audit_log where changes->'issued_reference'->>'after'='POLIZA-FICTICIA' and actor_id=auth.uid()) then raise exception 'Issuance audit missing';end if;
 begin update applications set guarantee_stage='sin_contactar' where id='10000000-0000-4000-8000-000000000001';raise exception 'Issued case reopened silently';exception when raise_exception then if sqlerrm='Issued case reopened silently' then raise;end if;end;
end $$;
reset role;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
set local role authenticated;
do $$begin
 if not exists(select 1 from applications where id='10000000-0000-4000-8000-000000000001' and issued_reference='POLIZA-FICTICIA') then raise exception 'Assigned seller cannot see issuance';end if;
 begin update applications set issued_date=null,issued_reference=null where id='10000000-0000-4000-8000-000000000001';raise exception 'Seller cleared issuance';exception when insufficient_privilege then null;end;
 begin update applications set issued_reference='FORGED' where id='10000000-0000-4000-8000-000000000001';raise exception 'Seller changed issuance';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set local role authenticated;
update applications set issued_date=null,issued_reference=null where id='10000000-0000-4000-8000-000000000001';
do $$begin if not exists(select 1 from audit_log where changes->'issued_reference'->>'before'='POLIZA-FICTICIA' and changes->'issued_reference'->'after'='null'::jsonb) then raise exception 'Cancellation audit missing';end if;end $$;
reset role;
-- Migration 011: insert-guard parity and hidden continuation identifier.
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
set local role authenticated;
do $$begin
 begin insert into applications(full_name,phone,national_id,assigned_user_id,attribution) values('Atribución forjada','000','0.000.000-0',auth.uid(),'{"utm_source":"x"}');raise exception 'Seller forged attribution';exception when raise_exception then if sqlerrm='Seller forged attribution' then raise;end if;end;
 begin insert into applications(full_name,phone,national_id,assigned_user_id,decision_reference) values('Decisión forjada','000','0.000.000-0',auth.uid(),'REF-FICTICIA');raise exception 'Seller forged decision evidence';exception when raise_exception then if sqlerrm='Seller forged decision evidence' then raise;end if;end;
 begin perform external_id from applications limit 1;raise exception 'Seller reads external_id';exception when insufficient_privilege then null;end;
 begin perform contact_id from applications limit 1;raise exception 'Seller reads contact_id';exception when insufficient_privilege then null;end;
 if (select count(*) from applications)<1 then raise exception 'Column grants hid seller rows';end if;
end $$;
reset role;
do $$declare e jsonb; r jsonb; aid uuid;begin
 if exists(select 1 from audit_log where changes ? 'external_id' or changes ? 'contact_id') then raise exception 'Continuation id copied to audit';end if;
 e=jsonb_build_object('schema_version',1,'event_id',gen_random_uuid(),'solicitud_id',gen_random_uuid(),'step',1,'sent_at',now(),'data',jsonb_build_object('full_name','Cuarentena ficticia','phone','000'));
 r=ingest_event(e);aid=(r->>'application_id')::uuid;
 update applications set archived=true where id=aid;
 e=jsonb_set(jsonb_set(jsonb_set(e,'{event_id}',to_jsonb(gen_random_uuid())),'{step}','2'),'{data,monthly_income}','999999');
 e=jsonb_set(e,'{data,national_id}','"0.000.000-0"');
 r=ingest_event(e);
 if not (r->>'quarantined')::boolean then raise exception 'Archived case not quarantined';end if;
 if exists(select 1 from application_sensitive where application_id=aid) then raise exception 'Quarantined event wrote sensitive data';end if;
 if (select completion from applications where id=aid)<>'parte_1_recibida' or (select national_id from applications where id=aid) is not null then raise exception 'Quarantined event modified case';end if;
 if not exists(select 1 from form_events where application_id=aid and quarantined and discrepancy) then raise exception 'Quarantined event not kept';end if;
 if exists(select 1 from audit_log where application_id=aid and action='form_event' and (changes->>'quarantined')::boolean and visibility<>'admin') then raise exception 'Quarantine audit visible to case';end if;
end $$;
update profiles set active=false where id='00000000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
do $$begin if exists(select 1 from applications) then raise exception 'Inactive user access';end if;end $$;
reset role;
rollback;
\echo 'Database permission and ingestion checks passed'
