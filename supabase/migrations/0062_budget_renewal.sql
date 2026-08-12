-- 0062: 예산 기능 — 연단위 계약 갱신 가정(가벼운 예산 레이어).
--   예산 = 차기 정산연도에 유효계약이 계속된다는 가정의 예상매출.
--   · 계속계약(기장 월 등)은 엔진이 자동 projection → 저장 불필요.
--   · 연단위 귀속계약(감사·용역·조정료)은 자동 연장 안 됨 → 전년 계약을 차기연도로 '갱신' 가정하는 라인을 여기 저장.
--   실계약은 건드리지 않는 별도 레이어. 근거계약(source)당 대상연도 1행.

create table if not exists public.biz_budget_renewal (
  id                 uuid primary key default gen_random_uuid(),
  target_year        int not null,                                              -- 예산 대상 정산연도(회계연도 7/1~익6/30)
  source_contract_id uuid references public.biz_sales_contract(id) on delete set null, -- 근거 전년 연단위 계약(수기행이면 null)
  team               text not null check (team in ('감사team','taxteam')),
  entity_id          uuid references public.biz_entity(id) on delete set null,  -- 거래처(표시·집계용)
  category_code      text,                                                      -- 유형 스냅샷(전년 계약 기준)
  label              text,                                                      -- 표시 라벨(거래처·유형 스냅샷)
  amount             numeric(15,2) not null default 0,                          -- 갱신 가정 예산액(공급가액·순액)
  active             boolean not null default true,                             -- 갱신 포함 여부(끄면 예산 제외)
  note               text,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id),
  updated_at         timestamptz not null default now()
);
create index if not exists biz_budget_renewal_year_idx on public.biz_budget_renewal(target_year);
create index if not exists biz_budget_renewal_entity_idx on public.biz_budget_renewal(entity_id);
-- 근거계약당 대상연도 1행(수기행 source null 은 다중 허용).
create unique index if not exists uniq_budget_renewal_src on public.biz_budget_renewal(target_year, source_contract_id) where source_contract_id is not null;

-- created_by/updated 트리거(0050 함수 재사용)
drop trigger if exists trg_biz_budget_renewal_bi on public.biz_budget_renewal;
create trigger trg_biz_budget_renewal_bi before insert on public.biz_budget_renewal for each row execute function public.biz_set_created_by();
drop trigger if exists trg_biz_budget_renewal_bu on public.biz_budget_renewal;
create trigger trg_biz_budget_renewal_bu before update on public.biz_budget_renewal for each row execute function public.biz_touch_updated();

-- RLS: 조회=내부 실무자(외부·인당회계사 차단) / 편집=회계사·팀장·최고관리자(biz_can_reveal)
alter table public.biz_budget_renewal enable row level security;
drop policy if exists biz_budget_renewal_sel on public.biz_budget_renewal;
create policy biz_budget_renewal_sel on public.biz_budget_renewal for select to authenticated
  using (not public.is_external() and not public.is_perhead());
drop policy if exists biz_budget_renewal_ins on public.biz_budget_renewal;
create policy biz_budget_renewal_ins on public.biz_budget_renewal for insert to authenticated
  with check (public.biz_can_reveal() and not public.is_readonly());
drop policy if exists biz_budget_renewal_upd on public.biz_budget_renewal;
create policy biz_budget_renewal_upd on public.biz_budget_renewal for update to authenticated
  using (public.biz_can_reveal() and not public.is_readonly()) with check (public.biz_can_reveal() and not public.is_readonly());
drop policy if exists biz_budget_renewal_del on public.biz_budget_renewal;
create policy biz_budget_renewal_del on public.biz_budget_renewal for delete to authenticated
  using (public.biz_can_reveal() and not public.is_readonly());
