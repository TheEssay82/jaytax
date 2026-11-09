-- 0191 K-IFRS 1118 월결산 — 월 마감 · 작업 기록(사용자 2026-11-09 「실제 마감 기능 · 결산월별 log · dashboard」).
--
-- ① ifrs18_close — 월 마감. 마감할 때의 결과 요약(누적 · 당월 · 당분기 손익, 확인 결과, 원천 파일)을 남긴다.
--    분개장은 여전히 서버에 두지 않는다 — 숫자 요약만. 마감된 달의 주의계정 판단은 화면에서 잠긴다.
--    마감 해제는 지운다(해제 사유는 ifrs18_log 에 남는다).
-- ② ifrs18_log — 작업 기록(분개장 읽음 · 판단 저장/삭제 · 마감/해제 · 엑셀 내려받기). 쓰기만 하고 고치거나 지우지 않는다.
-- 권한은 0189 와 같다: ifrs18_can(회사키) — 인덕 직원 전부, 회사 담당자는 연결된 회사만.

create table if not exists public.ifrs18_close (
  client_key  text not null references public.ifrs18_client (key) on delete cascade,
  year        int  not null check (year between 2020 and 2100),
  month       int  not null check (month between 1 and 12),
  summary     jsonb not null,
  by_name     text,
  by_id       uuid default auth.uid() references auth.users (id) on delete set null,
  at          timestamptz not null default now(),
  primary key (client_key, year, month)
);

create table if not exists public.ifrs18_log (
  id          bigint generated always as identity primary key,
  client_key  text not null references public.ifrs18_client (key) on delete cascade,
  year        int,
  month       int,
  action      text not null check (action in ('분개장 읽음', '판단 저장', '판단 삭제', '마감', '마감 해제', '엑셀 내려받기')),
  detail      jsonb not null default '{}'::jsonb,
  by_name     text,
  by_id       uuid default auth.uid() references auth.users (id) on delete set null,
  at          timestamptz not null default now()
);
create index if not exists idx_ifrs18_log_client_at on public.ifrs18_log (client_key, at desc);

alter table public.ifrs18_close enable row level security;
alter table public.ifrs18_log enable row level security;

create policy ifrs18_close_sel on public.ifrs18_close for select to authenticated using ((select public.ifrs18_can(client_key)));
create policy ifrs18_close_ins on public.ifrs18_close for insert to authenticated
  with check ((select public.ifrs18_can(client_key)) and not coalesce((select public.is_readonly()), false));
create policy ifrs18_close_upd on public.ifrs18_close for update to authenticated
  using ((select public.ifrs18_can(client_key)) and not coalesce((select public.is_readonly()), false))
  with check ((select public.ifrs18_can(client_key)));
create policy ifrs18_close_del on public.ifrs18_close for delete to authenticated
  using ((select public.ifrs18_can(client_key)) and not coalesce((select public.is_readonly()), false));

create policy ifrs18_log_sel on public.ifrs18_log for select to authenticated using ((select public.ifrs18_can(client_key)));
create policy ifrs18_log_ins on public.ifrs18_log for insert to authenticated
  with check ((select public.ifrs18_can(client_key)) and by_id = (select auth.uid()));

comment on table public.ifrs18_close is 'K-IFRS 1118 월결산 — 월 마감(결과 요약). 원장은 서버에 두지 않는다.';
comment on table public.ifrs18_log is 'K-IFRS 1118 월결산 — 작업 기록(쓰기만, 수정 · 삭제 없음).';
