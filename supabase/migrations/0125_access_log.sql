-- 0125 접속기록 (「개인정보의 안전성 확보조치 기준」 제8조)
--
-- 고시 제2조제3호가 접속기록을 이렇게 정의한다 —
--   "식별자, 접속일시, **접속지 정보**, **처리한 정보주체 정보**, 수행업무 등을 전자적으로 기록한 것"
-- 지금 앱에 있는 업무 로그(biz_audit_log 등)에는 **접속지(IP)가 없고**, 로그인도
-- 주민번호 열람도 남지 않는다. 그래서 별도로 만든다.
--
-- 보관기간: 제8조제1항 본문 1년 이상, 단서 제2호 **고유식별정보·민감정보를 처리하는
-- 시스템은 2년 이상**. jaytax 는 주민번호를 다루므로 **2년**이다.
-- 시행일 2026-10-31(부칙 제2025-9호).
--
-- ── 설계에서 지킨 것 ────────────────────────────────────
--  1. **IP 는 서버가 적는다.** 브라우저는 자기 공인 IP 를 모르고, 안다 해도 클라이언트가
--     보낸 값은 증거가 못 된다. PostgREST 가 넘겨 주는 request.headers 에서 읽는다.
--  2. **고칠 수 없어야 한다(제8조제3항).** UPDATE·DELETE 정책을 아예 두지 않는다.
--     INSERT 도 직접 못 하고 log_access() 를 거쳐야 한다 — 남이 위조한 줄을 끼워 넣지 못한다.
--  3. **지웠는지 알 수 있어야 한다.** 줄마다 앞줄의 해시를 물고 자기 해시를 만든다(해시 체인).
--     한 줄이라도 고치거나 빼면 그 뒤가 전부 어긋나 access_log_verify() 로 드러난다.
--  4. **사람이 빠뜨릴 수 없어야 한다.** 주민번호·홈택스PW 열람은 화면이 아니라
--     **복호화 함수 안에서** 기록한다. 새 화면을 만들어도 저절로 남는다.

create table if not exists public.access_log (
  id           bigint primary key,
  at           timestamptz not null default now(),
  -- 식별자
  actor_id     uuid,
  actor_name   text,
  actor_email  text,
  -- 접속지 정보
  ip           text,
  user_agent   text,
  -- 수행업무
  action       text not null,            -- 'login' | 'logout' | 'reveal_resident' | 'download' | …
  target       text,                     -- 어느 화면·자료인지
  -- 처리한 정보주체 정보
  subject_id   uuid,
  subject_name text,
  -- 부가 (다운로드 사유 등)
  reason       text,
  detail       jsonb,
  -- 위·변조 탐지용 해시 체인
  prev_hash    text,
  hash         text not null
);
create sequence if not exists public.access_log_id_seq owned by public.access_log.id;
create index if not exists access_log_at_idx      on public.access_log(at desc);
create index if not exists access_log_actor_idx   on public.access_log(actor_id, at desc);
create index if not exists access_log_action_idx  on public.access_log(action, at desc);
create index if not exists access_log_subject_idx on public.access_log(subject_id, at desc);

comment on table public.access_log is
  '접속기록 — 안전성 확보조치 기준 제8조. 고유식별정보를 처리하므로 2년 이상 보관. 수정·삭제 불가(해시 체인으로 탐지).';

alter table public.access_log enable row level security;

-- 읽기: 개인정보 보호책임자(최고관리자)만. 남의 접속기록은 그 자체가 개인정보다.
drop policy if exists access_log_sel on public.access_log;
create policy access_log_sel on public.access_log
  for select using (
    coalesce((select role = 'superuser' from public.profiles where id = auth.uid()), false)
  );
-- 쓰기 정책은 두지 않는다. INSERT·UPDATE·DELETE 어느 것도 앱에서 직접 할 수 없다.
revoke insert, update, delete on public.access_log from anon, authenticated;

-- ── 접속지(IP) 읽기 ─────────────────────────────────────
-- PostgREST 는 요청 헤더를 request.headers GUC 로 넘긴다. 프록시를 거치면 x-forwarded-for 에
-- 'client, proxy1, proxy2' 로 쌓이므로 **맨 앞**이 실제 접속지다.
create or replace function public.client_ip() returns text
language plpgsql stable security definer set search_path = public as $$
declare h json; v text;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then return null; end;
  if h is null then return null; end if;
  v := coalesce(h ->> 'x-forwarded-for', h ->> 'cf-connecting-ip', h ->> 'x-real-ip');
  if v is null then return null; end if;
  return btrim(split_part(v, ',', 1));
end $$;

