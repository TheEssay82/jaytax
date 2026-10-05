-- 0168 체험 계정(profiles.sandbox) — 인덕회계법인 심리실 직원이 감사업무관리를 **직접 눌러 보게**(사용자 2026-10-05).
--
-- 보기는 그 계정의 등급대로(심리실 = 인당회계사 등급으로 만들면 감사업무관리 전부가 보인다).
-- **쓰기는 (시연) 데모산업 건에서만** — 서버가 막는다(화면도 막지만 믿지 않는다).
--   · 일반조서 판(gwp_book)은 외감법상 지우지 않는 기록이라, 실제 회사에 연습 판이 쌓이면 안 된다.
--   · 감사업무 표(작업 건에 매인 것)는 그 건이 시연용(is_demo)일 때만, 파일 저장소(gwp·dsd-notes)는 경로의 건이 시연용일 때만.
--   · 그 밖의 **모든** 표는 체험 계정이 못 쓴다(거래처·청구·조회서·표준양식·절차 …). 알림·내 표 보기·로그·상담 사용량처럼 본인 것은 둔다.
-- 체험 계정 표시는 최고관리자만 바꾼다(쓰기잠금과 같은 가드).

alter table public.profiles add column if not exists sandbox boolean not null default false;
comment on column public.profiles.sandbox is '체험 계정 — 쓰기는 시연용(is_demo) 작업 건에서만(마이그 0168). 최고관리자만 바꾼다.';

create or replace function public.prevent_role_self_change()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  -- 앱 밖(SQL 편집기·서비스키)에서 들어온 복구 작업은 통과시킨다.
  if auth.uid() is null then
    return new;
  end if;
  if new.role is distinct from old.role and not public.is_superuser() then
    raise exception '역할 변경 권한이 없습니다 (최고관리자만 가능).';
  end if;
  if new.readonly is distinct from old.readonly and not public.is_superuser() then
    raise exception '쓰기잠금 변경 권한이 없습니다 (최고관리자만 가능).';
  end if;
  if new.sandbox is distinct from old.sandbox and not public.is_superuser() then
    raise exception '체험 계정 표시는 최고관리자만 바꿀 수 있습니다.';
  end if;
  return new;
end; $function$;

create or replace function public.is_sandbox() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select sandbox from public.profiles where id = auth.uid()), false);
$$;
create or replace function public.is_demo_engagement(eid uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select is_demo from public.dsd_engagement where id = eid), false);
$$;
create or replace function public.is_demo_entity(eid uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select is_demo from public.biz_entity where id = eid), false);
$$;
/** 저장소 경로(「books/<건>/…」·「<건>/…」)의 건이 시연용인가. */
create or replace function public.is_demo_path(p text) returns boolean
language plpgsql stable security definer set search_path to 'public' as $$
declare x text;
begin
  foreach x in array coalesce(storage.foldername(p), array[]::text[]) loop
    if x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return public.is_demo_engagement(x::uuid);
    end if;
  end loop;
  return false;
end; $$;
revoke execute on function public.is_sandbox(), public.is_demo_engagement(uuid), public.is_demo_entity(uuid), public.is_demo_path(text) from public, anon;
grant execute on function public.is_sandbox(), public.is_demo_engagement(uuid), public.is_demo_entity(uuid), public.is_demo_path(text) to authenticated;

do $$
declare t text;
  -- 작업 건(engagement_id)에 매인 감사업무 표 — 시연용 건만
  eng_tables text[] := array['dsd_note','dsd_note_book','engagement_file','gwp_book','gwp_paper','gwp_year','gwp_stage_event'];
  -- 본인 것이거나 기록(로그) — 체험 계정도 쓴다
  keep text[] := array['notifications','user_table_view','consult_usage','access_log','login_attempt'];
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop policy if exists sbx_insert on public.%I', t);
    execute format('drop policy if exists sbx_update on public.%I', t);
    execute format('drop policy if exists sbx_delete on public.%I', t);
    if t = any(keep) or t ~ '(_log$|audit)' then
      continue;
    elsif t = any(eng_tables) then
      execute format('create policy sbx_insert on public.%I as restrictive for insert with check (not public.is_sandbox() or public.is_demo_engagement(engagement_id))', t);
      execute format('create policy sbx_update on public.%I as restrictive for update using (not public.is_sandbox() or public.is_demo_engagement(engagement_id)) with check (not public.is_sandbox() or public.is_demo_engagement(engagement_id))', t);
      execute format('create policy sbx_delete on public.%I as restrictive for delete using (not public.is_sandbox() or public.is_demo_engagement(engagement_id))', t);
    elsif t = 'dsd_engagement' then
      execute 'create policy sbx_insert on public.dsd_engagement as restrictive for insert with check (not public.is_sandbox() or (is_demo and public.is_demo_entity(entity_id)))';
      execute 'create policy sbx_update on public.dsd_engagement as restrictive for update using (not public.is_sandbox() or is_demo) with check (not public.is_sandbox() or (is_demo and public.is_demo_entity(entity_id)))';
      execute 'create policy sbx_delete on public.dsd_engagement as restrictive for delete using (not public.is_sandbox() or is_demo)';
    elsif t = 'wtb_account_map' then
      execute 'create policy sbx_insert on public.wtb_account_map as restrictive for insert with check (not public.is_sandbox() or public.is_demo_entity(entity_id))';
      execute 'create policy sbx_update on public.wtb_account_map as restrictive for update using (not public.is_sandbox() or public.is_demo_entity(entity_id)) with check (not public.is_sandbox() or public.is_demo_entity(entity_id))';
      execute 'create policy sbx_delete on public.wtb_account_map as restrictive for delete using (not public.is_sandbox() or public.is_demo_entity(entity_id))';
    else
      execute format('create policy sbx_insert on public.%I as restrictive for insert with check (not public.is_sandbox())', t);
      execute format('create policy sbx_update on public.%I as restrictive for update using (not public.is_sandbox()) with check (not public.is_sandbox())', t);
      execute format('create policy sbx_delete on public.%I as restrictive for delete using (not public.is_sandbox())', t);
    end if;
  end loop;
end $$;

-- 파일 저장소 — 체험 계정은 시연용 건의 경로(gwp: books|files/<건>/…, dsd-notes: <건>/…)에만.
drop policy if exists sbx_insert on storage.objects;
drop policy if exists sbx_update on storage.objects;
drop policy if exists sbx_delete on storage.objects;
create policy sbx_insert on storage.objects as restrictive for insert
  with check (not public.is_sandbox() or (bucket_id in ('gwp', 'dsd-notes') and public.is_demo_path(name)));
create policy sbx_update on storage.objects as restrictive for update
  using (not public.is_sandbox() or (bucket_id in ('gwp', 'dsd-notes') and public.is_demo_path(name)))
  with check (not public.is_sandbox() or (bucket_id in ('gwp', 'dsd-notes') and public.is_demo_path(name)));
create policy sbx_delete on storage.objects as restrictive for delete
  using (not public.is_sandbox() or (bucket_id in ('gwp', 'dsd-notes') and public.is_demo_path(name)));
