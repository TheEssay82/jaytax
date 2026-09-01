-- 0102_audit_two_more_clients.sql
-- 감사팀 기초미수금에 있던 조현규 담당 2곳(원일사·서로앤컬쳐)을 등록한다.
-- 공간정보품질관리원 866,250 은 우리 담당이 아니라 넣지 않는다(사용자 확인).
insert into public.biz_entity (code, kind, name, corp_form, corp_form_position, note)
values
  ('L0151', '법인', '원일사',     '주식회사', '앞', '감사팀 · 담당 조현규.'),
  ('L0152', '법인', '서로앤컬쳐', '주식회사', '앞', '감사팀 · 담당 조현규.');

insert into public.biz_place (
  entity_id, place_no, place_name, biz_reg_no, is_headquarters, nature, sales_teams,
  tax_type, status, cpa, address, erp_client_code, note)
select e.id, 1, '본점', v.bizno, true, '매출', array['감사team'],
       '과세', '정상', '조현규', v.addr, v.code,
       '대표자 ' || v.rep || ' · 업태 ' || v.biz || ' / 종목 ' || v.item
  from (values
    ('L0151', '113-81-20335', '69884', '심금텍',
     '(15421) 경기도 안산시 단원구 능길로 126', '제조업', '제조업'),
    ('L0152', '585-86-00392', '02185', '심금택',
     '서울 종로구 필운대로7길 12 1층(옥인동)', '음식 및 숙박', '소규모간이음식점 외')
  ) as v(ecode, bizno, code, rep, addr, biz, item)
  join public.biz_entity e on e.code = v.ecode;

insert into public.biz_contact (entity_id, place_id, contact_name, email, is_primary, note)
select p.entity_id, p.id, '담당자', 'mcwooo@empas.com', true,
       'ERP 거래처 마스터의 전자세금계산서용 이메일 — 성명 확인 필요'
  from public.biz_place p join public.biz_entity e on e.id = p.entity_id
 where e.code in ('L0151', 'L0152');
