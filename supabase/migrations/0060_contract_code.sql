-- 0060: 매출계약코드(contract_code) + 복합계약 포함유형 + 날짜추정 플래그
--
-- 배경(사용자 확정 2026-08-11):
--  · 매출계약코드 = 거래처코드-사업장코드-자동갱신(R/F)-유형코드-팀코드-시작연도-순번
--    (예: I0002-01-R-BK-T-2026-01). 시스템 자동생성, 기존 계약 매칭·수정의 안정 키.
--  · 복합계약: 주 매출유형(category_code)은 1개, 함께 커버하는 세부 유형은 included_codes(다중, 선택).
--    코드·금액엔 영향 없음(대표 유형만 코드에). 리포팅·검색용.
--  · 정보관리 시작월 2026-07 이전의 개시/종료일은 추정값 → date_estimated=true 로 표시.
--
-- 안전: 전부 nullable/기본값. 코드 부여·날짜규칙은 별도 백필로 진행.

alter table public.biz_sales_contract add column if not exists contract_code   text;
alter table public.biz_sales_contract add column if not exists included_codes  text[] not null default '{}';
alter table public.biz_sales_contract add column if not exists date_estimated  boolean not null default false;

-- 코드 유일(빈값 제외). 재부여·수동수정 충돌 방지.
create unique index if not exists uniq_contract_code
  on public.biz_sales_contract(contract_code) where contract_code is not null and contract_code <> '';
