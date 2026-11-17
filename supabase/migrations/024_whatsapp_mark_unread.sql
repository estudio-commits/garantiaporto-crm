-- 024: "Marcar como no leído" in the CRM WhatsApp inbox. Same access rule as wa_mark_read:
-- administrators, or users who can access the conversation's case. The mark is shared by the team.
begin;
create or replace function public.wa_mark_unread(p_conversation uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 update wa_conversations set unread_count=greatest(unread_count,1)
 where id=p_conversation and (is_admin() or (application_id is not null and can_access(application_id)));
end $$;
revoke all on function public.wa_mark_unread(uuid) from public,anon,authenticated;
grant execute on function public.wa_mark_unread(uuid) to authenticated;
commit;
