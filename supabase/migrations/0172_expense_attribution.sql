-- 0172 팀결산 경비 귀속 — ERP 지출결의서 상세를 올려 줄마다 업무/개인을 정한다(사용자 2026-10-19).
--
-- 지금까지는 엑셀(ERP경비반영분_정리_FY{연도}년_{이름}_…xlsx)로 해마다 손으로 했다. 규칙:
--   · 정산기간 7/1~익년 6/30(지출일 기준). fy = 끝나는 해(FY2026 = 2025-07-01 ~ 2026-06-30).
--   · 바구니(예산집단): 정우철 · 조현규 · 김준성. **송현주는 정우철 바구니** — 송현주 결산은 정우철 결산에 속한다.
--   · 줄마다 클라이언트 꼬리표(거래처명 · 「기장」 · 「기타」)와 업무 금액 / 개인 금액(공급가액 기준).
--     「기장」 업무 = 기장비용으로 안분, 그 밖의 업무 = 3인 공동, 개인 = 바구니 주인 귀속.
--     명절선물처럼 김준성·조현규 몫을 따로 떼는 줄은 split_kjs / split_jhg.
--   · **적요만으로 확정하지 않는다** — 화면은 「제안」까지만 채우고, 확정은 사람이 줄마다 누른다(status).
-- 조회·작성: 정우철 · 조현규 · 김준성 · 송현주(사용자 지정). 개인 지출이라 그 밖의 사람은 못 본다.

create or replace function public.expense_member_name() returns text
language sql stable security definer set search_path = public as $$
  select case when name in ('정우철', '조현규', '김준성', '송현주') then name end
  from public.profiles where id = auth.uid() and not coalesce(sandbox, false);
$$;
revoke all on function public.expense_member_name() from public, anon;
grant execute on function public.expense_member_name() to authenticated;
comment on function public.expense_member_name() is '팀결산 경비 귀속 화면을 쓰는 네 사람이면 그 이름, 아니면 null.';

create table if not exists public.expense_upload (
  id           uuid primary key default gen_random_uuid(),
  fy           integer not null,
  writer       text not null,                       -- 결의서 작성자(ERP 계정 주인)
  basket       text not null check (basket in ('정우철', '조현규', '김준성')),
  file_name    text not null default '',
  row_count    integer not null default 0,
  supply_total numeric not null default 0,
  uploaded_by  uuid references auth.users(id) on delete set null default auth.uid(),
  uploaded_name text,
  uploaded_at  timestamptz not null default now()
);
comment on table public.expense_upload is '팀결산 경비 귀속 — 올린 ERP 지출결의서 파일 기록(작성자·연도마다).';

create table if not exists public.expense_line (
  id              uuid primary key default gen_random_uuid(),
  fy              integer not null,
  basket          text not null check (basket in ('정우철', '조현규', '김준성')),
  writer          text not null,
  upload_id       uuid references public.expense_upload(id) on delete set null,
  exjunpyo_no     text not null,                    -- 지출결의서번호
  line_no         integer not null,
  evid_date       date,                             -- 증빙(지출)일자
  title           text,                             -- 결의서 제목(신용카드 사용내역 / 개인카드 …)
  description     text not null default '',         -- 지출내역(적요)
  account         text,                             -- 계정과목
  vendor          text,                             -- 거래처명(가맹점)
  supply          numeric not null default 0,
  vat             numeric not null default 0,
  total           numeric not null default 0,
  inv_slip        text,
  acct_slip       text,
  wf_no           text,                             -- 전자결재번호
  card_type       text,                             -- 법카 | 개인
  -- 사람이 정하는 칸
  client          text,                             -- 거래처명 · 기장 · 기타
  work_amount     numeric,                          -- 업무사용(공급가액 중)
  split_kjs       numeric not null default 0,       -- 김준성 몫
  split_jhg       numeric not null default 0,       -- 조현규 몫
  status          text not null default '미분류' check (status in ('미분류', '제안', '확정')),
  suggest_reason  text,                             -- 제안 근거(화면 표시용)
  memo            text,
  decided_by      uuid references auth.users(id) on delete set null,
  decided_name    text,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (fy, exjunpyo_no, line_no),
  check (status <> '확정' or (client is not null and work_amount is not null))
);
comment on table public.expense_line is '팀결산 경비 귀속 — 지출결의서 상세 줄. 개인사용 = 공급가액 − 업무 − 김준성 − 조현규. 확정은 사람이 줄마다.';
create index if not exists expense_line_fy_idx on public.expense_line(fy, basket, writer);

drop trigger if exists expense_line_touch on public.expense_line;
create trigger expense_line_touch before update on public.expense_line
  for each row execute function public.dsd_touch();

alter table public.expense_upload enable row level security;
alter table public.expense_line enable row level security;
do $$
declare t text;
begin
  foreach t in array array['expense_upload', 'expense_line'] loop
    execute format('drop policy if exists %1$s_sel on public.%1$s', t);
    execute format('create policy %1$s_sel on public.%1$s for select using (public.expense_member_name() is not null)', t);
    execute format('drop policy if exists %1$s_ins on public.%1$s', t);
    execute format('create policy %1$s_ins on public.%1$s for insert with check (public.expense_member_name() is not null and not public.is_readonly())', t);
    execute format('drop policy if exists %1$s_upd on public.%1$s', t);
    execute format('create policy %1$s_upd on public.%1$s for update using (public.expense_member_name() is not null and not public.is_readonly()) with check (public.expense_member_name() is not null and not public.is_readonly())', t);
    execute format('drop policy if exists %1$s_del on public.%1$s', t);
    execute format('create policy %1$s_del on public.%1$s for delete using (public.expense_member_name() is not null and not public.is_readonly())', t);
  end loop;
end $$;
