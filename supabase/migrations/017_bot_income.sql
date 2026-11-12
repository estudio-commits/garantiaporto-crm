-- 017: the WhatsApp assistant may store the income the client declares in the chat.
-- Only fills application_sensitive.monthly_income when it is empty (never overwrites the web form or the team),
-- and stays admin-only like the rest of that table. See docs/WHATSAPP-FAQ.md (sección 3).
begin;
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
commit;
