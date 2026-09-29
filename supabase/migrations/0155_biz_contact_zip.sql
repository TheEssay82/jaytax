-- 0155 거래처담당자 우편번호 — 우체국 「우편 업로드 양식」(받는 분·우편번호·주소·상세주소·일반전화·휴대전화)으로 내려받기.
-- 사용자 2026-09-29: 「문서발송관리와 연계하여 우체국업무시 첨부양식으로 발송정보를 내려받을 수 있게」.
-- 담당자 주소(biz_contact.address)는 한 칸이라 우편번호가 없다(154건 중 1건). 우편번호만 따로 둔다 — 주소·상세주소는 내려받을 때 나눈다.
alter table public.biz_contact add column if not exists zip_code text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'biz_contact_zip_code_chk') then
    alter table public.biz_contact add constraint biz_contact_zip_code_chk check (zip_code is null or zip_code ~ '^\d{5}$');
  end if;
end $$;

comment on column public.biz_contact.zip_code is '우편번호(5자리) — 우체국 우편 업로드 양식(0155)';
