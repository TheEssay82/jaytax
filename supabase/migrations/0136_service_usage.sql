-- 외부 서비스(Supabase) 사용량을 앱에서 볼 수 있게 한다.
-- 요금제 한도에 다가가면 미리 알아야 갑자기 막히지 않는다.
-- 2026-09-04 기준 DB 220MB / 무료 한도 500MB — 이미 44% 다.
-- 그중 179MB 가 standard_fulltext(회계기준 전문) 하나이고, 아직 채울 기준서가 남아 있다.
--
-- 최고관리자만 본다 — 계정 수·용량은 운영 정보다.

create or replace function public.service_usage()
returns table (key text, label text, bytes bigint, items bigint)
language sql stable security definer set search_path to 'public'
as $function$
  select 'db'::text, '데이터베이스'::text,
         pg_database_size(current_database())::bigint, null::bigint
   where public.is_superuser()
  union all
  select 'storage', '파일 저장소',
         (select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o),
         (select count(*) from storage.objects o)
   where public.is_superuser()
  union all
  select 'users', '가입 계정', null::bigint,
         (select count(*) from auth.users)
   where public.is_superuser();
$function$;

-- 무엇이 자리를 차지하는지 — 줄여야 할 때 어디를 볼지 알려 준다.
create or replace function public.service_usage_tables(p_limit int default 8)
returns table (name text, bytes bigint, rows_est bigint)
language sql stable security definer set search_path to 'public'
as $function$
  select (n.nspname || '.' || c.relname)::text,
         pg_total_relation_size(c.oid)::bigint,
         c.reltuples::bigint
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'r'
     and n.nspname in ('public', 'storage', 'auth')
     and public.is_superuser()
   order by pg_total_relation_size(c.oid) desc
   limit greatest(p_limit, 1);
$function$;

-- 버킷별 파일 용량 — 저장소를 줄일 때 어디를 볼지.
create or replace function public.service_usage_buckets()
returns table (name text, bytes bigint, items bigint)
language sql stable security definer set search_path to 'public'
as $function$
  select b.name::text,
         coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint,
         count(o.id)::bigint
    from storage.buckets b
    left join storage.objects o on o.bucket_id = b.id
   where public.is_superuser()
   group by b.name
   order by 2 desc;
$function$;

revoke all on function public.service_usage()            from public, anon;
revoke all on function public.service_usage_tables(int)  from public, anon;
revoke all on function public.service_usage_buckets()    from public, anon;
grant execute on function public.service_usage()           to authenticated;
grant execute on function public.service_usage_tables(int) to authenticated;
grant execute on function public.service_usage_buckets()   to authenticated;
