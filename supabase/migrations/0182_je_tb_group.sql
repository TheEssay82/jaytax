-- 0182 JET — 기초잔액 대사(4_기초잔액검토)용 잔액표 칸(사용자 2026-10-21, 실물 조서 나래 · 세원).
-- 원장 계정 하나가 공시과목 여럿으로 나뉘면(세원 감가상각누계액 → 자산군별 6줄) 같은 계정코드가 여러 줄이 된다 → 기본키를 줄 순서(ord)로.
-- grp = 묶음(차이 합이 0이면 공시과목 나눔 · 재분류로 상쇄), side = 잔액 방향(1 차변 · −1 대변, 비우면 코드로 판정).
alter table public.je_tb add column if not exists grp text, add column if not exists side smallint check (side in (1, -1)), add column if not exists ord integer;
drop policy if exists je_tb_del on public.je_tb;
create policy je_tb_del on public.je_tb for delete using (public.is_audit_staff() and not public.is_readonly());
comment on column public.je_tb.grp is '묶음 — 원장 계정 하나가 공시과목 여럿이면 같은 묶음(차이 합이 0이면 상쇄).';
comment on column public.je_tb.side is '잔액 방향 1 차변 계정 · −1 대변 계정(비우면 코드로 판정).';
alter table public.je_tb drop constraint if exists je_tb_pkey;
update public.je_tb set ord = 0 where ord is null;
alter table public.je_tb alter column ord set not null;
alter table public.je_tb add primary key (upload_id, ord);
