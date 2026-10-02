-- 0163 자료함 — 「이월 정산표」 종류를 더한다.
--
-- 사용자 2026-10-03: 정산표 이월(작년 확정 정산표 + 회사 시산표 → 올해 중간감사 정산표)을 일반조서 화면에 붙인다.
-- 만든 정산표를 작업 건에 남겨 두고 다시 내려받는다(같은 종류를 다시 만들면 줄이 늘고 최신 것을 쓴다).
alter table public.engagement_file drop constraint if exists engagement_file_kind_check;
alter table public.engagement_file
  add constraint engagement_file_kind_check check (kind in ('전기DSD', '당기DSD', '수정전정산표', '정산표', '이월정산표'));
comment on column public.engagement_file.kind is
  '전기DSD(1차 — 2120A·2301·2700A-2) · 수정전정산표(2차 — 기말감사 때 받은 정산표, 2700A-3) · 정산표(3차 — 확정 정산표, 2700A-4·8110ARP) · 당기DSD · 이월정산표(정산표 이월로 만든 올해 정산표)';
