-- 0211 금감원 자료 수집(fss-sync) 상태 · 실행 기록 · 예약 (인계 3단계, 2026-11-27).
--
-- 개인용 키 한도(2026-11-27 실측): 한 번에 최대 1개월(030) · 하루 30회(033).
--   매일 = 최근 14일 증분 7회 + 남는 호출로 백필(최근 달부터 거꾸로, 2011-01 까지). 사용자 결정 「천천히 채우기」.
--   하루 27회까지만 쓴다 — 3회는 로컬 스크립트(scripts/fss/fss_openapi.py) 몫.
-- 예약은 pg_cron → pg_net 으로 엣지함수를 부른다. 함수는 JWT 대신 이 표의 토큰(x-fss-sync 머리)으로 cron 을 알아본다.
--   토큰은 이 DB 안에만 있다(쓰기·읽기 정책 없음 → service_role · postgres 만).

-- 백필 진행 — (종류, 달) 하나를 다 받았으면 한 줄. 자료 없음(900)도 받은 것으로 친다.
create table if not exists public.fss_sync_month (
  api        text not null,
  ym         text not null check (ym ~ '^\d{4}-\d{2}$'),
  n          int  not null default 0,
  fetched_at timestamptz not null default now(),
  primary key (api, ym)
);

-- 실행 기록 — 호출 수(하루 한도 세기) · 넣은/바뀐/임베딩 건수 · 오류.
create table if not exists public.fss_sync_run (
  id         bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  mode       text not null,            -- daily · backfill · manual
  calls      int  not null default 0,  -- 금감원 호출 수(033 도 한 번으로 센다)
  inserted   int  not null default 0,
  updated    int  not null default 0,
  embedded   int  not null default 0,
  months     text[] not null default '{}',   -- 백필한 (종류:달)
  error      text,
  detail     jsonb
);
create index if not exists fss_sync_run_started_idx on public.fss_sync_run (started_at desc);

create table if not exists public.fss_sync_secret (
  id    int primary key default 1 check (id = 1),
  token text not null default encode(extensions.gen_random_bytes(24), 'hex')
);
insert into public.fss_sync_secret (id) values (1) on conflict (id) do nothing;

alter table public.fss_sync_month  enable row level security;
alter table public.fss_sync_run    enable row level security;
alter table public.fss_sync_secret enable row level security;
-- 진행 · 기록은 최고관리자만 본다(⚙️ 서비스 한도 화면용). 토큰 표는 정책 없음.
drop policy if exists fss_sync_month_sel on public.fss_sync_month;
create policy fss_sync_month_sel on public.fss_sync_month for select to authenticated using (public.is_superuser());
drop policy if exists fss_sync_run_sel on public.fss_sync_run;
create policy fss_sync_run_sel on public.fss_sync_run for select to authenticated using (public.is_superuser());

-- 오늘(한국 시각) 쓴 금감원 호출 수.
create or replace function public.fss_calls_today()
returns int language sql stable set search_path = public as $$
  select coalesce(sum(calls), 0)::int from public.fss_sync_run
   where started_at >= (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul');
$$;
revoke execute on function public.fss_calls_today() from public, anon, authenticated;
grant execute on function public.fss_calls_today() to service_role;

-- 실패 한 줄 — 접속기록에 「금감원 수집 실패」로(⚙️ 접속기록 점검에서 보인다). 엣지함수(service_role)만 부른다.
create or replace function public.fss_sync_log_failure(p_msg text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.access_log_append(null, '금감원 수집(fss-sync)', null, 'fss_sync_failed', left(p_msg, 300), null, null, null, null);
end; $$;
revoke execute on function public.fss_sync_log_failure(text) from public, anon, authenticated;
grant execute on function public.fss_sync_log_failure(text) to service_role;

-- 예약 — 매일 07:30 KST(22:30 UTC 전날). 평일 아침 브리핑 전에 끝나고, 주말에도 돌아 백필이 빨리 끝난다.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'fss-sync') then perform cron.unschedule('fss-sync'); end if;
  perform cron.schedule('fss-sync', '30 22 * * *', $cron$
    select net.http_post(
      url := 'https://rboqmlwwwgrntasftwki.supabase.co/functions/v1/fss-sync',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'x-fss-sync', (select token from public.fss_sync_secret where id = 1)),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000);
  $cron$);
end $$;
