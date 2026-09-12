-- 0143 주석·DSD 관리 — ① 대상 거래처와 사업연도
--
-- 감사 주석을 엑셀에서 검증하고 DSD 파일로 옮기는 일의 **뿌리**다.
-- 여기서 만드는 것은 「어느 회사의 어느 해를 다루는가」와 「그 해에 어떤 주석을 쓰는가」이고,
-- 검증·생성은 이 두 표를 읽어 돌아간다.
--
-- ⚠️ **재무제표 파일은 여기 저장하지 않는다.** 엑셀도 DSD 도 브라우저 안에서만 열고
--    브라우저 안에서 끝낸다. 미공시 재무정보를 클라우드에 쌓지 않기 위해서다.
--    남는 것은 주석 목록과 대응 규칙, 그리고 실행 이력 요약뿐이다.
--
-- 실측 근거(2026-09-12, 넵튠 FY24·FY25 · 명진산업개발 FY25):
--   · DSD 는 ZIP 안의 XML 한 장이고 회사가 달라져도 문법이 같다 — 명진(일반기업회계기준·
--     비상장)에 넵튠(K-IFRS·상장)용 파서를 고치지 않고 그대로 돌렸다.
--   · 그래서 회사별로 필요한 것은 「엑셀 칸 ↔ DSD 칸」 대응표 하나뿐이고, 그 대응표를
--     해마다 살리는 열쇠가 아래 note.code(불변 주석코드)다.

-- ── 대상 거래처와 사업연도 ──────────────────────────────────────────
create table if not exists public.dsd_engagement (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references public.biz_entity(id) on delete restrict,
  fy          integer not null,                     -- 사업연도(결산일이 속한 해). 2025 = 제18기
  scope       text not null default '별도' check (scope in ('별도', '연결')),
  term_no     integer,                              -- 기수. 제18기면 18
  period_from date,
  period_to   date,
  basis       text not null default 'K-IFRS'
              check (basis in ('K-IFRS', '일반기업회계기준')),
  -- 금액 표시 단위. **환산이 필요한 것은 원화 금액뿐**이고, 주식수·지분율·외화는
  -- 적힌 그대로 나간다. 엑셀은 언제나 장부 그대로 '원'으로 쓰고 여기 적힌 단위로 내보낸다.
  -- 실무 표준은 천원이라 기본값을 천원으로 둔다(1원 단위 표기는 예외).
  money_unit  text not null default '천원' check (money_unit in ('천원', '원')),
  status      text not null default '준비'
              check (status in ('준비', '진행', '완료')),
  note        text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now(),
  unique (entity_id, fy, scope)
);
comment on table public.dsd_engagement is
  '주석·DSD 작업 단위. 거래처 × 사업연도 × 별도/연결. 재무제표 파일은 저장하지 않는다.';
comment on column public.dsd_engagement.fy is
  '결산일이 속한 해. 2025-12-31 결산이면 2025.';
comment on column public.dsd_engagement.money_unit is
  '원화 금액을 DSD 에 적을 단위. 엑셀은 늘 원이고 여기서 환산한다(반올림). 주식수·%·외화는 환산 대상이 아니다.';

-- ── 그 해에 쓰는 주석 목록 ─────────────────────────────────────────
create table if not exists public.dsd_note (
  id            uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.dsd_engagement(id) on delete cascade,
  -- **해마다 바뀌지 않는 열쇠.** 주석 번호는 하나가 빠지면 통째로 밀린다 — 올해 17번이
  -- 내년엔 16번이 된다. 대응표와 검증규칙이 해를 넘어 살아남게 하려고 코드를 따로 둔다.
  code          text not null,
  no            integer,                            -- 올해 주석 번호(표시용)
  title         text not null,
  sheet         text,                               -- 엑셀 시트명. 한 주석에 한 시트다.
  -- 켜기/끄기. 올해 안 쓰는 주석은 끄면 검증에서도 생성에서도 빠진다.
  enabled       boolean not null default true,
  -- 회사가 직접 쓰는 주석(특수관계자 거래 등)은 엑셀이 원천이 아니라 대조 대상이 아니다.
  -- 넵튠에서 그 표만 대조율이 유독 낮았다 — 섞어 세면 허위 경보가 된다.
  source        text not null default '감사인' check (source in ('감사인', '회사')),
  assignee      text,                               -- 담당자 이름(profiles.name 과 같은 표기)
  status        text not null default '미할당'
                check (status in ('미할당', '작업중', '작업완료', '작성제외')),
  memo          text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (engagement_id, code)
);
comment on table public.dsd_note is
  '그 해에 쓰는 주석 목록. code 는 해가 바뀌어도 안 변하는 열쇠라 다음 해로 복제된다.';
comment on column public.dsd_note.code is
  '불변 주석코드(INTANGIBLE·RELATED_PARTY 등). 주석 번호는 해마다 밀리므로 번호를 열쇠로 쓰지 않는다.';
comment on column public.dsd_note.source is
  '회사가 직접 쓰는 주석은 엑셀이 원천이 아니라 대조 대상에서 뺀다.';

create index if not exists dsd_note_eng_idx on public.dsd_note(engagement_id, sort_order);

-- ── 갱신시각 ────────────────────────────────────────────────────
create or replace function public.dsd_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists dsd_engagement_touch on public.dsd_engagement;
create trigger dsd_engagement_touch before update on public.dsd_engagement
  for each row execute function public.dsd_touch();
drop trigger if exists dsd_note_touch on public.dsd_note;
create trigger dsd_note_touch before update on public.dsd_note
  for each row execute function public.dsd_touch();

-- ── 권한 ───────────────────────────────────────────────────────
-- 감사 실무자가 함께 쓰는 자리다(지금은 담당 다섯 명이 엑셀 파일을 주고받고 있다).
-- 외부인은 못 보고, 조회전용은 읽기만 한다. 급여 자료가 아니므로 가리는 사람은 없다.
alter table public.dsd_engagement enable row level security;
drop policy if exists dsd_engagement_sel on public.dsd_engagement;
create policy dsd_engagement_sel on public.dsd_engagement for select
  using (not public.is_external());
drop policy if exists dsd_engagement_write on public.dsd_engagement;
create policy dsd_engagement_write on public.dsd_engagement for all
  using (not public.is_external() and not public.is_readonly())
  with check (not public.is_external() and not public.is_readonly());

alter table public.dsd_note enable row level security;
drop policy if exists dsd_note_sel on public.dsd_note;
create policy dsd_note_sel on public.dsd_note for select
  using (not public.is_external());
drop policy if exists dsd_note_write on public.dsd_note;
create policy dsd_note_write on public.dsd_note for all
  using (not public.is_external() and not public.is_readonly())
  with check (not public.is_external() and not public.is_readonly());
