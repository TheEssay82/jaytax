-- 0082_yeongeon_art_residence.sql
-- (1) 짐티피 연희5호점 사업자번호 정정 — 171-82-02156 → 171-85-02156 (사장님 확인).
--     ERP 의 짐티피 지점이 모두 -85- 대이고, 이 오타 때문에 코드 매칭에서만 빠져 있었다.
-- (2) 신규 거래처 ㈜연건아트레지던스 등록.
--     2026-07 에 ERP 로 실제 발행된 뒤 업무가 마감된 건이라 **단발성 계약 2건**으로 넣는다.
--     정보 출처: ERP 거래처 마스터(코드 72799) + 2026-07 거래전표(26-0717-0009/0010).

-- (1) 짐티피 연희5호점
update public.biz_place
   set biz_reg_no = '171-85-02156',
       erp_client_code = '40120'
 where biz_reg_no = '171-82-02156';

-- (2) 연건아트레지던스
with e as (
  insert into public.biz_entity (code, kind, name, corp_form, corp_form_position, corp_reg_no, note)
  values ('L0148', '법인', '연건아트레지던스', '주식회사', '앞', '120111-0151319',
          '2026-07 단발 수임(부가세 신고대리·법인세무조정) 후 업무 마감.')
  returning id
), p as (
  insert into public.biz_place (
    entity_id, place_no, place_name, biz_reg_no, is_headquarters, nature, sales_teams,
    tax_type, status, cpa, address, erp_client_code, note)
  select e.id, 1, '본점', '837-86-03801', true, '매출', array['taxteam'],
         '과세', '정상', '정우철',
         '인천광역시 연수구 인천타워대로 323 송도센트로드 비동 30층 브이704호',
         '72799',
         '대표자 최종원 · 업태 건설업 / 종목 주거용 건물 건설업'
    from e
  returning id, entity_id
), c as (
  insert into public.biz_contact (entity_id, place_id, contact_name, phone, email, is_primary)
  select p.entity_id, p.id, '권예린', '010-7210-5165', 'yerin.kwon@oculusep.com', true from p
  returning id
)
-- 단발성이라 종료일을 그달 말일로 둔다(계약코드의 F = 종료 있음).
-- billing_cycle '연' + billing_month 7 + 7월 개시·종료 → 2026-07 에 딱 한 번만 전개된다.
insert into public.biz_sales_contract (
  entity_id, place_id, occurrence_unit, team, category_code, billing_cycle, is_installment,
  amount, cpa, fiscal_year, billing_month, start_date, end_date, confirmed, contract_code, note)
select p.entity_id, null, '법인', 'taxteam', v.cat, '연', false,
       v.amt, '정우철', 2026, 7, date '2026-07-01', date '2026-07-31', true, v.ccode, v.note
  from p, (values
    ('TAX.FILING.VAT',  500000, 'L0148-00-F-VAT-T-2026-01', '2026-07 단발 · 부가세 신고대리 (ERP 전표 26-0717-0009)'),
    ('TAX.FILING.CORP', 300000, 'L0148-00-F-CT-T-2026-01',  '2026-07 단발 · 법인세무조정 (ERP 전표 26-0717-0010)')
  ) as v(cat, amt, ccode, note);
