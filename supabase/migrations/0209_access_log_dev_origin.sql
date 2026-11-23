-- 0209 접속기록 — 개발 서버(localhost)에서 들어온 기록에 표시(사용자 2026-11-23).
-- 개발 서버도 운영 DB 에 바로 붙는다. Claude 세션이 화면 확인용으로 테스트 계정에 로그인하면 사람이 들어온 것과 구분되지 않았다
-- (2026-11-23 14:02 테스트-팀장 — 다른 Claude 세션의 거래처등록 화면 확인).
-- 요청의 Origin(없으면 Referer) 이 운영 주소가 아니면 detail.origin 에 적는다. 서버가 헤더에서 읽으므로 화면이 꾸밀 수 없다.
-- 해시는 고친 detail 로 계산한다(무결성 검증은 저장된 detail 을 그대로 다시 해시한다).
create or replace function public.access_log_append(p_actor_id uuid, p_actor_name text, p_actor_email text, p_action text, p_target text, p_subject_id uuid, p_subject_name text, p_reason text, p_detail jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_id bigint; v_prev text; v_ip text := public.client_ip(); v_ua text; v_origin text;
        v_at timestamptz := clock_timestamp(); v_hash text;
begin
  if p_action is null or btrim(p_action) = '' then return; end if;
  begin v_ua := left((current_setting('request.headers', true)::json) ->> 'user-agent', 400);
  exception when others then v_ua := null; end;
  begin
    v_origin := coalesce((current_setting('request.headers', true)::json) ->> 'origin',
                         substring((current_setting('request.headers', true)::json) ->> 'referer' from '^(https?://[^/]+)'));
  exception when others then v_origin := null; end;
  if v_origin is not null and v_origin !~* '^https://(www\.)?jaytax\.co\.kr$' then
    p_detail := coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('origin', left(v_origin, 100));
  end if;
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
end $function$;
revoke all on function public.access_log_append(uuid, text, text, text, text, uuid, text, text, jsonb) from public, anon, authenticated;