-- ── 기록 ────────────────────────────────────────────────
create or replace function public.log_access(
  p_action       text,
  p_target       text default null,
  p_subject_id   uuid default null,
  p_subject_name text default null,
  p_reason       text default null,
  p_detail       jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id    bigint;
  v_prev  text;
  v_uid   uuid := auth.uid();
  v_name  text;
  v_email text;
  v_ip    text := public.client_ip();
  v_ua    text;
  v_at    timestamptz := clock_timestamp();
  v_hash  text;
begin
  if p_action is null or btrim(p_action) = '' then return; end if;

  select p.name into v_name from public.profiles p where p.id = v_uid;
  select u.email into v_email from auth.users u where u.id = v_uid;
  begin
    v_ua := left((current_setting('request.headers', true)::json) ->> 'user-agent', 400);
  exception when others then v_ua := null;
  end;

  -- 해시 체인은 순서가 있어야 한다 — 같은 순간에 두 줄이 같은 앞줄을 물면 체인이 갈라진다.
  perform pg_advisory_xact_lock(hashtext('public.access_log'));
  v_id := nextval('public.access_log_id_seq');
  select a.hash into v_prev from public.access_log a order by a.id desc limit 1;

  v_hash := encode(extensions.digest(
    coalesce(v_prev, '') || '|' || v_id::text || '|' || v_at::text || '|' ||
    coalesce(v_uid::text, '') || '|' || coalesce(v_ip, '') || '|' || p_action || '|' ||
    coalesce(p_target, '') || '|' || coalesce(p_subject_id::text, '') || '|' ||
    coalesce(p_reason, '') || '|' || coalesce(p_detail::text, ''), 'sha256'), 'hex');

  insert into public.access_log
    (id, at, actor_id, actor_name, actor_email, ip, user_agent,
     action, target, subject_id, subject_name, reason, detail, prev_hash, hash)
  values
    (v_id, v_at, v_uid, v_name, v_email, v_ip, v_ua,
     p_action, p_target, p_subject_id, p_subject_name, p_reason, p_detail, v_prev, v_hash);
end $$;

revoke all on function public.log_access(text, text, uuid, text, text, jsonb) from public, anon;
grant execute on function public.log_access(text, text, uuid, text, text, jsonb) to authenticated;
revoke all on function public.client_ip() from public, anon;
grant execute on function public.client_ip() to authenticated;

-- ── 무결성 검증 ─────────────────────────────────────────
-- 한 줄이라도 고치거나 지우면 그 뒤의 해시가 전부 어긋난다. 처음 어긋난 자리를 돌려준다.
create or replace function public.access_log_verify(p_from timestamptz default null)
returns table(checked bigint, ok boolean, first_bad_id bigint, first_bad_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare r record; v_prev text; v_calc text; v_n bigint := 0; v_bad bigint := null; v_bad_at timestamptz;
begin
  if not coalesce((select role = 'superuser' from public.profiles where id = auth.uid()), false) then
    raise exception '접속기록 검증 권한이 없습니다';
  end if;
  for r in
    select * from public.access_log
     where p_from is null or at >= p_from
     order by id
  loop
    v_n := v_n + 1;
    if v_bad is null then
      -- 첫 줄은 앞줄이 조회범위 밖일 수 있으므로 그 줄이 적어 둔 prev_hash 를 그대로 믿는다.
      if v_prev is null then v_prev := r.prev_hash; end if;
      v_calc := encode(extensions.digest(
        coalesce(v_prev, '') || '|' || r.id::text || '|' || r.at::text || '|' ||
        coalesce(r.actor_id::text, '') || '|' || coalesce(r.ip, '') || '|' || r.action || '|' ||
        coalesce(r.target, '') || '|' || coalesce(r.subject_id::text, '') || '|' ||
        coalesce(r.reason, '') || '|' || coalesce(r.detail::text, ''), 'sha256'), 'hex');
      if v_calc is distinct from r.hash then v_bad := r.id; v_bad_at := r.at; end if;
      v_prev := r.hash;
    end if;
  end loop;
  return query select v_n, v_bad is null, v_bad, v_bad_at;
end $$;
revoke all on function public.access_log_verify(timestamptz) from public, anon;
grant execute on function public.access_log_verify(timestamptz) to authenticated;

-- ── 민감정보 열람은 함수 안에서 기록한다 ────────────────
-- 화면이 부르는 것을 잊어도 남는다. 사유(p_reason)는 화면이 받아 넘긴다.
drop function if exists public.biz_reveal_entity_resident(uuid);
create or replace function public.biz_reveal_entity_resident(p_id uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v bytea; v_name text;
begin
  if not public.biz_can_reveal() then raise exception '민감정보 열람 권한이 없습니다'; end if;
  select e.resident_no_enc, e.name into v, v_name from public.biz_entity e where e.id = p_id;
  perform public.log_access('reveal_resident', 'biz_entity', p_id, v_name, p_reason, null);
  return case when v is null then null else extensions.pgp_sym_decrypt(v, public.biz_pii_key()) end;
end $$;

drop function if exists public.biz_reveal_rep_resident(uuid);
create or replace function public.biz_reveal_rep_resident(p_id uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v bytea; v_name text;
begin
  if not public.biz_can_reveal() then raise exception '민감정보 열람 권한이 없습니다'; end if;
  select r.resident_no_enc, r.rep_name into v, v_name from public.biz_representative r where r.id = p_id;
  perform public.log_access('reveal_resident', 'biz_representative', p_id, v_name, p_reason, null);
  return case when v is null then null else extensions.pgp_sym_decrypt(v, public.biz_pii_key()) end;
end $$;

drop function if exists public.biz_reveal_place_hometax_pw(uuid);
create or replace function public.biz_reveal_place_hometax_pw(p_id uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v bytea; v_name text;
begin
  if not public.biz_can_reveal_hometax_pw() then raise exception '홈택스PW 열람 권한이 없습니다'; end if;
  select p.hometax_pw_enc, p.place_name into v, v_name from public.biz_place p where p.id = p_id;
  perform public.log_access('reveal_hometax_pw', 'biz_place', p_id, v_name, p_reason, null);
  return case when v is null then null else extensions.pgp_sym_decrypt(v, public.biz_pii_key()) end;
end $$;

revoke all on function public.biz_reveal_entity_resident(uuid, text) from public, anon;
revoke all on function public.biz_reveal_rep_resident(uuid, text) from public, anon;
revoke all on function public.biz_reveal_place_hometax_pw(uuid, text) from public, anon;
grant execute on function public.biz_reveal_entity_resident(uuid, text) to authenticated;
grant execute on function public.biz_reveal_rep_resident(uuid, text) to authenticated;
grant execute on function public.biz_reveal_place_hometax_pw(uuid, text) to authenticated;

-- ── 일괄 열람은 사실상 '다운로드'다 ─────────────────────
-- 주민번호 전체를 한 번에 복호화해 내려받는 자리라, 고시가 말하는 다운로드 상황 확인
-- (제8조제2항)에 해당한다. **사유 없이는 못 부르게** 하고 건수를 함께 남긴다.
-- STABLE 이던 것을 VOLATILE 로 바꾼다 — STABLE 함수는 기록(INSERT)을 할 수 없다.
create or replace function public.biz_reveal_residents(p_reason text default null)
returns table(entity_id uuid, kind text, holder text, resident_no text)
language plpgsql volatile security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.biz_can_reveal() then raise exception '민감정보 열람 권한이 없습니다'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '주민등록번호를 일괄 열람하려면 사유를 적어야 합니다 (접속기록에 남습니다)';
  end if;
  select count(*) into v_n from (
    select 1 from public.biz_entity e where e.kind = '개인' and e.resident_no_enc is not null
    union all
    select 1 from public.biz_representative r where r.resident_no_enc is not null
  ) t;
  perform public.log_access('download_resident_all', 'biz_entity+biz_representative',
                            null, null, p_reason, jsonb_build_object('count', v_n));
  return query
    select e.id, e.kind, e.name,
           extensions.pgp_sym_decrypt(e.resident_no_enc, public.biz_pii_key())
      from public.biz_entity e
     where e.kind = '개인' and e.resident_no_enc is not null
    union all
    select r.entity_id, '법인'::text, r.rep_name,
           extensions.pgp_sym_decrypt(r.resident_no_enc, public.biz_pii_key())
      from public.biz_representative r
     where r.resident_no_enc is not null;
end $$;

create or replace function public.biz_reveal_hometax_pws(p_reason text default null)
returns table(place_id uuid, hometax_pw text)
language plpgsql volatile security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.biz_can_reveal_hometax_pw() then raise exception '홈택스PW 열람 권한이 없습니다'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '홈택스 비밀번호를 일괄 열람하려면 사유를 적어야 합니다 (접속기록에 남습니다)';
  end if;
  select count(*) into v_n from public.biz_place p where p.hometax_pw_enc is not null;
  perform public.log_access('download_hometax_pw_all', 'biz_place',
                            null, null, p_reason, jsonb_build_object('count', v_n));
  return query
    select p.id, extensions.pgp_sym_decrypt(p.hometax_pw_enc, public.biz_pii_key())
      from public.biz_place p
     where p.hometax_pw_enc is not null;
end $$;

drop function if exists public.biz_reveal_residents();
drop function if exists public.biz_reveal_hometax_pws();
revoke all on function public.biz_reveal_residents(text) from public, anon;
revoke all on function public.biz_reveal_hometax_pws(text) from public, anon;
grant execute on function public.biz_reveal_residents(text) to authenticated;
grant execute on function public.biz_reveal_hometax_pws(text) to authenticated;
