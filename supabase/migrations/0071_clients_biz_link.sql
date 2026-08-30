-- 0071: 거래처 마스터 단일화 2단계 — 세무조정수수료 clients 를 거래처관리(biz_*)에 연결
--
-- 배경: 세무조정수수료관리 › 거래처 관리 탭이 자체 등록/삭제/엑셀 업로드를 갖고 있어
--       거래처관리와 등록 창구가 이원화돼 있었다. 0070(문서발송)에 이어 청구 도메인도 정리한다.
-- 방식: clients 는 billing_records/billing_targets/consultations FK 가 매달려 있어 그대로 두고,
--       거래처관리 사업장(biz_place)과의 연결 컬럼만 추가한다.
--       · 신규는 '거래처관리에서 가져오기'로만 생성(자동 동기화는 하지 않는다 —
--         거래처명이 바뀌면 과거 청구서 표기까지 흔들리므로 가져올 때 한 번만 복사)
--       · 등록/삭제/엑셀 UI 는 프런트에서 제거

alter table public.clients
  add column if not exists entity_id uuid references public.biz_entity(id) on delete set null,
  add column if not exists place_id  uuid references public.biz_place(id)  on delete set null;

create unique index if not exists clients_place_uk
  on public.clients(place_id) where place_id is not null;
create index if not exists clients_entity_idx on public.clients(entity_id);

-- 백필: 사업자번호(숫자만) 1:1 일치 건 연결 — 74건 중 71건
with m as (
  select c.id as cid, p.id as pid, p.entity_id as eid
    from public.clients c
    join public.biz_place p
      on regexp_replace(coalesce(p.biz_reg_no, ''), '\D', '', 'g') = regexp_replace(coalesce(c.tax_id, ''), '\D', '', 'g')
     and regexp_replace(coalesce(c.tax_id, ''), '\D', '', 'g') <> ''
   where c.place_id is null
), uniq as (
  select cid, (array_agg(pid order by pid))[1] as pid, (array_agg(eid order by pid))[1] as eid
    from m group by cid having count(*) = 1
)
update public.clients c
   set place_id = u.pid, entity_id = u.eid
  from uniq u
 where c.id = u.cid
   and not exists (select 1 from public.clients x where x.place_id = u.pid);
