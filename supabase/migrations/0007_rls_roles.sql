-- 0007: 역할 기반 RLS — 쓰기 권한을 DB 차원에서 강제 (RBAC 3단계)
-- 적용: Supabase SQL Editor 에서 실행
-- 읽기(SELECT)는 기존대로 전원 허용 유지. 쓰기(INSERT/UPDATE/DELETE)만 역할별로 제한.

-- 현재 사용자의 역할 조회 (RLS 재귀 방지: SECURITY DEFINER = postgres 권한)
create or replace function public.auth_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- 관리권한(거래처·청구서·청구대상 쓰기): superuser / accountant / team_lead
-- 설정권한(app_config 쓰기): superuser / accountant

-- ── clients ──
drop policy if exists clients_ins on public.clients;
drop policy if exists clients_upd on public.clients;
drop policy if exists clients_del on public.clients;
create policy clients_ins on public.clients for insert to authenticated
  with check (public.auth_role() in ('superuser','accountant','team_lead'));
create policy clients_upd on public.clients for update to authenticated
  using (public.auth_role() in ('superuser','accountant','team_lead'))
  with check (public.auth_role() in ('superuser','accountant','team_lead'));
create policy clients_del on public.clients for delete to authenticated
  using (public.auth_role() in ('superuser','accountant','team_lead'));

-- ── billing_records ──
drop policy if exists billing_records_ins on public.billing_records;
drop policy if exists billing_records_upd on public.billing_records;
drop policy if exists billing_records_del on public.billing_records;
create policy billing_records_ins on public.billing_records for insert to authenticated
  with check (public.auth_role() in ('superuser','accountant','team_lead'));
create policy billing_records_upd on public.billing_records for update to authenticated
  using (public.auth_role() in ('superuser','accountant','team_lead'))
  with check (public.auth_role() in ('superuser','accountant','team_lead'));
create policy billing_records_del on public.billing_records for delete to authenticated
  using (public.auth_role() in ('superuser','accountant','team_lead'));

-- ── billing_targets ──
drop policy if exists billing_targets_ins on public.billing_targets;
drop policy if exists billing_targets_upd on public.billing_targets;
drop policy if exists billing_targets_del on public.billing_targets;
create policy billing_targets_ins on public.billing_targets for insert to authenticated
  with check (public.auth_role() in ('superuser','accountant','team_lead'));
create policy billing_targets_upd on public.billing_targets for update to authenticated
  using (public.auth_role() in ('superuser','accountant','team_lead'))
  with check (public.auth_role() in ('superuser','accountant','team_lead'));
create policy billing_targets_del on public.billing_targets for delete to authenticated
  using (public.auth_role() in ('superuser','accountant','team_lead'));

-- ── app_config (설정 변경: superuser / accountant) ──
drop policy if exists app_config_ins on public.app_config;
drop policy if exists app_config_upd on public.app_config;
drop policy if exists app_config_del on public.app_config;
create policy app_config_ins on public.app_config for insert to authenticated
  with check (public.auth_role() in ('superuser','accountant'));
create policy app_config_upd on public.app_config for update to authenticated
  using (public.auth_role() in ('superuser','accountant'))
  with check (public.auth_role() in ('superuser','accountant'));
create policy app_config_del on public.app_config for delete to authenticated
  using (public.auth_role() in ('superuser','accountant'));

-- 참고: *_sel(읽기), update_requests(게시판 전원), profiles(0005) 정책은 변경 없음.
