-- 0171 감사이슈 LOG — 감사 건(거래처×연도)마다 이슈를 아이템으로 쌓고, 경과를 날짜와 함께 남긴다(사용자 2026-10-14).
--
-- 원본은 옛 엑셀 ISSUELOG(화이브라더스코리아 2019 · Issuelog_2019 시트):
--   구분(공통/별도/연결) · 중요도 · 검토사항 · 인덕담당자 · 회사담당자 · 검토내용(뒤에 「==>」로 경과를 덧붙임) ·
--   결론/CLEAR? · 회사의사결정필요 · 긴급여부(실제로는 처리 시점 반기/중간/기말).
-- 바꾼 것: 결론+CLEAR? → 상태 하나 · 「==>」 덧붙임 → 경과 기록(audit_issue_log, 쌓기만) · 긴급여부 → 처리 시점(계획·중간·기말) ·
--          해마다 새 시트 → 「다음 해로 이월」(새 건에 복사, carried_from 으로 잇는다).
-- 우리 내부용이다 — 회사에는 강평자료만 간다(강평 연결은 나중에). 감사팀(is_audit_staff)만 읽고 쓴다.
-- 대상은 지금 감사거래처뿐이지만, 표는 감사 건에 매달아 두어 나중에 기장팀 이슈와 합칠 때 칸 하나로 붙게 한다.

create table if not exists public.audit_issue (
  id              uuid primary key default gen_random_uuid(),
  engagement_id   uuid not null references public.dsd_engagement(id) on delete restrict,
  no              integer not null,                                   -- 건 안의 번호(1, 2, 3 …) — 넣을 때 자동
  category        text not null default '별도' check (category in ('공통', '별도', '연결', '관리')),
  importance      text not null default '중간' check (importance in ('높음', '중간', '낮음')),
  title           text not null check (length(trim(title)) > 0),     -- 검토사항
  body            text not null default '',                           -- 검토내용(처음 적은 것)
  account         text,                                               -- 관련 계정·주제(선택) — 매출, 영업권, 리스 …
  our_staff       text[] not null default '{}',                       -- 인덕담당자(여럿)
  client_contact  text,                                               -- 회사담당자
  due_stage       text not null default '기말' check (due_stage in ('계획', '중간', '기말')),  -- 언제 처리할 것인가
  decision_needed boolean not null default false,                     -- 회사의 의사결정이 필요한가
  status          text not null default '진행중' check (status in ('진행중', '완료', '이월')),
  conclusion      text,                                               -- 결론
  carried_from    uuid references public.audit_issue(id) on delete set null,  -- 작년 이슈에서 넘어왔으면 그 이슈
  closed_at       timestamptz,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now(),
  unique (engagement_id, no)
);
comment on table public.audit_issue is
  '감사이슈 LOG — 감사 건마다 이슈 아이템. 경과는 audit_issue_log 에 쌓는다. 진행중 이슈는 다음 해 건으로 이월(carried_from).';
create index if not exists audit_issue_eng_idx on public.audit_issue(engagement_id, no);
create index if not exists audit_issue_open_idx on public.audit_issue(status) where status = '진행중';

-- 번호는 건 안에서 다음 번호. 사람 손으로 넣지 않는다.
create or replace function public.audit_issue_before_ins() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.no is null or new.no <= 0 then
    perform pg_advisory_xact_lock(hashtext('audit_issue:' || new.engagement_id::text));
    select coalesce(max(no), 0) + 1 into new.no from public.audit_issue where engagement_id = new.engagement_id;
  end if;
  new.created_by := coalesce(new.created_by, auth.uid());
  new.updated_by := coalesce(new.updated_by, auth.uid());
  if new.status <> '진행중' and new.closed_at is null then new.closed_at := now(); end if;
  return new;
end $$;
drop trigger if exists audit_issue_bi on public.audit_issue;
create trigger audit_issue_bi before insert on public.audit_issue
  for each row execute function public.audit_issue_before_ins();

create or replace function public.audit_issue_before_upd() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.engagement_id <> old.engagement_id or new.no <> old.no or new.created_at <> old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception '이슈의 건·번호·작성자는 바꿀 수 없습니다.';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  if new.status = '진행중' then new.closed_at := null;
  elsif old.status = '진행중' then new.closed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists audit_issue_bu on public.audit_issue;
