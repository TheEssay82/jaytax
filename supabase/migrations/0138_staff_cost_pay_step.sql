-- 호봉. 인덕회계법인 직원급여산정표(2021-09-09 개정, 별표 1) 의 1~100.
--
-- 회사의 기본급은 이 표에서 나온다 — 임의로 정할 수 없는 급여정책이다. 금액만 두면
-- 「몇 호봉인지」를 사람이 매번 표에서 찾아야 하므로 호봉 자체를 남긴다.
-- null 이면 아직 표에 얹지 않았거나 표를 벗어난 줄이다.
--
-- ⚠️ 「기본급」은 **기본금 + 수당 + 관리수당**의 합이다. 정남지 님처럼 관리수당이 있는
--    분도 **그 합이 표의 한 칸과 같아야** 한다.
alter table public.staff_cost
  add column if not exists pay_step integer;

comment on column public.staff_cost.pay_step is
  '직원급여산정표의 호봉(1~100). 기본금+수당+관리수당이 그 호봉의 월정급여와 같아야 한다.';

-- 이미 들어 있는 줄에 호봉을 붙인다. **딱 맞을 때만** 붙인다 —
-- 가까운 값으로 어림잡으면 틀린 호봉이 사실처럼 남는다.
-- 표는 등차가 아니라 구간마다 오름폭이 다르다(src/lib/payScale.ts 와 같은 규칙).
with scale as (
  select gs.step,
         case
           when gs.step = 100 then 16000000
           when gs.step = 99  then 15500000
           when gs.step = 98  then 14500000
           when gs.step = 97  then 13500000
           when gs.step = 96  then 12500000
           when gs.step = 95  then 11500000
           when gs.step = 94  then 10500000
           when gs.step = 93  then 10000000
           when gs.step = 92  then 9500000
           when gs.step = 91  then 9000000
           when gs.step >= 86 then 7720000 + (gs.step - 85) * 200000
           when gs.step >= 76 then 6220000 + (gs.step - 75) * 150000
           when gs.step >= 61 then 4720000 + (gs.step - 60) * 100000
           when gs.step >= 46 then 3520000 + (gs.step - 45) * 80000
           when gs.step >= 26 then 2520000 + (gs.step - 25) * 50000
           else 1800000 + (gs.step - 1) * 30000
         end as monthly
  from generate_series(1, 100) as gs(step)
)
update public.staff_cost c
   set pay_step = s.step
  from scale s
 where c.pay_step is null
   and (c.base_pay + c.allowance + c.mgmt_allowance) = s.monthly;

-- 정남지 FY2026 — 0137 의 되채움이 관리수당을 기본금에 합쳐 두었다.
-- 엑셀 급여표대로 가른다. 합계 4,160,000(53호봉)과 연봉은 그대로다.
update public.staff_cost
   set base_pay = 3920000, mgmt_allowance = 240000
 where fy = 2026 and staff_name = '정남지'
   and base_pay = 4160000 and mgmt_allowance = 0;
