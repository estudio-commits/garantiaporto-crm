\set ON_ERROR_STOP on
-- A pre-migration case: no user/customer data.
insert into applications(id,full_name,phone,source,stage,preapproval) values('90000000-0000-4000-8000-000000000001','Migración Ficticia','000000','web','en_preaprobacion','en_proceso');
create temporary table migration_expected as select id,created_at,updated_at from applications where id='90000000-0000-4000-8000-000000000001';
-- Temporary tables are session-local, use transaction-independent evidence for the next psql process.
create table public.test_migration_expected as select * from migration_expected;
