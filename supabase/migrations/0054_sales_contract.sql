-- 0054: 거래처관리 2.0.0 step2 — 매출계약(biz_sales_contract) + 위성 3종
--
-- 결정(스펙 대화 확정): 매출유형=코드트리(leaf 플래그) / 범위=계약정의 / 대상=사업장 or 법인·개인 /
--  메인·종속(parent_id, 청구금액 메인만) / 청구주기⊥분할 / 계약금액=1회기준(분할시 총액) /
--  담당=팀별후보 / 날짜=개시일자동+종료일자동제안·계속상태 / 귀속연도=신고류 선택 / 중복등록 허용(유니크 없음).
-- 기존 biz_* 무중단. 트리거(created_by/updated) 재사용(0050).

create table if not exists public.biz_sales_contract (
  id                 uuid primary key default gen_random_uuid(),
  entity_id          uuid not null references public.biz_entity(id) on delete cascade,   -- 귀속주체(법인/개인)
  place_id           uuid references public.biz_place(id) on delete set null,            -- 발생단위=사업장일 때
  occurrence_unit    text not null default '사업장' check (occurrence_unit in ('사업장','법인','개인')), -- 발생단위(#6)
  billing_unit       text check (billing_unit in ('사업장','법인','개인','건')),          -- 청구단위(#7)
  team               text not null check (team in ('감사team','taxteam')),               -- 수행팀(#2)
  category_code      text not null,                                                       -- 매출유형 트리 leaf 코드
  category_etc_name  text,                                                                -- 기타 선택 시 명칭(#3)
  includes_vat       boolean not null default false,                                      -- 기장: 부가세 포함(#4)
  includes_wht       boolean not null default false,                                      -- 기장: 원천세 포함(#4)
  advisory_type      text check (advisory_type in ('일반','전문')),                       -- 회계및세무자문(#4)
  parent_contract_id uuid references public.biz_sales_contract(id) on delete set null,    -- 종속→메인(#5)
  fiscal_year        int,                                                                 -- 귀속연도(신고류, 선택 #12)
  billing_cycle      text not null default '월' check (billing_cycle in ('월','분기','반기','연','발생시','건')), -- 청구주기(#8)
  is_installment     boolean not null default false,                                      -- 분할청구 여부(#8)
  amount             numeric(15,2) not null default 0,                                    -- 계약금액(1회기준·분할시 총액 #16)
  cpa                text,                                                                -- 담당CPA(#9)
  contract_date      date,                                                                -- 매출계약일(#12)
  start_date         date,                                                                -- 매출개시일(#12,13)
  end_date           date,                                                                -- 매출계약종료일(비움=계속 #14)
  note               text,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id),
  updated_at         timestamptz not null default now()
);
create index if not exists biz_contract_entity_idx on public.biz_sales_contract(entity_id);
create index if not exists biz_contract_place_idx  on public.biz_sales_contract(place_id);
create index if not exists biz_contract_parent_idx on public.biz_sales_contract(parent_contract_id);
create index if not exists biz_contract_team_idx   on public.biz_sales_contract(team);
create index if not exists biz_contract_cat_idx    on public.biz_sales_contract(category_code);

-- 계약 담당직원(다중, 팀별 후보 #10)
create table if not exists public.biz_contract_staff (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.biz_sales_contract(id) on delete cascade,
  staff_id    uuid not null references public.profiles(id) on delete restrict,
  staff_name  text,
  active      boolean not null default true,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);
create unique index if not exists uniq_contract_staff_active on public.biz_contract_staff(contract_id, staff_id) where active;
create index if not exists biz_cstaff_contract_idx on public.biz_contract_staff(contract_id);

-- 분할청구 회차(#8): 계약금/중도금n차/잔금 + 금액 + 예정일 + 조건메모
create table if not exists public.biz_contract_installment (
  id             uuid primary key default gen_random_uuid(),
  contract_id    uuid not null references public.biz_sales_contract(id) on delete cascade,
  seq            int not null default 1,
  label          text not null,                 -- 계약금 / 중도금1차 / 잔금 ...
  amount         numeric(15,2) not null default 0,
  due_date       date,                          -- 예정일(선택)
  condition_note text,                          -- 조건메모('착수 시' 등)
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id),
  updated_at     timestamptz not null default now()
);
create index if not exists biz_cinst_contract_idx on public.biz_contract_installment(contract_id);

-- 무료/할인 구간(#15): 여러 개
create table if not exists public.biz_contract_discount (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.biz_sales_contract(id) on delete cascade,
  disc_type   text not null check (disc_type in ('무료','할인')),
  start_date  date,
  end_date    date,
  rate        numeric(5,2),                      -- 할인율(%)
  amount      numeric(15,2),                     -- 할인액(택1)
  note        text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);
create index if not exists biz_cdisc_contract_idx on public.biz_contract_discount(contract_id);

-- 트리거: created_by(INSERT) + updated(UPDATE) — 0050 함수 재사용
do $$
declare t text;
begin
  foreach t in array array['biz_sales_contract','biz_contract_staff','biz_contract_installment','biz_contract_discount']
  loop
    execute format('drop trigger if exists %I on public.%I', 'trg_'||t||'_bi', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.biz_set_created_by()', 'trg_'||t||'_bi', t);
    execute format('drop trigger if exists %I on public.%I', 'trg_'||t||'_bu', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.biz_touch_updated()', 'trg_'||t||'_bu', t);
  end loop;
end $$;

-- RLS: 고객 민감 — 외부인·인당회계사 읽기 차단, 쓰기는 읽기전용 제외 (0050 패턴)
do $$
declare t text;
begin
  foreach t in array array['biz_sales_contract','biz_contract_staff','biz_contract_installment','biz_contract_discount']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (not public.is_external() and not public.is_perhead())', t||'_sel', t);
    execute format('drop policy if exists %I on public.%I', t||'_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (not public.is_external() and not public.is_readonly() and not public.is_perhead())', t||'_ins', t);
    execute format('drop policy if exists %I on public.%I', t||'_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (not public.is_external() and not public.is_readonly() and not public.is_perhead()) with check (not public.is_external() and not public.is_readonly() and not public.is_perhead())', t||'_upd', t);
    execute format('drop policy if exists %I on public.%I', t||'_del', t);
    execute format('create policy %I on public.%I for delete to authenticated using (not public.is_external() and not public.is_readonly() and not public.is_perhead())', t||'_del', t);
  end loop;
end $$;
