-- 0152 일반조서 당기 세팅(gwp_year) — 조서 양식 기준을 재무제표 회계기준에서 떼어 낸다.
--
-- 왜: 0148 은 조서 양식 기준(K-IFRS·일반·소규모)을 `dsd_engagement.basis`(주석·DSD 의 재무제표 회계기준 칸)에
-- 겹쳐 담았다. 소규모감사기준은 감사 쪽 기준이지 회계기준이 아니다 — 명진처럼 재무제표는 일반기업회계기준인데
-- 조서는 소규모 양식을 쓰는 회사가 있다. 게다가 일반↔소규모는 해마다 감사계약 때 바뀔 수 있다(사용자 2026-09-26).
-- 그래서 조서 기준·검토자(파트너)·작성자 기본값을 「일반조서 당기 세팅」 한 곳에 따로 둔다(사용자 결정 2026-09-26).
--
-- 설계서: docs/일반조서/설계.md (3절·4절).

create table if not exists public.gwp_year (
  id                  uuid primary key default gen_random_uuid(),
  engagement_id       uuid not null unique references public.dsd_engagement(id) on delete restrict,
  -- 조서 양식 기준 — 표준양식 묶음(gwp_template.basis)과 같은 값을 쓴다.
  audit_basis         text not null check (audit_basis in ('K-IFRS', '일반기업회계기준', '소규모감사기준')),
  -- 감사계약에서 정한 값으로 확인한 때·사람. 이월·새로 만들기는 확인된 세팅이 있어야 열린다.
  basis_confirmed_at  timestamptz,
  basis_confirmed_by  uuid references auth.users(id) on delete set null,
  -- 검토자(파트너, 담당이사). 2026-09 지금은 전 회사 조현규.
  partner             text not null default '조현규',
  -- 작성자 기본값 — 그 회사 감사 매출계약의 담당회계사. 조서마다 바꿀 수 있다(3단계).
  author_default      text,
  stage               text not null default '계획' check (stage in ('계획', '중간', '기말', '완료')),
  note                text,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id) on delete set null,
  updated_at          timestamptz not null default now()
);
comment on table public.gwp_year is
  '일반조서 당기 세팅 — 작업 건마다 하나. 조서 양식 기준(재무제표 회계기준과 다른 값)·검토자·작성자 기본값·진행 단계.';
comment on column public.gwp_year.audit_basis is
  '조서 양식 기준. K-IFRS 조서면 재무제표는 K-IFRS, 일반·소규모면 둘 다 일반기업회계기준.';

drop trigger if exists gwp_year_created_by on public.gwp_year;
create trigger gwp_year_created_by before insert on public.gwp_year
  for each row execute function public.biz_set_created_by();
drop trigger if exists gwp_year_touch on public.gwp_year;
create trigger gwp_year_touch before update on public.gwp_year
  for each row execute function public.dsd_touch();

alter table public.gwp_year enable row level security;
drop policy if exists gwp_year_sel on public.gwp_year;
create policy gwp_year_sel on public.gwp_year for select
  using (public.is_audit_staff());
drop policy if exists gwp_year_ins on public.gwp_year;
create policy gwp_year_ins on public.gwp_year for insert
  with check (public.is_audit_staff() and not public.is_readonly());
drop policy if exists gwp_year_upd on public.gwp_year;
create policy gwp_year_upd on public.gwp_year for update
  using (public.is_audit_staff() and not public.is_readonly())
  with check (public.is_audit_staff() and not public.is_readonly());
-- 지우기 정책은 두지 않는다 — 세팅은 고칠 뿐이다.

-- ── 주석·DSD 의 회계기준 칸은 회계기준만 담는다 ─────────────────────
-- 2026-09-26 현재 소규모로 저장된 건은 0건(K-IFRS 1 · 일반기업 18). 남아 있으면 아래 제약이 실패해 알려 준다.
alter table public.dsd_engagement drop constraint if exists dsd_engagement_basis_check;
alter table public.dsd_engagement
  add constraint dsd_engagement_basis_check
  check (basis in ('K-IFRS', '일반기업회계기준'));