create trigger audit_issue_bu before update on public.audit_issue
  for each row execute function public.audit_issue_before_upd();

-- ── 경과 기록 — 쌓기만 한다(고치기·지우기 없음). 이슈를 지우면 함께 지워진다. ──
create table if not exists public.audit_issue_log (
  id             uuid primary key default gen_random_uuid(),
  issue_id       uuid not null references public.audit_issue(id) on delete cascade,
  body           text not null check (length(trim(body)) > 0),
  -- 상태를 바꾸며 남긴 줄이면 바뀐 상태(진행중→완료 등). 그냥 메모면 null.
  status_to      text check (status_to in ('진행중', '완료', '이월')),
  created_by     uuid references auth.users(id) on delete set null default auth.uid(),
  created_name   text,
  created_at     timestamptz not null default now()
);
comment on table public.audit_issue_log is
  '감사이슈 경과 — 엑셀의 「==> …」 덧붙임을 날짜·작성자와 함께 줄로. 쌓기만 한다.';
create index if not exists audit_issue_log_issue_idx on public.audit_issue_log(issue_id, created_at);

-- ── 권한 — 감사팀만(일반조서와 같은 선) ──
alter table public.audit_issue enable row level security;
alter table public.audit_issue_log enable row level security;

drop policy if exists audit_issue_sel on public.audit_issue;
create policy audit_issue_sel on public.audit_issue for select using (public.is_audit_staff());
drop policy if exists audit_issue_ins on public.audit_issue;
create policy audit_issue_ins on public.audit_issue for insert
  with check (public.is_audit_staff() and not public.is_readonly());
drop policy if exists audit_issue_upd on public.audit_issue;
create policy audit_issue_upd on public.audit_issue for update
  using (public.is_audit_staff() and not public.is_readonly())
  with check (public.is_audit_staff() and not public.is_readonly());
-- 지우기 — 잘못 만든 것만. 만든 사람 본인 것만 지운다(경과도 함께 지워진다).
drop policy if exists audit_issue_del on public.audit_issue;
create policy audit_issue_del on public.audit_issue for delete
  using (public.is_audit_staff() and not public.is_readonly() and created_by = auth.uid());

drop policy if exists audit_issue_log_sel on public.audit_issue_log;
create policy audit_issue_log_sel on public.audit_issue_log for select using (public.is_audit_staff());
drop policy if exists audit_issue_log_ins on public.audit_issue_log;
create policy audit_issue_log_ins on public.audit_issue_log for insert
  with check (public.is_audit_staff() and not public.is_readonly() and created_by = auth.uid());

-- ── 체험 계정(0168·0169) — 시연용 건의 이슈만 읽고 쓴다 ──
drop policy if exists sbx_select on public.audit_issue;
create policy sbx_select on public.audit_issue as restrictive for select
  using (not public.is_sandbox() or public.is_demo_engagement(engagement_id));
drop policy if exists sbx_insert on public.audit_issue;
create policy sbx_insert on public.audit_issue as restrictive for insert
  with check (not public.is_sandbox() or public.is_demo_engagement(engagement_id));
drop policy if exists sbx_update on public.audit_issue;
create policy sbx_update on public.audit_issue as restrictive for update
  using (not public.is_sandbox() or public.is_demo_engagement(engagement_id))
  with check (not public.is_sandbox() or public.is_demo_engagement(engagement_id));
drop policy if exists sbx_delete on public.audit_issue;
create policy sbx_delete on public.audit_issue as restrictive for delete
  using (not public.is_sandbox() or public.is_demo_engagement(engagement_id));

drop policy if exists sbx_select on public.audit_issue_log;
create policy sbx_select on public.audit_issue_log as restrictive for select
  using (not public.is_sandbox() or exists (select 1 from public.audit_issue i where i.id = issue_id and public.is_demo_engagement(i.engagement_id)));
drop policy if exists sbx_insert on public.audit_issue_log;
create policy sbx_insert on public.audit_issue_log as restrictive for insert
  with check (not public.is_sandbox() or exists (select 1 from public.audit_issue i where i.id = issue_id and public.is_demo_engagement(i.engagement_id)));

revoke execute on function public.audit_issue_before_ins(), public.audit_issue_before_upd() from public, anon, authenticated;
