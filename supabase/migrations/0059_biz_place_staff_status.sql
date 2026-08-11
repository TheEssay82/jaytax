-- 0059: 사업장 담당직원 상태(staff_status) — 실제 직원 배정과 별개의 표시값
--
-- 배경(사용자 요구 2026-08-11): 담당직원은 실제 직원 계정(biz_place_staff→profiles)에 연결되는데,
--  과거·임시거래처거나 아직 배정 전인 경우는 실제 직원이 없다. 이를 사업장 표시값으로 남긴다.
--  · '배정예정' = 곧 배정 예정
--  · 'N/A'     = 과거·임시거래처 → 배정 불필요
--  실제 직원이 배정되면 이 값은 무의미(화면은 실제 직원 우선 표시). nullable(빈값=일반 미배정).

alter table public.biz_place add column if not exists staff_status text
  check (staff_status in ('배정예정', 'N/A'));
