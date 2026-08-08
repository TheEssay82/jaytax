-- 0051: 거래처 레지스트리 보안 하드닝 — SECURITY DEFINER 내부함수의 RPC 노출 차단
--
-- 배경: Supabase 는 public 스키마 신규 함수에 anon/authenticated EXECUTE 를 기본 부여한다.
--       0050 의 biz_pii_key() 는 암호화 키를 그대로 반환하므로 RPC(/rest/v1/rpc/biz_pii_key)로
--       노출되면 암호화가 무력화된다. 'revoke ... from public' 만으론 anon/authenticated 를 못 막는다.
--
-- 조치: 내부 전용(키/암호화/권한체크/트리거) 함수의 EXECUTE 를 public·anon·authenticated 에서 회수.
--       이들은 모두 SECURITY DEFINER(소유자=postgres) 라, 이를 호출하는 상위 함수(biz_set_*/biz_reveal_*)는
--       소유자 권한으로 계속 정상 동작한다(호출 시 EXECUTE 검사는 상위 함수 소유자 기준).
--       사용자용 RPC(biz_set_*·biz_reveal_*)는 authenticated 실행권한 유지(내부 권한체크로 자체 방어).

revoke execute on function
  public.biz_pii_key(),
  public.biz_encrypt(text),
  public.biz_can_reveal(),
  public.biz_assert_writer(),
  public.biz_actor_name(),
  public.biz_audit(),
  public.biz_entity_before_insert(),
  public.biz_place_before_insert(),
  public.biz_set_created_by(),
  public.biz_touch_updated()
  from public, anon, authenticated;
