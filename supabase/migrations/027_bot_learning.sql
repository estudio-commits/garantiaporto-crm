-- 027: weekly learning for the WhatsApp assistant.
-- Once a week (and on demand from Integraciones) the server reads the week's conversations with personal
-- data masked, and proposes: frequent questions the assistant could not answer, with the answer the team
-- gave, and style notes taken from how the team writes. Proposals wait for an administrator: only approved
-- lessons reach the assistant, so a client's message can never change what it says by itself.
begin;

create table if not exists public.wa_bot_lessons(
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in('pregunta','estilo')),
 question text check(length(question) between 1 and 300),
 answer text not null check(length(answer) between 1 and 1200),
 reason text check(length(reason)<=600),
 evidence int not null default 1 check(evidence between 0 and 1000),
 needs_review boolean not null default false,
 status text not null default 'propuesta' check(status in('propuesta','aprobada','descartada')),
 week date not null,
 created_at timestamptz not null default now(),
 decided_by uuid references public.profiles(id),
 decided_at timestamptz,
 check(kind='estilo' or question is not null)
);
create index if not exists wa_bot_lessons_status on public.wa_bot_lessons(status,created_at desc);

create table if not exists public.wa_bot_learning_runs(
 id bigint generated always as identity primary key,
 week date not null,
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 status text not null default 'en_curso' check(status in('en_curso','lista','sin_datos','error')),
 conversations int not null default 0,
 proposals int not null default 0,
 error text check(length(error)<=500),
 requested_by uuid references public.profiles(id)
);
create index if not exists wa_bot_learning_runs_started on public.wa_bot_learning_runs(started_at desc);

-- Who decided and when is set by the database, not by the browser.
create or replace function public.wa_bot_lesson_decision() returns trigger language plpgsql set search_path=public as $$
begin
 new.kind=old.kind; new.week=old.week; new.created_at=old.created_at; new.evidence=old.evidence; new.reason=old.reason;
 if new.status is distinct from old.status or new.question is distinct from old.question or new.answer is distinct from old.answer then
  new.decided_by=auth.uid(); new.decided_at=now();
 else new.decided_by=old.decided_by; new.decided_at=old.decided_at; end if;
 return new;
end $$;
drop trigger if exists wa_bot_lesson_decision on public.wa_bot_lessons;
create trigger wa_bot_lesson_decision before update on public.wa_bot_lessons
 for each row execute function public.wa_bot_lesson_decision();
revoke all on function public.wa_bot_lesson_decision() from public,anon,authenticated;

alter table public.wa_bot_lessons enable row level security;
alter table public.wa_bot_learning_runs enable row level security;
revoke all on public.wa_bot_lessons,public.wa_bot_learning_runs from public,anon,authenticated;
grant select on public.wa_bot_lessons,public.wa_bot_learning_runs to authenticated;
grant update(question,answer,status) on public.wa_bot_lessons to authenticated;
grant select,insert,update on public.wa_bot_lessons,public.wa_bot_learning_runs to service_role;
create policy wa_bot_lessons_admin_read on public.wa_bot_lessons for select to authenticated using(is_admin());
create policy wa_bot_lessons_admin_decide on public.wa_bot_lessons for update to authenticated using(is_admin()) with check(is_admin());
create policy wa_bot_learning_runs_admin_read on public.wa_bot_learning_runs for select to authenticated using(is_admin());
commit;
