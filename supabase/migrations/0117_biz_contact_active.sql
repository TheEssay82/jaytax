-- 거래처담당자가 이직·퇴사하면 그 연락처는 더 이상 유효하지 않다.
--
-- 지우면 안 된다 — 지난 문서발송·세금계산서가 그 사람 앞으로 나간 기록이고,
-- 나중에 "누구에게 보냈었나"를 되짚을 일이 생긴다. 그래서 **접어 두기만** 한다.
-- 접힌 담당자는 목록에서 기본으로 숨고, 이메일 자동선택(세금계산서 수신 등)에서 빠진다.
alter table public.biz_contact
  add column if not exists active     boolean not null default true,
  add column if not exists left_at    date,
  add column if not exists left_note  text;

create index if not exists biz_contact_active_idx on public.biz_contact (entity_id) where active;

comment on column public.biz_contact.active is
  '유효한 담당자인가. false = 이직·퇴사 등으로 더 이상 쓰지 않는 연락처(기록은 남긴다).';
comment on column public.biz_contact.left_at is '더 이상 유효하지 않게 된 날(확인한 날).';
comment on column public.biz_contact.left_note is '사유 — 퇴사·이직·담당변경 등.';
