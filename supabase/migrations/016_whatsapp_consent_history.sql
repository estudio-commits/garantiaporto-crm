-- 016: WhatsApp consent stored on the case, and WhatsApp activity in the case history.
-- 1) applications.wa_consent: set automatically when the web form carries consent evidence or the client
--    writes to the number; the team can also tick it once in the case file. Changes are audited.
-- 2) When a team member sends a WhatsApp message from the CRM, the case history gets one "comunicacion"
--    entry per Montevideo calendar day, so follow-up alerts count the exchange as contact.
begin;

alter table public.applications add column if not exists wa_consent boolean not null default false;
grant select (wa_consent) on public.applications to authenticated;

create or replace function public.wa_consent_from_form() returns trigger language plpgsql set search_path=public as $$
begin
 if coalesce(trim(new.attribution->>'consent_evidence'),'')<>'' then new.wa_consent=true; end if;
 return new;
end $$;
drop trigger if exists wa_consent_form on public.applications;
create trigger wa_consent_form before insert or update of attribution on public.applications
 for each row execute function public.wa_consent_from_form();
revoke all on function public.wa_consent_from_form() from public,anon,authenticated;

create or replace function public.wa_message_effects() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.application_id is null then return new; end if;
 if new.direction='in' then
  -- A client who writes to the number has agreed to be contacted there.
  update applications set wa_consent=true where id=new.application_id and not wa_consent;
 elsif new.author_id is not null and new.status<>'failed' then
  if not exists(select 1 from notes where application_id=new.application_id and kind='comunicacion' and body like 'WhatsApp:%'
                and (created_at at time zone 'America/Montevideo')::date=(now() at time zone 'America/Montevideo')::date) then
   insert into notes(application_id,author_id,body,kind)
   values(new.application_id,new.author_id,'WhatsApp: conversación con el cliente desde el CRM. Los mensajes están en la pestaña WhatsApp.','comunicacion');
  end if;
 end if;
 return new;
end $$;
drop trigger if exists zz_wa_message_effects on public.wa_messages;
create trigger zz_wa_message_effects after insert on public.wa_messages
 for each row execute function public.wa_message_effects();
revoke all on function public.wa_message_effects() from public,anon,authenticated;

-- Existing cases: consent from the web form or from a client who already wrote.
update applications a set wa_consent=true
where not a.wa_consent and (coalesce(trim(a.attribution->>'consent_evidence'),'')<>''
 or exists(select 1 from wa_messages m where m.application_id=a.id and m.direction='in'));
commit;
