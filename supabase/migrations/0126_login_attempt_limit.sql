-- 0126 인증 실패 제한 (「개인정보의 안전성 확보조치 기준」 제5조제6항)
--   "정당한 권한을 가진 자만이 개인정보처리시스템에 접근할 수 있도록
--    일정 횟수 이상 인증에 실패한 경우 개인정보처리시스템에 대한 접근을 제한하는 등 필요한 조치"
-- 시행일 2026-10-31(부칙 제2025-9호).
--
-- Supabase Auth 가 이미 하는 것과 하지 않는 것을 먼저 확인했다.
--   하는 것   — /auth/v1/verify·/token·MFA 챌린지의 **IP 단위** rate limit
--   안 하는 것 — **비밀번호 로그인 실패 횟수에 따른 계정 접근 제한**
-- 그래서 여기서 만든다.
--
-- ── 잠금 규칙 ───────────────────────────────────────────
-- 같은 (계정, 접속지) 에서 15분 안에 5회 실패하면 15분간 막는다.
--
-- **계정만으로 잠그지 않는다.** 남의 이메일만 알면 아무나 그 사람을 잠글 수 있기 때문이다
-- (그 자체가 서비스 거부 공격이 된다). 접속지까지 묶으면 무차별 대입은 막으면서
-- 정상 사용자는 자기 자리에서 계속 들어올 수 있다.
--
-- **마지막 성공 이후의 실패만 센다.** 한 번 들어오면 카운터가 저절로 풀린다 —
-- 어제 네 번 틀린 것이 오늘 한 번 틀렸다고 잠금으로 이어지면 안 된다.

create table if not exists public.login_attempt (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  email   text not null,
  ip      text,
  ok      boolean not null
);
create index if not exists login_attempt_lookup on public.login_attempt(email, ip, at desc);
comment on table public.login_attempt is
  '로그인 시도 — 제5조제6항 실패 횟수 제한용. 감사 증적은 access_log 가 정본.';
alter table public.login_attempt enable row level security;
drop policy if exists login_attempt_sel on public.login_attempt;
create policy login_attempt_sel on public.login_attempt for select using (
  coalesce((select role = 'superuser' from public.profiles where id = auth.uid()), false));
revoke insert, update, delete on public.login_attempt from anon, authenticated;

-- ── 접속기록 쓰기를 떼어낸다 ────────────────────────────
-- log_access 는 로그인한 사람이 부르는 것이라 auth.uid() 로 누구인지 안다.
-- 로그인 실패는 아직 세션이 없어 actor 를 직접 넘겨야 한다. 해시 체인은 한 곳에서만 잇는다.
create or replace function public.access_log_append(
  p_actor_id uuid, p_actor_name text, p_actor_email text,
  p_action text, p_target text, p_subject_id uuid, p_subject_name text,
  p_reason text, p_detail jsonb
) returns void language plpgsql security definer set search_path = public as $fn$
declare v_id bigint; v_prev text; v_ip text := public.client_ip(); v_ua text;
        v_at timestamptz := clock_timestamp(); v_hash text;
begin
  if p_action is null or btrim(p_action) = '' then return; end if;
  begin v_ua := left((current_setting('request.headers', true)::json) ->> 'user-agent', 400);
  exception when others then v_ua := null; end;
  perform pg_advisory_xact_lock(hashtext('public.access_log'));
  v_id := nextval('public.access_log_id_seq');
  select a.hash into v_prev from public.access_log a order by a.id desc limit 1;
  v_hash := encode(extensions.digest(
    coalesce(v_prev,'') || '|' || v_id::text || '|' || v_at::text || '|' ||
    coalesce(p_actor_id::text,'') || '|' || coalesce(v_ip,'') || '|' || p_action || '|' ||
    coalesce(p_target,'') || '|' || coalesce(p_subject_id::text,'') || '|' ||
    coalesce(p_reason,'') || '|' || coalesce(p_detail::text,''), 'sha256'), 'hex');
  insert into public.access_log
    (id, at, actor_id, actor_name, actor_email, ip, user_agent, action, target,
     subject_id, subject_name, reason, detail, prev_hash, hash)
  values
    (v_id, v_at, p_actor_id, p_actor_name, p_actor_email, v_ip, v_ua, p_action, p_target,
     p_subject_id, p_subject_name, p_reason, p_detail, v_prev, v_hash);
end $fn$;
-- 아무도 직접 못 부른다. 아래 두 함수(정의자 권한)만 거쳐 들어간다.
revoke all on function public.access_log_append(uuid, text, text, text, text, uuid, text, text, jsonb)
  from public, anon, authenticated;

