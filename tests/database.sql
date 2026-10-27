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
 update applications set guarantee_stage='preaprobacion_cargada',source_id='40000000-0000-4000-8000-000000000002' where id='10000000-0000-4000-8000-000000000001';
 if (select decision from applications where id='10000000-0000-4000-8000-000000000001')<>'no_presentada' then raise exception 'Pipeline altered formal decision';end if;
 if (select count(*) from client_sources)<>2 then raise exception 'Seller cannot read origins';end if;
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
 update applications set stage='finalizado' where id='10000000-0000-4000-8000-000000000001';
 begin update applications set source_id='40000000-0000-4000-8000-000000000002' where id='10000000-0000-4000-8000-000000000002';raise exception 'Archived origin accepted';exception when raise_exception then if sqlerrm='Archived origin accepted' then raise;end if;end;
 if not exists(select 1 from audit_log where changes->'source_id'->>'after'='40000000-0000-4000-8000-000000000002') then raise exception 'Source change unaudited';end if;
end $$;

set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$declare prev timestamptz;cnt bigint;begin
 begin perform set_guarantee_decision('10000000-0000-4000-8000-000000000001','rechazada',null,current_date,'Referencia ficticia');raise exception 'Missing reason accepted';exception when raise_exception then if sqlerrm='Missing reason accepted' then raise;end if;end;
 perform set_guarantee_decision('10000000-0000-4000-8000-000000000001','rechazada','clearing',current_date,'Referencia ficticia');
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
reset role;
update profiles set active=false where id='00000000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
do $$begin if exists(select 1 from applications) then raise exception 'Inactive user access';end if;end $$;
reset role;
rollback;
\echo 'Database permission and ingestion checks passed'
