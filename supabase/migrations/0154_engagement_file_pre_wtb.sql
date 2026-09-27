-- 0154 자료함 — 「정산표(기말감사 수정전)」 종류를 더한다.
--
-- 사용자 2026-09-27: 2차 확정(중간감사 후)의 중요성(2700A-3)은 「기말감사 전 숫자 — 기말감사 때 받은 정산표의 수정전 금액」.
-- 3차(2700A-4·8110ARP)는 확정 정산표의 수정후 금액. 같은 정산표라도 받는 때가 달라 따로 둔다.
alter table public.engagement_file drop constraint if exists engagement_file_kind_check;
alter table public.engagement_file
  add constraint engagement_file_kind_check check (kind in ('전기DSD', '당기DSD', '수정전정산표', '정산표'));
comment on column public.engagement_file.kind is
  '전기DSD(1차 — 2120A·2301·2700A-2) · 수정전정산표(2차 — 기말감사 때 받은 정산표, 2700A-3) · 정산표(3차 — 확정 정산표, 2700A-4·8110ARP) · 당기DSD';
