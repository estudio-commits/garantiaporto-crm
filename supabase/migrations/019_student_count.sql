-- 019: number of students for the university guarantee.
-- The web form's step 2 sends extra.elementor_estudiantes ("1 estudiante", "2 estudiantes", ...); it is now stored
-- on the case (applications.student_count), editable in the client file, audited, and used by the assistant.
begin;
alter table public.applications add column if not exists student_count smallint check(student_count is null or student_count between 1 and 10);
grant select (student_count) on public.applications to authenticated;

create or replace function public.event_student_count() returns trigger language plpgsql security definer set search_path=public as $$
declare n text=substring(coalesce(new.payload->'extra'->>'elementor_estudiantes','') from '^\s*(\d{1,2})');
begin
 if new.quarantined or n is null or n::int not between 1 and 10 then return new; end if;
 update applications set student_count=n::int
 where id=new.application_id and source='web' and student_count is distinct from n::int;
 return new;
end $$;
drop trigger if exists form_event_student_count on public.form_events;
create trigger form_event_student_count after insert on public.form_events
 for each row execute function public.event_student_count();
revoke all on function public.event_student_count() from public,anon,authenticated;

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
 -- Students the client declared in the chat (universitaria): only when the case has none.
 if jsonb_typeof(f->'student_count')='number' and (f->>'student_count')::numeric between 1 and 10 and a.student_count is null then
  update applications set student_count=(f->>'student_count')::int where id=a.id; changed=array_append(changed,'student_count');
 end if;
 -- Income the client declared in the chat: only when the case has none (web forms already carry it).
 if jsonb_typeof(f->'monthly_income')='number' and (f->>'monthly_income')::numeric between 1 and 1e9
    and not exists(select 1 from application_sensitive s where s.application_id=a.id and s.monthly_income is not null) then
  insert into application_sensitive(application_id,monthly_income) values(a.id,(f->>'monthly_income')::numeric)
  on conflict(application_id) do update set monthly_income=excluded.monthly_income where application_sensitive.monthly_income is null;
  changed=array_append(changed,'monthly_income');
 end if;
 if f->>'guarantee_type' in('tradicional','universitaria','rural') and early and a.guarantee_type is distinct from f->>'guarantee_type' then
  update applications set guarantee_type=f->>'guarantee_type' where id=a.id; changed=array_append(changed,'guarantee_type');
 end if;
 return to_jsonb(changed);
end $$;
revoke all on function public.wa_bot_update_case(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.wa_bot_update_case(uuid,jsonb) to service_role;

-- Cases that already arrived with the field.
update applications a set student_count=substring(e.payload->'extra'->>'elementor_estudiantes' from '^\s*(\d{1,2})')::int
from form_events e
where e.application_id=a.id and not e.quarantined and a.source='web' and a.student_count is null
  and substring(coalesce(e.payload->'extra'->>'elementor_estudiantes','') from '^\s*(\d{1,2})')::int between 1 and 10;
commit;
