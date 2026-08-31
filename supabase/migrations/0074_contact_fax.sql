-- 0074: 거래처담당자에 팩스번호 추가
--
-- 기장팀 '거래처 연락처' 엑셀에는 팩스번호 열이 있는데 biz_contact 에 담을 곳이 없어
-- 적재 때 버려야 했다. 세무서 제출물 등 팩스로 주고받는 일이 남아 있어 필드를 만든다.
-- (사업장 주소는 담당자 수령지와 성격이 달라 biz_place.address 로 따로 넣는다.)

alter table public.biz_contact
  add column if not exists fax text;

comment on column public.biz_contact.fax is '팩스번호';
