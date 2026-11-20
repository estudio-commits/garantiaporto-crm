-- 025: a team member who writes to the client by WhatsApp from the CRM has contacted the case.
-- The case moves from "Nuevo cliente" to "En contacto" in the commercial pipeline and its contact status
-- becomes "contactado". The change is audited under the team member's name (not "Sistema").
-- Only the commercial side changes: the guarantee process stays as the team left it.
-- Messages from the assistant or automatic greetings do not count as contact by the team.
begin;

create or replace function public.wa_mark_contacted(p_application uuid,p_author uuid) returns void language plpgsql security definer set search_path=public as $$
declare prev text=current_setting('request.jwt.claim.sub',true);
begin
 -- Audit and first-contact fields read the acting user from the request: act as the author.
 perform set_config('request.jwt.claim.sub',p_author::text,true);
 update applications set
  contact_status='contactado',
  stage=case when stage='nuevo' then 'en_contacto' else stage end
 where id=p_application and not archived and (contact_status='no_contactado' or stage='nuevo');
 perform set_config('request.jwt.claim.sub',coalesce(prev,''),true);
end $$;
revoke all on function public.wa_mark_contacted(uuid,uuid) from public,anon,authenticated;

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
  perform wa_mark_contacted(new.application_id,new.author_id);
 end if;
 return new;
end $$;
revoke all on function public.wa_message_effects() from public,anon,authenticated;

-- Cases the team already wrote to: same change, attributed to the first team member who wrote.
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
commit;
