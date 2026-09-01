-- 0107_invoice_request_cpa_from_place.sql
-- 0106 에서 담당CPA 가 30건밖에 안 채워졌다. 법인 단위 계약은 contract.place_id 가 비어 있어
-- 사업장을 못 찾았기 때문. 요청 자신의 place_id 로 한 번 더 채운다.
update public.biz_invoice_request r
   set cpa = p.cpa
  from public.biz_place p
 where p.id = r.place_id and coalesce(r.cpa, '') = '' and coalesce(p.cpa, '') <> '';
