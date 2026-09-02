-- 인당회계사에게 청구·상담 자료의 **조회**를 연다.
--
-- 2026-08 에 거래처관리를 열어 준 것과 같은 결정이다(2026-09-03 정우철 확정).
-- 인당회계사도 자기 담당 청구·상담을 봐야 일을 할 수 있다. 다만 **조회만**이다 —
-- 쓰기는 지금대로 등급별 정책이 막는다(확정 청구서는 회계사·팀장 이상, 상담은 본인 것만 등).
--
-- 이 표들에는 `perhead_block_select` 라는 **RESTRICTIVE** 정책이 걸려 있었다.
-- restrictive 는 다른 정책과 AND 로 묶이므로, 여는 방법은 그 정책을 지우는 것뿐이다.
drop policy if exists perhead_block_select on public.billing_records;   -- 청구기록·청구서 작성
drop policy if exists perhead_block_select on public.billing_targets;   -- 세무조정 대상선정
drop policy if exists perhead_block_select on public.clients;           -- 위 화면들이 읽는 거래처
drop policy if exists perhead_block_select on public.invoices;          -- 청구서
drop policy if exists perhead_block_select on public.consultations;     -- 상담진행·상담기록
drop policy if exists perhead_block_select on public.library_documents; -- 자료실
drop policy if exists perhead_block_select on public.library_fulltext;  -- 자료실 본문

comment on function public.is_perhead() is
  '인당회계사인가. 2026-09-03 부터 청구·상담 자료는 조회 허용(쓰기는 계속 등급 정책으로 제한). '
  '아직 막혀 있는 것: biz_audit_log · biz_budget_renewal · biz_revenue_actual.';
