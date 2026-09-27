-- 0153 일반조서 — 자료함(DSD·정산표) · 웹 조서 · 단계 확정
--
-- 사용자 2026-09-27:
--   · 「DSD·정산표 파일을 왜 저장하면 안 돼? 저장을 하는 게 더 편리해 보여」 — 주석·DSD 시스템의 「파일은 서버에 안 올린다」
--     기본값을 거둔다. 일반조서 워크북(재무 숫자가 다 든 파일)을 이미 같은 버킷·같은 권한으로 두고 있어 보호 수준이 같다.
--     작업 건마다 자료함에 두고 2120A(전기 DSD)·8110ARP(확정 정산표)가 다시 고르지 않고 쓴다.
--   · 일부 조서는 JAYTAX 화면에서 쓰고(웹 조서) 단계마다 [확정]한다. 단계는 실무 순서대로
--     1차 = 중간감사 전(계획) · 2차 = 중간감사 후 · 3차 = 기말감사 완료 후.
--
-- 확정 기록은 쌓기만 한다 — 확정·확정 취소 모두 새 줄(취소는 사유 필수). 확정한 판(gwp_book)은 원래 고칠 수 없다(외감법 제19조).

-- ── 자료함 ─────────────────────────────────────────────────────────
create table if not exists public.engagement_file (
  id             uuid primary key default gen_random_uuid(),
  engagement_id  uuid not null references public.dsd_engagement(id) on delete restrict,
  -- 전기DSD = 전기 감사보고서 DSD(당기 계획단계 2120A·2301·2700A-2 의 숫자) · 당기DSD · 정산표(기말 확정 정산표, 8110ARP)
  kind           text not null check (kind in ('전기DSD', '당기DSD', '정산표')),
  storage_path   text not null,                       -- gwp 버킷 files/<건>/<uuid>.<확장자>
  file_name      text not null default '',
  file_size      bigint not null default 0,
  meta           jsonb not null default '{}'::jsonb,  -- 브라우저에서 읽어 둔 요약(시트 이름·재무제표 줄 수 등)
  memo           text,
  uploaded_by    uuid references auth.users(id) on delete set null,
  uploaded_email text,
  created_at     timestamptz not null default now()
);
comment on table public.engagement_file is
  '작업 건 자료함 — 전기DSD·당기DSD·정산표. 같은 종류를 다시 올리면 줄이 늘고 최신 것을 쓴다(지우지 않는다).';
create index if not exists engagement_file_eng_idx on public.engagement_file(engagement_id, kind, created_at desc);

alter table public.engagement_file enable row level security;
drop policy if exists engagement_file_sel on public.engagement_file;
create policy engagement_file_sel on public.engagement_file for select
  using (public.is_audit_staff());
drop policy if exists engagement_file_ins on public.engagement_file;
create policy engagement_file_ins on public.engagement_file for insert
  with check (public.is_audit_staff() and not public.is_readonly());
-- 메모만 고친다.
drop policy if exists engagement_file_upd on public.engagement_file;
create policy engagement_file_upd on public.engagement_file for update
  using (public.is_audit_staff() and not public.is_readonly())
  with check (public.is_audit_staff() and not public.is_readonly());
create or replace function public.engagement_file_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.engagement_id <> old.engagement_id or new.kind <> old.kind or new.storage_path <> old.storage_path
     or new.file_name <> old.file_name or new.file_size <> old.file_size
     or new.uploaded_by is distinct from old.uploaded_by or new.created_at <> old.created_at then
    raise exception '자료함 파일은 고칠 수 없습니다 — 새로 올리십시오.';
  end if;
  return new;
end $$;
drop trigger if exists engagement_file_guard on public.engagement_file;
create trigger engagement_file_guard before update on public.engagement_file
  for each row execute function public.engagement_file_guard();

