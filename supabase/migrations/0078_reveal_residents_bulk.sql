-- 0078: 거래처등록 표뷰에서 주민번호를 한 번에 열람하기 위한 RPC
--
-- 직원들이 표를 보고 신고서식에 타이핑하는 일이 많아 한 행씩 여는 방식은 실무에 맞지 않는다.
-- 권한 검사(biz_can_reveal)는 기존 단건 RPC와 같고, 개인=본인 주민번호 / 법인=대표자 주민번호를 돌려준다.
create or replace function public.biz_reveal_residents()
returns table (entity_id uuid, kind text, holder text, resident_no text)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not public.biz_can_reveal() then raise exception '민감정보 열람 권한이 없습니다'; end if;
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
end $fn$;

revoke execute on function public.biz_reveal_residents() from public;
grant execute on function public.biz_reveal_residents() to authenticated;
