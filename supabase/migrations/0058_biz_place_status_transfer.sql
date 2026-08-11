-- 0058: 사업장 상태(status) 확장 — '정상/폐업' → '정상/폐업/이관' + 귀속월·이관업체 정보
-- (프로덕션 적용 시 이름이 '0057_biz_place_status_transfer'로 기록됨 — 0057 번호가 installment_billed_at와
--  겹쳐 로컬 파일만 0058로 정리. 이미 적용된 프로덕션 마이그 기록은 타임스탬프로 순서 정상.)
--
-- 배경(사용자 요구 2026-08-11):
--  · 사업장 '상태'는 필수값이며 기본은 '정상'(= 현재 우리 거래처)이다. (DB default 이미 '정상')
--  · '폐업'(문을 닫음)·'이관'(타 회계법인/세무사사무실로 옮김)을 구분한다.
--  · 폐업·이관은 그 '귀속월'(status_month, YYYY-MM)을 함께 기록한다.
--  · 이관은 추가로 이관업체(transfer_to)·연락처(transfer_contact)·담당자명(transfer_manager)을 기록한다.
--
-- 안전: 기존 데이터(정상 177·폐업 11)는 그대로 통과. 신규 컬럼은 전부 nullable.

-- 1) status CHECK 확장: '이관' 허용.
alter table public.biz_place drop constraint if exists biz_place_status_check;
alter table public.biz_place add  constraint biz_place_status_check
  check (status in ('정상', '폐업', '이관'));

-- 2) 귀속월 + 이관업체 정보 컬럼.
alter table public.biz_place add column if not exists status_month     text;  -- 폐업/이관 귀속월 'YYYY-MM'
alter table public.biz_place add column if not exists transfer_to      text;  -- 이관업체(수임처)
alter table public.biz_place add column if not exists transfer_contact text;  -- 이관업체 연락처
alter table public.biz_place add column if not exists transfer_manager text;  -- 이관업체 담당자명
