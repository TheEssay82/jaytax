-- 상담진행의 거래처 선택이 옛 청구 거래처(clients, 74곳)만 보여 주던 자리.
--   거래처 정본은 거래처관리(biz_entity, 188곳)라, 상담기록도 거기에 잇는다.
--   client_id(→clients) 는 과거 기록 보존용으로 그대로 두고 새 기록은 entity_id 로 잇는다.
--   거래처를 지워도 기록이 '누구 것'이었는지 잃지 않게 RESTRICT(0135 와 같은 원칙).
alter table public.consultations
  add column if not exists entity_id uuid references public.biz_entity (id) on delete restrict;

create index if not exists idx_consultations_entity on public.consultations (entity_id);

-- 과거 기록 백필: clients 가 거래처관리에 연결돼 있으면 그 거래처로.
update public.consultations c
   set entity_id = cl.entity_id
  from public.clients cl
 where c.client_id = cl.id
   and cl.entity_id is not null
   and c.entity_id is null;
