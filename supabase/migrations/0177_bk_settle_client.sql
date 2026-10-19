-- 0177 기장배분 — 거래처별 입금(ERP 부서별원장)과 세무조정 기장수행 / 자가 구분(사용자 2026-10-19).
--
-- 원본 엑셀은 기장24 시트에서 입금 줄마다 기장 / 세무조정 / A열(기장팀 · 자체세무조정)을 손으로 나눴다.
-- 여기서는 원장을 올리면 거래처마다 한 줄로 모으고(입금 = 외상매출금 대변, 대손 전표 제외),
-- 입금을 그 해 청구 비율(기장대리수입 · 세무조정수입 · 그 밖의 수입)로 나눈다. 자문(컨설팅)은 앱 매출 실적의 비율로 기장 안에서 뗀다.
--   · 세무조정 구분 기본값: 기장팀 원장에 기장 청구가 있는 거래처 = 기장수행, 그 밖(감사팀 원장 포함) = 자가. 사람이 거래처마다 바꾼다.
--   · 담당 회계사: 사업장의 ERP 거래처코드로 잇고, 못 이으면 사람이 고른다.
--   · 다시 올려도 사람이 고친 구분·담당은 남긴다(mode_by_hand · cpa_by_hand).

create table if not exists public.bk_settle_client (
  fy            integer not null references public.bk_settle(fy),
  dept          text not null check (dept in ('기장팀', '감사팀')),
  code          text not null,                 -- ERP 거래처코드
  name          text not null default '',
  cpa           text check (cpa in ('조현규', '김준성', '정우철')),
  cash          numeric not null default 0,    -- 입금(VAT 포함)
  cash_bk       numeric not null default 0,    -- 그중 기장(자문 포함)
  cash_adv      numeric not null default 0,    -- 그중 자문(컨설팅) — 기장 안에 든 것
  cash_tax      numeric not null default 0,    -- 그중 세무조정
  cash_other    numeric not null default 0,    -- 그중 감사·용역 등(배분과 무관)
  billed_bk     numeric not null default 0,    -- 청구(VAT 제외) 기장대리수입
  billed_tax    numeric not null default 0,    -- 청구(VAT 제외) 세무조정수입
  billed_other  numeric not null default 0,    -- 청구(VAT 제외) 그 밖의 수입
  writeoff      numeric not null default 0,    -- 대손상각비
  tax_mode      text not null default '자가' check (tax_mode in ('기장수행', '자가')),
  mode_by_hand  boolean not null default false,
  cpa_by_hand   boolean not null default false,
  memo          text,
  updated_at    timestamptz not null default now(),
  updated_name  text,
  primary key (fy, dept, code)
);
comment on table public.bk_settle_client is '기장배분 — 거래처별 입금·청구·대손(ERP 부서별원장)과 세무조정 기장수행/자가 구분.';

drop trigger if exists bk_settle_client_touch on public.bk_settle_client;
create trigger bk_settle_client_touch before update on public.bk_settle_client for each row execute function public.dsd_touch();
alter table public.bk_settle_client enable row level security;
revoke all on public.bk_settle_client from anon;
drop policy if exists bk_settle_client_sel on public.bk_settle_client;
create policy bk_settle_client_sel on public.bk_settle_client for select using (public.expense_member_name() is not null);
drop policy if exists bk_settle_client_ins on public.bk_settle_client;
create policy bk_settle_client_ins on public.bk_settle_client for insert with check (public.expense_member_name() is not null and not public.is_readonly());
drop policy if exists bk_settle_client_upd on public.bk_settle_client;
create policy bk_settle_client_upd on public.bk_settle_client for update using (public.expense_member_name() is not null and not public.is_readonly()) with check (public.expense_member_name() is not null and not public.is_readonly());
