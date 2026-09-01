-- 0085_sipsipsip_to_wegohard.sql
-- 싶싶싶(sip sip sip) 사업장을 나우오어네버(L0009) → 위고하드(L0084) 로 옮긴다. (사장님 확인)
--
-- 안전한가: 이 사업장에 걸린 매출계약 0건 · 담당자 0건 · 발행요청 0건이다.
--   따라오는 것 — 기초미수금 1건, 담당직원 1건. 둘 다 사업장(place_id) 키라 함께 옮겨진다.
--   양쪽 거래처의 매출계약은 모두 법인 단위(place_id 없음)라 손댈 것이 없다.
-- 사업장번호: 위고하드에 이미 '산수'(01)가 있으므로 02 를 준다.
--   → 표에 보이는 코드가 L0009-02 에서 L0084-02 로 바뀐다.
-- doc_clients/doc_contacts 별칭은 biz_place 갱신 트리거가 알아서 다시 맞춘다.

update public.biz_place p
   set entity_id = (select id from public.biz_entity where code = 'L0084'),
       place_no  = coalesce(
         (select max(place_no) + 1 from public.biz_place
           where entity_id = (select id from public.biz_entity where code = 'L0084')), 1),
       note = nullif(trim(coalesce(p.note, '') || ' 2026-09-01 나우오어네버에서 위고하드 사업장으로 정정.'), '')
  from public.biz_entity e
 where e.id = p.entity_id and e.code = 'L0009' and p.biz_reg_no = '642-85-03318';
