-- 0086_yeongeon_representative.sql
-- 연건아트레지던스(L0148) 대표이사 = 최종원 (ERP 거래처 마스터 기준).
-- 대표이사 편집기를 실물 검증하며 넣은 시험용 주민번호를 지우고 이름만 남긴다.
-- 주민번호는 실제 값을 확인한 뒤 화면에서 입력하면 된다.

update public.biz_representative r
   set rep_name = '최종원',
       resident_no_enc = null
  from public.biz_entity e
 where e.id = r.entity_id and e.code = 'L0148';
