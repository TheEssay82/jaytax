-- 0129 거래 종료 거래처의 민감정보 열람 제한 (개인정보 보호법 제21조제3항)
--
-- 제21조제3항 — 보존의무 때문에 파기하지 않고 남기는 개인정보는
--   "다른 개인정보와 분리하여서 저장·관리하여야 한다".
--
-- ── 표를 가르지 않고 접근을 가른다 ──────────────────────
-- 종료 거래처를 별도 표(archive)로 옮기는 방법도 있으나, 매출통계·미수금·계약 조회가
-- 전부 두 표를 합쳐 봐야 해서 지금까지 만든 것 상당 부분을 다시 손대야 한다.
-- 감독기관이 보는 것은 분리의 **형식**이 아니라 "목적을 다한 개인정보가 계속 열람되지
-- 않는다"는 **실질**이므로, 접근을 가르는 것으로 같은 목적에 이른다.
--
-- ── 범위를 좁게 잡는다 (사용자 결정 2026-09-03) ──────────
-- 거래가 끝나도 세무서 통지·경정청구·자료 요청으로 연락이 계속 오는 업종이다.
-- 종료됐다고 거래처 정보를 통째로 막으면 업무가 선다. 그래서
--   · 거래처 정보·계약·청구 이력 → **지금처럼 전원이 본다**
--   · 목적을 다한 것은 **주민등록번호와 홈택스 비밀번호** 둘뿐 → 그 열람만 막는다
--
-- 막힌 시도는 'reveal_denied' 로 접속기록에 남는다 — 누가 무엇을 보려 했는지가 증적이 된다.

