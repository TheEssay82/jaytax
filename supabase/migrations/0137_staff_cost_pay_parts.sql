-- 인건비 예측을 **구성요소**로 — 엑셀 급여표를 그대로 담는다.
--
-- 그전에는 결과값(annual·bonus·severance·insurance·etc_cost)만 손으로 박아 두었다.
-- 급여가 바뀔 때마다 사람이 다섯 칸을 다시 계산해 넣어야 했고, 무엇이 왜 그 값인지
-- 표만 봐서는 알 수 없었다.
--
-- 엑셀(기장사업부현황정리_20260630기준 › 기장담당자 현황 30~38행)이 실제로 쓰던 식을
-- 세 사람의 값으로 검산해 그대로 옮긴다 —
--   월급합계 = 기본금 + 수당 + 관리수당 + 식대
--   상여100% = 기본금 + 수당 + 관리수당           (식대는 빠진다)
--   연봉      = 월급합계 × 12 + 상여
--   퇴직금 = 연봉 ÷ 12 · 4대보험 = 연봉 × 10% · 기타 = 연봉 × 10%
--
-- 결과값 칸은 **그대로 둔다.** 화면이 구성요소로 계산해 채워 넣고, 읽는 쪽(예산 표·
-- 배부)은 지금까지처럼 결과값만 본다. 옛 줄도 그대로 읽힌다.
alter table public.staff_cost
  add column if not exists base_pay       numeric not null default 0,  -- 기본금
  add column if not exists allowance      numeric not null default 0,  -- 수당
  add column if not exists mgmt_allowance numeric not null default 0,  -- 관리수당
  add column if not exists meal           numeric not null default 0,  -- 식대
  -- 부대비용 비율. 엑셀이 쓰던 값이 기본값이다. 사람마다 다를 수 있어 줄마다 둔다.
  add column if not exists severance_div  numeric not null default 12,
  add column if not exists insurance_rate numeric not null default 0.1,
  add column if not exists etc_rate       numeric not null default 0.1;

comment on column public.staff_cost.base_pay is '기본금 — 월. 여기서 월급합계·상여·연봉이 나온다.';
comment on column public.staff_cost.meal is '식대 — 월급합계에는 들어가고 상여 계산에서는 빠진다.';
comment on column public.staff_cost.severance_div is '퇴직금 = 연봉 ÷ 이 값. 엑셀은 12.';

-- 이미 들어 있는 FY2026 세 줄에 구성요소를 되채운다.
-- monthly(월급합계)와 bonus(상여)를 알고 있으므로 기본금 = 상여, 식대 = 월급합계 − 상여로 되돌린다.
-- 세 사람 모두 수당·관리수당이 기본금에 합쳐진 모양이라 이 되돌림이 정확하다
-- (정남지의 관리수당 240,000 은 기본금과 합쳐 4,160,000 으로 들어간다 — 합계는 같다).
update public.staff_cost
   set base_pay = bonus,
       meal = greatest(monthly - bonus, 0)
 where base_pay = 0 and monthly > 0 and bonus > 0;