create or replace function public.log_access(
  p_action text, p_target text default null, p_subject_id uuid default null,
  p_subject_name text default null, p_reason text default null, p_detail jsonb default null
) returns void language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); v_name text; v_email text;
begin
  select p.name into v_name from public.profiles p where p.id = v_uid;
  select u.email into v_email from auth.users u where u.id = v_uid;
  perform public.access_log_append(v_uid, v_name, v_email, p_action, p_target,
                                   p_subject_id, p_subject_name, p_reason, p_detail);
end $fn$;
revoke all on function public.log_access(text, text, uuid, text, text, jsonb) from public, anon;
grant execute on function public.log_access(text, text, uuid, text, text, jsonb) to authenticated;

-- ── 실패 횟수 ───────────────────────────────────────────
create or replace function public.login_fail_count(p_email text, p_ip text)
returns integer language sql stable security definer set search_path = public as $fn$
  select count(*)::int from public.login_attempt a
   where a.email = lower(btrim(p_email))
     and a.ip is not distinct from p_ip
     and not a.ok
     and a.at > now() - interval '15 minutes'
     and a.at > coalesce((select max(b.at) from public.login_attempt b
                           where b.email = lower(btrim(p_email))
                             and b.ip is not distinct from p_ip and b.ok), '-infinity'::timestamptz);
$fn$;

/** 로그인 **전에** 부른다 — 지금 이 자리에서 이 계정이 막혀 있는가. */
create or replace function public.login_gate(p_email text)
returns table(locked boolean, fails integer, retry_after_sec integer)
language plpgsql stable security definer set search_path = public as $fn$
declare v_ip text := public.client_ip(); v_n integer; v_last timestamptz;
begin
  v_n := public.login_fail_count(p_email, v_ip);
  select max(a.at) into v_last from public.login_attempt a
   where a.email = lower(btrim(p_email)) and a.ip is not distinct from v_ip and not a.ok;
  return query select
    v_n >= 5,
    v_n,
    greatest(0, 15 * 60 - extract(epoch from (now() - coalesce(v_last, now())))::int);
end $fn$;

/** 실패를 남긴다. 로그인 전이라 anon 도 부를 수 있어야 한다. */
create or replace function public.login_failed(p_email text)
returns table(locked boolean, fails integer, retry_after_sec integer)
language plpgsql volatile security definer set search_path = public as $fn$
declare v_ip text := public.client_ip(); v_email text := lower(btrim(p_email)); v_recent integer;
begin
  if v_email = '' or v_email is null then return query select false, 0, 0; return; end if;

  -- 이 함수는 로그인 전이라 anon 도 부를 수 있다. 이미 잠긴 뒤에도 계속 부르면 표만 불어나므로,
  -- 같은 자리에서 한 시간에 50줄까지만 쌓는다. 그 뒤로는 세지 않아도 이미 잠겨 있다.
  select count(*)::int into v_recent from public.login_attempt a
   where a.email = v_email and a.ip is not distinct from v_ip
     and a.at > now() - interval '1 hour';
  if v_recent < 50 then
    insert into public.login_attempt (email, ip, ok) values (v_email, v_ip, false);
  end if;

  -- 접속기록에도 남기되 폭주는 막는다 — 같은 자리에서 한 시간에 20줄까지.
  select count(*)::int into v_recent from public.access_log a
   where a.action = 'login_failed' and a.actor_email = v_email
     and a.ip is not distinct from v_ip and a.at > now() - interval '1 hour';
  if v_recent < 20 then
    perform public.access_log_append(null, null, v_email, 'login_failed', null, null, null, null, null);
  end if;
  return query select * from public.login_gate(v_email);
end $fn$;

/** 성공을 남긴다 — 이 줄 이후로 실패 카운터가 0 부터 다시 센다. */
create or replace function public.login_ok(p_email text)
returns void language plpgsql volatile security definer set search_path = public as $fn$
begin
  insert into public.login_attempt (email, ip, ok) values (lower(btrim(p_email)), public.client_ip(), true);
end $fn$;

revoke all on function public.login_fail_count(text, text) from public, anon, authenticated;
revoke all on function public.login_gate(text) from public;
revoke all on function public.login_failed(text) from public;
revoke all on function public.login_ok(text) from public, anon;
grant execute on function public.login_gate(text) to anon, authenticated;
grant execute on function public.login_failed(text) to anon, authenticated;
grant execute on function public.login_ok(text) to authenticated;
