-- 0009: 청구기록 담당자 ID 연결 — 이름 텍스트 → 계정(profiles.id) 견고화
-- 적용: Supabase SQL Editor 에서 실행

alter table public.billing_records
  add column if not exists manager_id uuid references public.profiles(id);

-- 기존 기록 백필: record.manager(이름)이 profiles.name 과 '유일하게' 일치할 때만 연결
update public.billing_records b
set manager_id = p.id
from public.profiles p
where b.manager_id is null
  and b.manager = p.name
  and (select count(*) from public.profiles p2 where p2.name = b.manager) = 1;
