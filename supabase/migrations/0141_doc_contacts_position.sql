-- 문서 수신자 이름에 **직책이 빠져 있던 것**
--
-- 증상: 거래처담당자에 직책을 적어도 문서발송 수신자명이 「성명 + 호칭」으로만 나온다.
--
-- 원인: 직책(position)은 거래처관리 쪽 `biz_contact` 에만 있고, 문서발송이 쓰는
--       `doc_contacts` 에는 그 칸이 아예 없다. 그래서 직책이 건너오지 못했다.
--
-- 실태(2026-09-11 실측): 거래처담당자 204건의 호칭 칸은 「님」107 · **직책명 92** · 빈칸 5.
-- 36가지 값이 전부 「님」이거나 직책명이거나 「직책+님」이고 「귀하」·「귀중」은 하나도 없다.
-- 즉 **호칭 칸이 이미 직함 칸 노릇을 하고 있다.** 직책 칸은 55건뿐인데 그중 45건은 호칭이
-- 「님」이라 겹치지 않는다 — 실제 충돌은 8건.
--
-- 그래서 **자료를 고치지 않는다.** 두 칸을 「직함 하나」로 보는 규칙(`lib/honorific.ts`
-- `pickTitle`)이 있는 그대로를 흡수한다. 여기서는 직책이 건너올 **길만** 놓는다.

alter table public.doc_contacts add column if not exists position text;

-- 거래처담당자와 연결된 것(239건 중 228건)에서 직책을 가져온다.
-- 이미 적어 둔 것이 있으면 건드리지 않는다.
update public.doc_contacts d
set position = b.position
from public.biz_contact b
where d.biz_contact_id = b.id
  and coalesce(b.position, '') <> ''
  and coalesce(d.position, '') = '';

comment on column public.doc_contacts.position is
  '직책(과장·팀장…). 수신자명은 honorific 과 합쳐 「성명 + 직함 + 님」으로 만든다 — lib/honorific.ts pickTitle 참고.';

-- 앞으로도 따라오게 — 거래처담당자 → 문서담당자 동기화(0070)에 직책을 싣는다.
-- 나머지는 0070 그대로이고 position 만 더했다.
create or replace function public.biz_alias_sync_contact(p_contact uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c        record;
  v_client uuid;
  v_id     uuid;
begin
  select * into c from public.biz_contact where id = p_contact;
  if not found then return null; end if;
  v_client := public.biz_alias_sync_entity(c.entity_id);
  if v_client is null then return null; end if;

  select id into v_id from public.doc_contacts where biz_contact_id = p_contact;
  if v_id is null then
    insert into public.doc_contacts(client_id, contact_name, honorific, position, phone, email, address, note, biz_contact_id)
      values (v_client, c.contact_name, coalesce(nullif(c.honorific, ''), '님'), c.position,
              c.phone, c.email, c.address, c.note, p_contact)
      returning id into v_id;
  else
    update public.doc_contacts
       set client_id    = v_client,
           contact_name = c.contact_name,
           honorific    = coalesce(nullif(c.honorific, ''), '님'),
           position     = c.position,
           phone        = c.phone,
           email        = c.email,
           address      = c.address,
           note         = c.note
     where id = v_id;
  end if;
  return v_id;
end $$;
