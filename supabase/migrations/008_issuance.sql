begin;
alter table applications add column issued_date date;
alter table applications add column issued_reference text;
alter table applications add constraint issuance_complete check (
 (issued_date is null and issued_reference is null) or
 (issued_date is not null and issued_reference is not null and length(trim(issued_reference)) between 1 and 2000 and guarantee_stage='aprobada')
);
create index applications_pending_issuance on applications(created_at desc) where guarantee_stage='aprobada' and issued_date is null and not archived;
create function public.guard_issuance() returns trigger language plpgsql set search_path=public as $$
begin
 if new.issued_reference is not null then new.issued_reference=trim(new.issued_reference);end if;
 if current_user not in ('postgres','service_role','supabase_admin') and not is_admin() then
  if TG_OP='INSERT' then
   if new.issued_date is not null or new.issued_reference is not null then raise exception 'Administrator required for issuance' using errcode='42501';end if;
  elsif new.issued_date is distinct from old.issued_date or new.issued_reference is distinct from old.issued_reference then
   raise exception 'Administrator required for issuance' using errcode='42501';
  end if;
 end if;
 if new.issued_date is not null and new.guarantee_stage<>'aprobada' then raise exception 'Clear issuance record before changing approval';end if;
 return new;
end $$;
-- Normalize before the activity guard; existing auditing captures old/new date and reference.
create trigger ab_guard_issuance before insert or update on applications for each row execute function guard_issuance();
revoke all on function guard_issuance() from public,anon,authenticated;
commit;
