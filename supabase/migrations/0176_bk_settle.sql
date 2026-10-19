-- 0176 팀결산시스템 › 기장배분 — 기장팀 비용을 조현규·김준성·정우철에게 나누는 결산(사용자 2026-10-19).
--
-- 원본은 조현규 결산 엑셀의 「3. 기장_세무배분안(연도)」 시트. 규칙:
--   · 기간 7/1~익년 6/30. fy = 끝나는 해(2026 = 2025.07.01 ~ 2026.06.30) — 경비귀속처리와 같은 셈.
--   · 비용(현금주의) 13항목 − 정액부담금(1인 fixed_share) → 나머지를 비율로.
--   · 비율 = 기장료 + 기장수행 세무조정 − 안분미대상 자문(모두 VAT 제외) + 미수금 변동(기말 − 기초 + 대손, VAT 제외).
--     원본의 실수(조현규 기말 미수금이 김준성 칸, VAT 섞임, 자문을 김준성만 뺌)는 여기서 고친다(사용자 확정).
--   · 정산 = 회수금액(기장 + 세무조정 전체, VAT 포함) − VAT − 공통비(common_rate) − 정액 − 비율부담 = 받을 금액.
--   · 숫자마다 상태 — 작년값 / 추정 / 확정. 예상안은 작년 값을 가져와 만들고, 결산시트가 오면 확정한다.
-- 보는 사람: 경비귀속처리와 같은 네 사람(expense_member_name). 지우기 정책은 두지 않는다.

create table if not exists public.bk_settle (
  fy            integer primary key,
  status        text not null default '예상' check (status in ('예상', '확정')),
  fixed_share   numeric not null default 1200000,   -- 1인 정액부담금(개인 업무 보조비)
  common_rate   numeric not null default 0.1,       -- 공통비율(매출 대비)
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_name  text
);
comment on table public.bk_settle is '기장배분 — 해(fy=끝나는 해)마다 한 줄. 변수와 예상/확정 상태.';

create table if not exists public.bk_settle_cost (
  id            uuid primary key default gen_random_uuid(),
  fy            integer not null references public.bk_settle(fy),
  item          text not null,                       -- 1) 급여+상여 … 13) 현금시재
  staff         text not null default '',            -- 정남지 · 김민섭 · 김동주 · '' (사람에 안 걸리는 비용)
  amount        numeric not null default 0,
  state         text not null default '추정' check (state in ('작년값', '추정', '확정')),
  source        text,                                -- 어디서 온 숫자인지(화면 표시)
  memo          text,
  updated_at    timestamptz not null default now(),
  updated_name  text,
  unique (fy, item, staff)
);
comment on table public.bk_settle_cost is '기장배분 — 기장팀 비용 칸(항목 × 직원). 상태 작년값/추정/확정.';

create table if not exists public.bk_settle_cpa (
  fy            integer not null references public.bk_settle(fy),
  cpa           text not null check (cpa in ('조현규', '김준성', '정우철')),
  bk_fee        numeric not null default 0,          -- 기장료 입금(VAT 포함)
  tax_bk        numeric not null default 0,          -- 기장수행 세무조정 입금(VAT 포함)
  tax_self      numeric not null default 0,          -- 자가 세무조정 입금(VAT 포함) — 비율에는 안 들고 정산에만
  advisory_excl numeric not null default 0,          -- 안분미대상 자문(VAT 포함, 기장료 안에 든 것)
  ar_open       numeric not null default 0,          -- 기초 미수금(VAT 제외)
  ar_close      numeric not null default 0,          -- 기말 미수금(VAT 제외)
  writeoff      numeric not null default 0,          -- 당기 대손(VAT 제외)
  states        jsonb not null default '{}'::jsonb,  -- 칸 이름 → 작년값/추정/확정
  sources       jsonb not null default '{}'::jsonb,  -- 칸 이름 → 출처
  memo          text,
  updated_at    timestamptz not null default now(),
  updated_name  text,
  primary key (fy, cpa)
);
comment on table public.bk_settle_cpa is '기장배분 — 담당 회계사별 수임료·미수금. 비율과 정산의 재료.';

do $$
declare t text;
begin
  foreach t in array array['bk_settle', 'bk_settle_cost', 'bk_settle_cpa'] loop
    execute format('drop trigger if exists %1$s_touch on public.%1$s', t);
    execute format('create trigger %1$s_touch before update on public.%1$s for each row execute function public.dsd_touch()', t);
    execute format('alter table public.%1$s enable row level security', t);
    execute format('revoke all on public.%1$s from anon', t);
    execute format('drop policy if exists %1$s_sel on public.%1$s', t);
    execute format('create policy %1$s_sel on public.%1$s for select using (public.expense_member_name() is not null)', t);
    execute format('drop policy if exists %1$s_ins on public.%1$s', t);
    execute format('create policy %1$s_ins on public.%1$s for insert with check (public.expense_member_name() is not null and not public.is_readonly())', t);
    execute format('drop policy if exists %1$s_upd on public.%1$s', t);
    execute format('create policy %1$s_upd on public.%1$s for update using (public.expense_member_name() is not null and not public.is_readonly()) with check (public.expense_member_name() is not null and not public.is_readonly())', t);
  end loop;
end $$;
