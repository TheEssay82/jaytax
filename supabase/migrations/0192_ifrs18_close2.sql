-- 0192 K-IFRS 1118 월결산 — 2차 마감(조정전표 반영 검증) (사용자 2026-11-09).
--
-- 1차 마감: 회사 장부 그대로(조정전표 전) 1118 결과를 확정한다(0191).
-- 2차 마감: 회사가 「조정 권고 전표」를 권고코드를 달아 기표한 뒤 같은 달 분개장을 다시 올려,
--           권고 잔액이 0 이고 1118 결과가 1차 마감과 같음을 확인하고 남긴다. 2026년은 10월 결산부터.
alter table public.ifrs18_close add column if not exists close2_summary jsonb;
alter table public.ifrs18_close add column if not exists close2_at timestamptz;
alter table public.ifrs18_close add column if not exists close2_by_name text;
alter table public.ifrs18_close add column if not exists close2_by_id uuid references auth.users (id) on delete set null;

alter table public.ifrs18_log drop constraint if exists ifrs18_log_action_check;
alter table public.ifrs18_log add constraint ifrs18_log_action_check
  check (action in ('분개장 읽음', '판단 저장', '판단 삭제', '마감', '마감 해제', '2차 마감', '2차 마감 해제', '엑셀 내려받기'));
