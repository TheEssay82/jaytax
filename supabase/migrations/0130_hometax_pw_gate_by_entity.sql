-- 0130 홈택스PW 열람 제한을 **사업장 단위 → 거래처 단위**로 완화
--
-- 0129 는 사업장 상태로 막았다. 그러면 거래처는 살아 있는데 사업장 하나가 폐업했다는
-- 이유로 담당직원이 그 홈택스 아이디에 못 들어간다. 폐업 뒤에도 정정신고·자료요청으로
-- 들어갈 일이 있는 업종이라 실무가 선다(이찬혁 — 사업장 3곳 중 2곳 폐업, 1곳 정상).
--
-- 주민번호를 거래처 단위로 판정했으니 기준을 맞춘다 —
-- **그 거래처에 '정상' 사업장이 하나라도 있으면 전원 열람**, 거래처가 통째로 끝나야 막힌다.

create or replace function public.biz_reveal_place_hometax_pw(p_id uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $fn$
declare v bytea; v_name text; v_ent uuid;
begin
  if not public.biz_can_reveal_hometax_pw() then raise exception '홈택스PW 열람 권한이 없습니다'; end if;
  select p.hometax_pw_enc, p.place_name, p.entity_id into v, v_name, v_ent
    from public.biz_place p where p.id = p_id;
  -- 사업장이 아니라 **거래처**가 끝났을 때만 막는다.
  if public.biz_entity_closed(v_ent) and not public.is_superuser() then
    perform public.log_access('reveal_denied', 'biz_place', p_id, v_name, p_reason,
                              jsonb_build_object('why', '거래 종료 거래처'));
    raise exception '거래가 끝난 거래처의 홈택스 비밀번호입니다 — 보존의무로만 남겨 둔 것이라 최고관리자만 열람할 수 있습니다 (개인정보 보호법 제21조제3항)';
  end if;
  perform public.log_access('reveal_hometax_pw', 'biz_place', p_id, v_name, p_reason, null);
  return case when v is null then null else extensions.pgp_sym_decrypt(v, public.biz_pii_key()) end;
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
   where p.hometax_pw_enc is not null and (v_su or not public.biz_entity_closed(p.entity_id));
  perform public.log_access('download_hometax_pw_all', 'biz_place', null, null, p_reason,
                            jsonb_build_object('count', v_n, 'closed_included', v_su));
  return query select p.id, extensions.pgp_sym_decrypt(p.hometax_pw_enc, public.biz_pii_key())
    from public.biz_place p
   where p.hometax_pw_enc is not null and (v_su or not public.biz_entity_closed(p.entity_id));
end $fn$;

revoke all on function public.biz_reveal_place_hometax_pw(uuid, text) from public, anon;
revoke all on function public.biz_reveal_hometax_pws(text) from public, anon;
grant execute on function public.biz_reveal_place_hometax_pw(uuid, text) to authenticated;
grant execute on function public.biz_reveal_hometax_pws(text) to authenticated;

-- 파기 정책도 같은 기준으로 맞춘다.
-- 열람은 되는데 1년 뒤 파기 대상으로 뜨면 담당직원이 쓰던 것이 사라진다.
update public.retention_policy
   set where_sql = $w$hometax_pw_enc is not null
        and public.biz_entity_closed(entity_id)
        and status_month is not null and status_month < to_char({cutoff}::date, 'YYYY-MM')$w$,
       note = '거래처가 통째로 끝난 뒤 1년. 사업장 정보는 남고 비밀번호만 비운다. 사업장 하나가 폐업해도 그 거래처가 살아 있으면 대상이 아니다 — 정정신고 등으로 들어갈 일이 있다. 종료월이 비어 있으면 대상이 아니다.'
 where key = 'hometax_pw';
