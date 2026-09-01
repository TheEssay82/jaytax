-- 0096_audit_clients_bizno_erpcode.sql
-- 감사팀 거래처 7곳에 사업자번호와 ERP 거래처코드를 채운다.
--
-- 감사팀 거래처는 사업자번호 없이 이름만 등록돼 있어(정상 사업장 73곳이 그렇다)
-- ERP 대사의 매칭 키가 아예 없었다. 감사팀 자료를 처음 받아 두 값을 얻었다.
--   사업자번호 ← 2026-07·08 감사팀 거래전표(사업자등록증 열)
--   ERP 코드   ← 감사팀 부서별원장(거래처코드 열)
with m(ename, bizno, code) as (values
  ('라인넥스트',     '688-81-02471', '69890'),
  ('백련',           '504-81-53726', '02183'),
  ('세원특수금속',   '134-81-77927', '02170'),
  ('나래나노텍',     '135-81-18218', '02171'),
  ('윤성에프앤씨',   '134-81-50350', '56694'),
  ('인코어',         '520-86-03524', '70382'),
  ('폴라리스오피스', '220-81-43747', '09631')
)
update public.biz_place p
   set biz_reg_no = case when coalesce(p.biz_reg_no,'') = '' then m.bizno else p.biz_reg_no end,
       erp_client_code = coalesce(p.erp_client_code, m.code)
  from m, public.biz_entity e
 where e.id = p.entity_id and e.name = m.ename and p.place_no = 1;
