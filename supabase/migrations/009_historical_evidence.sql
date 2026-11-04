begin;
-- Explicit unknowns for documented historical records; never invent decision dates or policy references.
alter table applications add column if not exists decision_date_unknown boolean not null default false;
alter table applications add column if not exists issued_reference_unknown boolean not null default false;
alter table applications drop constraint if exists applications_check;
alter table applications drop constraint if exists decision_evidence;
alter table applications add constraint decision_evidence check (
 (decision not in ('aprobada','rechazada') and not decision_date_unknown) or
 (decision in ('aprobada','rechazada') and nullif(trim(decision_reference),'') is not null and
  ((decision_date is not null and not decision_date_unknown) or (decision_date is null and decision_date_unknown)))
);
alter table applications drop constraint if exists issuance_complete;
alter table applications add constraint issuance_complete check (
 (issued_date is null and issued_reference is null and not issued_reference_unknown) or
 (issued_date is not null and guarantee_stage='aprobada' and
  ((issued_reference is not null and length(trim(issued_reference)) between 1 and 2000 and not issued_reference_unknown) or
   (issued_reference is null and issued_reference_unknown)))
);
create or replace function public.guard_historical_evidence() returns trigger language plpgsql set search_path=public as $$
begin
 if new.decision_date is not null or new.guarantee_stage not in ('aprobada','rechazada') then new.decision_date_unknown=false;end if;
 if new.issued_reference is not null or new.issued_date is null then new.issued_reference_unknown=false;end if;
 if current_user not in ('postgres','service_role','supabase_admin') and not is_admin() then
  if TG_OP='INSERT' then
   if new.decision_date_unknown or new.issued_reference_unknown then raise exception 'Administrator required for historical evidence' using errcode='42501';end if;
  elsif new.decision_date_unknown is distinct from old.decision_date_unknown or new.issued_reference_unknown is distinct from old.issued_reference_unknown then
   raise exception 'Administrator required for historical evidence' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
-- Must run after guard_application has aligned the formal decision with the guarantee stage.
drop trigger if exists zz_guard_historical_evidence on applications;
create trigger zz_guard_historical_evidence before insert or update on applications for each row execute function guard_historical_evidence();
revoke all on function guard_historical_evidence() from public,anon,authenticated;
commit;
