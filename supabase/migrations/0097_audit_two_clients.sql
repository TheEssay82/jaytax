-- 0097_audit_two_clients.sql
-- 감사팀 2026-07·08 발행분 중 우리 3인(김준성) 담당인데 거래처관리에 없던 2곳을 등록한다.
-- 정보 출처: ERP 거래처 마스터(2026-07) + 감사팀 부서별원장의 '사원명'(담당자).
-- 나머지 11곳은 김영식·김동욱·정훈석·김중한·전현수·이용기 담당이라 우리와 무관해 넣지 않는다.
with e as (
  insert into public.biz_entity (code, kind, name, corp_form, corp_form_position, note)
  values
    ('L0149', '법인', '미니소코리아',     '주식회사', '앞', '감사팀 · 담당 김준성. 2026-07·08 약식실사 5,000,000/월 발행.'),
    ('L0150', '법인', '폴라리스쉐어테크', '주식회사', '앞', '감사팀 · 담당 김준성. 2026-08 BW평가용역(반기) 2,500,000 발행.')
  returning id, code
)
insert into public.biz_place (
  entity_id, place_no, place_name, biz_reg_no, is_headquarters, nature, sales_teams,
  tax_type, status, cpa, address, erp_client_code, note)
select e.id, 1, '본점', v.bizno, true, '매출', array['감사team'],
       '과세', '정상', '김준성', v.addr, v.code,
       '대표자 ' || v.rep || ' · 업태 ' || v.biz || ' / 종목 ' || v.item
  from e
  join (values
    ('L0149', '181-87-03312', '72169', '심재영',
     '서울특별시 영등포구 당산로 241 2층', '도소매업', '그 외 기타 생활용품 도매업'),
    ('L0150', '896-81-02577', '43458', '이해석',
     '서울 구로구 디지털로31길 12, 1504호', '서비스', '응용 소프트웨어 개발 및 공급업')
  ) as v(ecode, bizno, code, rep, addr, biz, item) on v.ecode = e.code;

-- 세금계산서 수신 이메일이 확인된 곳만 담당자로 넣는다(미니소코리아는 마스터에 없다).
insert into public.biz_contact (entity_id, place_id, contact_name, email, is_primary, note)
select p.entity_id, p.id, '담당자', 'pace.p.kim@polarisoffice.com', true,
       'ERP 거래처 마스터의 전자세금계산서용 이메일 — 성명 확인 필요'
  from public.biz_place p join public.biz_entity e on e.id = p.entity_id
 where e.code = 'L0150';
