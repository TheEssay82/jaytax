-- 0023: 상담기록 거래처 연결
-- 상담진행에 필수 '구분'(일반/거래처)을 추가한다. '거래처'면 거래처관리(clients)에서
-- 거래처를 선택해 연결하고, 상담기록을 거래처명으로도 관리·필터할 수 있게 한다.
--  - client_type: 'general'(일반) | 'client'(거래처). 기존 데이터 호환 위해 default 'general'.
--  - client_id  : clients(id) 참조. 거래처 삭제 시 링크만 끊고(set null) 기록은 남긴다.
--  - client_name: 저장 시점의 거래처명 스냅샷(거래처 삭제·개명 후에도 이력 표시·검색용).

alter table public.consultations
  add column if not exists client_type text not null default 'general'
    check (client_type in ('general', 'client')),
  add column if not exists client_id uuid references public.clients (id) on delete set null,
  add column if not exists client_name text;

create index if not exists idx_consultations_client on public.consultations (client_id);
