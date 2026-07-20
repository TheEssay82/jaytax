-- 0040: 공지사항(내부홈 전광판)
-- 한 줄짜리 공지를 내부홈 상단에 흐르게 표시한다.
-- 조회는 로그인한 내부 구성원 전원, 작성·수정·삭제는 최고관리자(superuser)만.

create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  message     text not null check (length(btrim(message)) > 0),
  is_active   boolean not null default true,
  -- 여러 건일 때 표시 순서(작은 값 먼저). 같으면 최신 작성순.
  sort_order  integer not null default 0,
  created_by  uuid references auth.users(id),
  -- doc_touch_updated() 트리거가 채운다(컬럼이 없으면 update 시 42703).
  updated_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists announcements_active_idx
  on public.announcements (is_active, sort_order, created_at desc);

-- updated_at 자동 갱신 (기존 공용 트리거 함수 재사용)
drop trigger if exists trg_announcements_touch on public.announcements;
create trigger trg_announcements_touch
  before update on public.announcements
  for each row execute function public.doc_touch_updated();

alter table public.announcements enable row level security;

-- 조회: 로그인한 내부 구성원(외부인 제외)
drop policy if exists announcements_sel on public.announcements;
create policy announcements_sel on public.announcements
  for select to authenticated
  using (not public.is_external());

-- 작성·수정·삭제: 최고관리자만
drop policy if exists announcements_ins on public.announcements;
create policy announcements_ins on public.announcements
  for insert to authenticated
  with check (public.auth_role() = 'superuser');

drop policy if exists announcements_upd on public.announcements;
create policy announcements_upd on public.announcements
  for update to authenticated
  using (public.auth_role() = 'superuser')
  with check (public.auth_role() = 'superuser');

drop policy if exists announcements_del on public.announcements;
create policy announcements_del on public.announcements
  for delete to authenticated
  using (public.auth_role() = 'superuser');

-- 읽기전용 계정은 쓰기 차단(다른 테이블과 동일 규칙)
drop policy if exists ro_block_insert on public.announcements;
create policy ro_block_insert on public.announcements
  as restrictive for insert to authenticated with check (not public.is_readonly());

drop policy if exists ro_block_update on public.announcements;
create policy ro_block_update on public.announcements
  as restrictive for update to authenticated using (not public.is_readonly());

drop policy if exists ro_block_delete on public.announcements;
create policy ro_block_delete on public.announcements
  as restrictive for delete to authenticated using (not public.is_readonly());

-- 첫 공지
insert into public.announcements (message, sort_order)
select '2026-08-01 기존 EXCEL버젼 문서발송업무 Jaytax로 완전이관 예정', 0
where not exists (select 1 from public.announcements);