/** 이 거래처는 거래가 끝났는가 — '정상' 사업장이 하나도 없으면 끝난 것으로 본다. */
create or replace function public.biz_entity_closed(p_entity_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select not exists (
    select 1 from public.biz_place p where p.entity_id = p_entity_id and p.status = '정상');
$fn$;

create or replace function public.is_superuser()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((select role = 'superuser' from public.profiles where id = auth.uid()), false);
$fn$;

revoke all on function public.biz_entity_closed(uuid) from public, anon;
revoke all on function public.is_superuser() from public, anon;
grant execute on function public.biz_entity_closed(uuid) to authenticated;
grant execute on function public.is_superuser() to authenticated;

-- ── 개별 열람 ───────────────────────────────────────────
create or replace function public.biz_reveal_entity_resident(p_id uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $fn$
declare v bytea; v_name text;
begin
  if not public.biz_can_reveal() then raise exception '민감정보 열람 권한이 없습니다'; end if;
  select e.resident_no_enc, e.name into v, v_name from public.biz_entity e where e.id = p_id;
  if public.biz_entity_closed(p_id) and not public.is_superuser() then
    perform public.log_access('reveal_denied', 'biz_entity', p_id, v_name, p_reason,
                              jsonb_build_object('why', '거래 종료 거래처'));
    raise exception '거래가 끝난 거래처의 주민등록번호입니다 — 보존의무로만 남겨 둔 것이라 최고관리자만 열람할 수 있습니다 (개인정보 보호법 제21조제3항)';
  end if;
  perform public.log_access('reveal_resident', 'biz_entity', p_id, v_name, p_reason, null);
  return case when v is null then null else extensions.pgp_sym_decrypt(v, public.biz_pii_key()) end;
end $fn$;

create or replace function public.biz_reveal_rep_resident(p_id uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $fn$
declare v bytea; v_name text; v_ent uuid;
begin
  if not public.biz_can_reveal() then raise exception '민감정보 열람 권한이 없습니다'; end if;
  select r.resident_no_enc, r.rep_name, r.entity_id into v, v_name, v_ent
    from public.biz_representative r where r.id = p_id;
  if public.biz_entity_closed(v_ent) and not public.is_superuser() then
    perform public.log_access('reveal_denied', 'biz_representative', p_id, v_name, p_reason,
                              jsonb_build_object('why', '거래 종료 거래처'));
    raise exception '거래가 끝난 거래처의 주민등록번호입니다 — 보존의무로만 남겨 둔 것이라 최고관리자만 열람할 수 있습니다 (개인정보 보호법 제21조제3항)';
  end if;
  perform public.log_access('reveal_resident', 'biz_representative', p_id, v_name, p_reason, null);
  return case when v is null then null else extensions.pgp_sym_decrypt(v, public.biz_pii_key()) end;
end $fn$;

create or replace function public.biz_reveal_place_hometax_pw(p_id uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $fn$
declare v bytea; v_name text; v_status text;
begin
  if not public.biz_can_reveal_hometax_pw() then raise exception '홈택스PW 열람 권한이 없습니다'; end if;
  select p.hometax_pw_enc, p.place_name, p.status into v, v_name, v_status
    from public.biz_place p where p.id = p_id;
  -- 홈택스 비밀번호는 사업장 단위다. 그 사업장이 문을 닫았으면 쓸 일이 없다.
  if v_status is distinct from '정상' and not public.is_superuser() then
    perform public.log_access('reveal_denied', 'biz_place', p_id, v_name, p_reason,
                              jsonb_build_object('why', '거래 종료 사업장'));
    raise exception '거래가 끝난 사업장의 홈택스 비밀번호입니다 — 보존의무로만 남겨 둔 것이라 최고관리자만 열람할 수 있습니다 (개인정보 보호법 제21조제3항)';
  end if;
  perform public.log_access('reveal_hometax_pw', 'biz_place', p_id, v_name, p_reason, null);
  return case when v is null then null else extensions.pgp_sym_decrypt(v, public.biz_pii_key()) end;
end $fn$;

-- ── 일괄 열람 — 종료된 것은 아예 내주지 않는다 ──────────
create or replace function public.biz_reveal_residents(p_reason text default null)
returns table(entity_id uuid, kind text, holder text, resident_no text)
language plpgsql volatile security definer set search_path = public as $fn$
declare v_n integer; v_su boolean := public.is_superuser();
begin
  if not public.biz_can_reveal() then raise exception '민감정보 열람 권한이 없습니다'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '주민등록번호를 일괄 열람하려면 사유를 적어야 합니다 (접속기록에 남습니다)'; end if;
  select count(*) into v_n from (
    select 1 from public.biz_entity e where e.kind = '개인' and e.resident_no_enc is not null
             and (v_su or not public.biz_entity_closed(e.id))
    union all
    select 1 from public.biz_representative r where r.resident_no_enc is not null
             and (v_su or not public.biz_entity_closed(r.entity_id))) t;
  perform public.log_access('download_resident_all', 'biz_entity+biz_representative',
                            null, null, p_reason,
                            jsonb_build_object('count', v_n, 'closed_included', v_su));
  return query
    select e.id, e.kind, e.name, extensions.pgp_sym_decrypt(e.resident_no_enc, public.biz_pii_key())
      from public.biz_entity e
     where e.kind = '개인' and e.resident_no_enc is not null
       and (v_su or not public.biz_entity_closed(e.id))
    union all
    select r.entity_id, '법인'::text, r.rep_name,
           extensions.pgp_sym_decrypt(r.resident_no_enc, public.biz_pii_key())
      from public.biz_representative r
     where r.resident_no_enc is not null
       and (v_su or not public.biz_entity_closed(r.entity_id));
end $fn$;

create or replace function public.biz_reveal_hometax_pws(p_reason text default null)
returns table(place_id uuid, hometax_pw text)
language plpgsql volatile security definer set search_path = public as $fn$
declare v_n integer; v_su boolean := public.is_superuser();
begin
  if not public.biz_can_reveal_hometax_pw() then raise exception '홈택스PW 열람 권한이 없습니다'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '홈택스 비밀번호를 일괄 열람하려면 사유를 적어야 합니다 (접속기록에 남습니다)'; end if;
  select count(*) into v_n from public.biz_place p
   where p.hometax_pw_enc is not null and (v_su or p.status = '정상');
  perform public.log_access('download_hometax_pw_all', 'biz_place', null, null, p_reason,
                            jsonb_build_object('count', v_n, 'closed_included', v_su));
  return query select p.id, extensions.pgp_sym_decrypt(p.hometax_pw_enc, public.biz_pii_key())
    from public.biz_place p
   where p.hometax_pw_enc is not null and (v_su or p.status = '정상');
end $fn$;

revoke all on function public.biz_reveal_entity_resident(uuid, text) from public, anon;
revoke all on function public.biz_reveal_rep_resident(uuid, text) from public, anon;
revoke all on function public.biz_reveal_place_hometax_pw(uuid, text) from public, anon;
revoke all on function public.biz_reveal_residents(text) from public, anon;
revoke all on function public.biz_reveal_hometax_pws(text) from public, anon;
grant execute on function public.biz_reveal_entity_resident(uuid, text) to authenticated;
grant execute on function public.biz_reveal_rep_resident(uuid, text) to authenticated;
grant execute on function public.biz_reveal_place_hometax_pw(uuid, text) to authenticated;
grant execute on function public.biz_reveal_residents(text) to authenticated;
grant execute on function public.biz_reveal_hometax_pws(text) to authenticated;
