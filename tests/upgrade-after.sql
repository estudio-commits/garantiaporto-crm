\set ON_ERROR_STOP on
do $$begin
 if not exists(select 1 from applications a join test_migration_expected e on a.id=e.id where a.created_at=e.created_at and a.updated_at=e.updated_at and a.stage='en_contacto' and a.guarantee_stage='preaprobacion_cargada' and a.requested_date is null) then raise exception 'Migration lost dates or workflow mapping';end if;
 if not exists(select 1 from audit_log where application_id='90000000-0000-4000-8000-000000000001' and action='workflow_migration' and visibility='admin' and changes->'previous'->>'stage'='en_preaprobacion') then raise exception 'Legacy state snapshot missing';end if;
end $$;
delete from audit_log where application_id='90000000-0000-4000-8000-000000000001';
delete from applications where id='90000000-0000-4000-8000-000000000001';
drop table test_migration_expected;