-- ── 웹 조서 — 조서마다 화면에서 쓴 값 ─────────────────────────────
create table if not exists public.gwp_paper (
  id              uuid primary key default gen_random_uuid(),
  engagement_id   uuid not null references public.dsd_engagement(id) on delete restrict,
  code            text not null,                      -- 웹 조서 열쇠: 2110A · 2110 · 2120A · 2301 · 2700A-1 … · 8110ARP
  data            jsonb not null default '{}'::jsonb, -- 화면 입력값(조서마다 모양이 다르다 — 프론트의 조서 정의가 읽는다)
  -- 작성중 → 확인(엑셀에 반영함) · 엑셀로 넘김(정본이 엑셀로 바뀜 — 별도조서를 붙여 보완)
  status          text not null default '작성중' check (status in ('작성중', '확인', '엑셀로 넘김')),
  applied_version integer,                            -- 반영된 판 번호(gwp_book.version)
  checked_by      uuid references auth.users(id) on delete set null,
  checked_at      timestamptz,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now(),
  unique (engagement_id, code)
);
comment on table public.gwp_paper is
  '웹 조서 — JAYTAX 화면에서 쓰는 일반조서(2110A·2700A-2 등). 확인하면 엑셀 판에 써 넣는다. 엑셀로 넘기면 정본이 엑셀.';

drop trigger if exists gwp_paper_created_by on public.gwp_paper;
create trigger gwp_paper_created_by before insert on public.gwp_paper
  for each row execute function public.biz_set_created_by();
drop trigger if exists gwp_paper_touch on public.gwp_paper;
create trigger gwp_paper_touch before update on public.gwp_paper
  for each row execute function public.dsd_touch();

alter table public.gwp_paper enable row level security;
drop policy if exists gwp_paper_sel on public.gwp_paper;
create policy gwp_paper_sel on public.gwp_paper for select
  using (public.is_audit_staff());
drop policy if exists gwp_paper_ins on public.gwp_paper;
create policy gwp_paper_ins on public.gwp_paper for insert
  with check (public.is_audit_staff() and not public.is_readonly());
drop policy if exists gwp_paper_upd on public.gwp_paper;
create policy gwp_paper_upd on public.gwp_paper for update
  using (public.is_audit_staff() and not public.is_readonly())
  with check (public.is_audit_staff() and not public.is_readonly());
-- 지우기 정책은 두지 않는다.

-- ── 단계 확정 기록 ────────────────────────────────────────────────
create table if not exists public.gwp_stage_event (
  id             uuid primary key default gen_random_uuid(),
  engagement_id  uuid not null references public.dsd_engagement(id) on delete restrict,
  stage          smallint not null check (stage between 1 and 3),   -- 1 중간감사 전 · 2 중간감사 후 · 3 기말감사 완료 후
  action         text not null check (action in ('확정', '확정 취소')),
  book_version   integer,                                           -- 확정한 판(gwp_book.version)
  reason         text,
  created_by     uuid references auth.users(id) on delete set null default auth.uid(),
  created_email  text,
  created_at     timestamptz not null default now(),
  check (action = '확정' or coalesce(length(trim(reason)), 0) > 0)
);
comment on table public.gwp_stage_event is
  '일반조서 단계 확정 기록 — 쌓기만 한다. 단계의 지금 상태는 그 단계의 마지막 줄. 확정 취소는 사유를 남긴다.';
create index if not exists gwp_stage_event_eng_idx on public.gwp_stage_event(engagement_id, stage, created_at desc);

alter table public.gwp_stage_event enable row level security;
drop policy if exists gwp_stage_event_sel on public.gwp_stage_event;
create policy gwp_stage_event_sel on public.gwp_stage_event for select
  using (public.is_audit_staff());
drop policy if exists gwp_stage_event_ins on public.gwp_stage_event;
create policy gwp_stage_event_ins on public.gwp_stage_event for insert
  with check (public.is_audit_staff() and not public.is_readonly() and created_by = auth.uid());
-- 고치기·지우기 정책은 두지 않는다.

-- 새 트리거 함수는 PUBLIC 부터 뺀다(0150 원칙 — 트리거는 발화할 때 EXECUTE 를 검사하지 않는다).
revoke execute on function public.engagement_file_guard() from public, anon, authenticated;
