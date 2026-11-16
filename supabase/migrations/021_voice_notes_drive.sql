-- 021: voice notes the client sends are filed in Drive too, in "Notas de voz" inside the case folder.
-- Video and stickers still stay only in the chat.
begin;
create or replace function public.wa_mark_media() returns trigger language plpgsql set search_path=public as $$
begin
 if new.direction='in' and new.media is not null and new.kind in('document','image','audio') and new.media_status is null then
  new.media_status='pending'; new.media_next_at=now();
 end if;
 return new;
end $$;
-- Voice notes already received that WhatsApp still keeps (about 30 days).
update public.wa_messages set media_status='pending',media_next_at=now()
where direction='in' and kind='audio' and media is not null and media_status is null
  and created_at>now()-interval '29 days';
commit;
