-- 0181 감사업무관리 › Journal Entry 시스템(JET) — 1차(사용자 2026-10-21).
--
-- 흐름: ① 기본정보 · 분개장 올리기 → ② 검토진행(필수 검증) → ③ 보완할 점 → ⑥ 조서 엑셀(audit tool 업로드용).
-- 2차에서 ④ 샘플링 증빙요청 · ⑤ 결과 입력을 붙인다(je_pick 에 칸을 미리 둔다).
--
-- ⚠️ 주석 · DSD 는 「미공시 재무정보를 서버에 쌓지 않는다」(0143)가 원칙이지만, JET 는 **분개장 줄을 DB 에 저장**한다(사용자 결정 2026-10-21 —
--    다시 돌리기 · 샘플 추적 · 재요청 판 비교 때문). 대신 감사팀(is_audit_staff)만 읽고, 주민번호 꼴은 올릴 때 지운다(앱 jeParse).
-- 작업 단위는 일반조서 · 주석과 같은 dsd_engagement(거래처 × 사업연도 × 별도/연결).

create table if not exists public.je_job (
  engagement_id uuid primary key references public.dsd_engagement(id) on delete cascade,
  erp           text not null default '더존' check (erp in ('더존', '영림원')),
  listed        boolean not null default false,          -- 상장 여부(완화절차는 비상장만)
  relaxed       boolean not null default false,          -- 완화절차(기말 · 결산분개 중심)
  relaxed_note  text,                                     -- 완화 사유(4요소 판단)
  materiality   numeric,                                  -- 전체 중요성(원)
  pm            numeric,                                  -- 수행중요성(원)
  trivial       numeric,                                  -- 명백히 사소한 금액(원)
  params        jsonb not null default '{}'::jsonb,       -- 시나리오 기준값(금액 · 빈도 · 키워드 …)
  scenarios     jsonb not null default '{}'::jsonb,       -- 시나리오 코드 → {on, reason(미수행 사유), conclusion(결론 고친 것)}
  contacts      jsonb not null default '[]'::jsonb,       -- 회사 담당자(성명 · 부서 · 전화 · 메일)
  preparer      text,
  reviewer      text,
  prepared_on   date,
  reviewed_on   date,
  memo          text,
  updated_at    timestamptz not null default now(),
  updated_name  text
);
comment on table public.je_job is 'JET — 감사 건마다 한 줄. ERP · 중요성 · 시나리오 선택 · 결론 · 작성자/검토자.';

-- 올린 파일 한 번 = 한 판. 다시 받으면 판이 늘고(재요청 경과), current 하나만 검사에 쓴다.
create table if not exists public.je_upload (
  id            uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.je_job(engagement_id) on delete cascade,
  kind          text not null check (kind in ('journal', 'tb')),
  version       integer not null,
  current       boolean not null default true,
  file_name     text not null,
  erp           text,
  lines         integer not null default 0,
  vouchers      integer not null default 0,
  dr_total      numeric not null default 0,
  cr_total      numeric not null default 0,
  date_from     date,
  date_to       date,
  masked        integer not null default 0,
  note          text,                                     -- 재요청 사유 등
  created_at    timestamptz not null default now(),
  created_name  text,
  unique (engagement_id, kind, version)
);
comment on table public.je_upload is 'JET — 올린 분개장 · 시산표 판. 재요청이면 판이 늘고 current 만 검사에 쓴다.';

create table if not exists public.je_line (
  upload_id  uuid not null references public.je_upload(id) on delete cascade,
  seq        integer not null,
  vdate      date not null,
  vno        text not null,
  acct_code  text not null default '',
  acct_name  text not null default '',
  dr         numeric not null default 0,
  cr         numeric not null default 0,
  cp_code    text,
  cp_name    text,
  memo       text not null default '',
  side       text,
  vtype      text not null default '일반',
  appr_date  date,
  appr_no    text,
  primary key (upload_id, seq)
);
comment on table public.je_line is 'JET — 분개장 표준 줄. 전표 = (vdate, vno). 작성자 · 승인자 · 입력일은 더존 · 영림원 내보내기에 없다.';

create table if not exists public.je_tb (
  upload_id  uuid not null references public.je_upload(id) on delete cascade,
  acct_code  text not null,
  acct_name  text not null default '',
  open_bal   numeric not null default 0,                  -- 기초(전기말)
  dr         numeric not null default 0,
  cr         numeric not null default 0,
  close_bal  numeric not null default 0,                  -- 기말
  primary key (upload_id, acct_code)
);
comment on table public.je_tb is 'JET — 시산표(계정별 기초 · 차변 · 대변 · 기말). 영림원은 분개장 파일의 계정별원장에서 만든다.';

-- 고른 전표(샘플). 1차는 중요성 기준 이상 거래 선정까지, 2차에서 증빙 · 회사답변 · 결과 칸을 쓴다.
create table if not exists public.je_pick (
  engagement_id uuid not null references public.je_job(engagement_id) on delete cascade,
  vdate         date not null,
  vno           text not null,
  scenarios     text[] not null default '{}',
  amount        numeric not null default 0,
  reason        text,
  selected      boolean not null default true,
  evidence      text,                                     -- 2차: 확인한 증빙
  answer        text,                                     -- 2차: 회사 답변
  result        text check (result in ('이상없음', '예외', '확인중')),
  note          text,
  updated_at    timestamptz not null default now(),
  updated_name  text,
  primary key (engagement_id, vdate, vno)
);
comment on table public.je_pick is 'JET — 선정 전표. 시나리오 · 금액 · 선정사유, 2차에 증빙 · 회사답변 · 결과.';

create index if not exists je_upload_eng on public.je_upload (engagement_id, kind, current);

do $$
declare t text;
begin
  foreach t in array array['je_job', 'je_upload', 'je_line', 'je_tb', 'je_pick'] loop
    execute format('alter table public.%1$s enable row level security', t);
    execute format('revoke all on public.%1$s from anon', t);
    execute format('drop policy if exists %1$s_sel on public.%1$s', t);
    execute format('create policy %1$s_sel on public.%1$s for select using (public.is_audit_staff())', t);
    execute format('drop policy if exists %1$s_ins on public.%1$s', t);
    execute format('create policy %1$s_ins on public.%1$s for insert with check (public.is_audit_staff() and not public.is_readonly())', t);
    execute format('drop policy if exists %1$s_upd on public.%1$s', t);
    execute format('create policy %1$s_upd on public.%1$s for update using (public.is_audit_staff() and not public.is_readonly()) with check (public.is_audit_staff() and not public.is_readonly())', t);
  end loop;
  -- 고른 전표는 사람이 빼기도 한다. 분개장 판은 지우지 않는다(재요청 경과) — current 만 바꾼다.
  drop policy if exists je_pick_del on public.je_pick;
  create policy je_pick_del on public.je_pick for delete using (public.is_audit_staff() and not public.is_readonly());
  foreach t in array array['je_job', 'je_pick'] loop
    execute format('drop trigger if exists %1$s_touch on public.%1$s', t);
    execute format('create trigger %1$s_touch before update on public.%1$s for each row execute function public.dsd_touch()', t);
  end loop;
end $$;
