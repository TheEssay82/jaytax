-- 0098_audit_service_contracts.sql
-- 감사팀 7·8월 발행 중 계약이 없던 5건을 매출계약으로 등록한다(사용자 확인 2026-09-01).
-- 전부 회계감사가 아닌 **일회성 용역**이라 청구주기는 '건' — 예측 스케줄을 만들지 않는다.
-- 개시일은 2026-07-01(사용자 지정), 종료일은 실제 발행이 끝난 2026-08-31.
-- 담당CPA 는 우리 거래처등록 기준(ERP 사원명과 다른 곳이 있으나 우리 등록이 맞다고 확인받음).
insert into public.biz_sales_contract (
  entity_id, place_id, occurrence_unit, team, category_code, category_etc_name,
  billing_cycle, is_installment, amount, cpa, start_date, end_date, confirmed, contract_code, note)
select e.id, null, '법인', '감사team', v.cat, nullif(v.etc, ''),
       '건', v.inst, v.amt, v.cpa, date '2026-07-01', date '2026-08-31', true,
       e.code || v.suffix, v.note
  from (values
    ('L0022', 'AUD.SVC.VAL.ENTERPRISE', '',                 15000000, '정우철', false,
     '-00-F-VENT-A-2026-01', '2025 주식가치평가용역 — 총액 1회. 2026-07 발행.'),
    ('L0149', 'AUD.SVC.CON.ETC',        '약식실사',          10000000, '김준성', true,
     '-00-F-CETC-A-2026-01', '약식실사 — 총 10,000,000 을 2회로 나눠 청구(2026-07·08). 두 번으로 종료.'),
    ('L0150', 'AUD.SVC.VAL.DERIVATIVE', '',                  2500000, '김준성', false,
     '-00-F-VDRV-A-2026-01', 'BW평가용역 — 일회성. 또 생길 수 있으나 계약은 건별로 진행.'),
    ('L0122', 'AUD.SVC.VAL.DERIVATIVE', '',                  2500000, '김준성', false,
     '-00-F-VDRV-A-2026-01', 'BW평가용역 — 일회성. 또 생길 수 있으나 계약은 건별로 진행.'),
    ('L0008', 'AUD.SVC.CON.ETC',        '부품소재매출확인서',   500000, '조현규', false,
     '-00-F-CETC-A-2026-01', '부품소재매출확인서 — 일회성. 2026-08 발행.')
  ) as v(ecode, cat, etc, amt, cpa, inst, suffix, note)
  join public.biz_entity e on e.code = v.ecode
 where not exists (
   select 1 from public.biz_sales_contract c
    where c.entity_id = e.id and c.contract_code = e.code || v.suffix);

-- 미니소코리아만 2회 분할. 회차 날짜는 실제 발행일에 맞춘다.
insert into public.biz_contract_installment (contract_id, seq, label, amount, due_date, condition_note)
select c.id, v.seq, v.label, v.amt, v.due, '실제 발행일 기준'
  from public.biz_sales_contract c
  join public.biz_entity e on e.id = c.entity_id
  join (values (1, '1차', 5000000, date '2026-07-28'), (2, '2차', 5000000, date '2026-08-13'))
       as v(seq, label, amt, due) on true
 where e.code = 'L0149' and c.contract_code = 'L0149-00-F-CETC-A-2026-01'
   and not exists (select 1 from public.biz_contract_installment i where i.contract_id = c.id);
