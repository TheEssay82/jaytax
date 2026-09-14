-- 0146 주석·DSD 관리 — 엑셀 **시트 구성**을 작업 건에 둔다
--
-- 왜 필요한가: 주석 서식 엑셀을 「주석마다 시트 한 장」으로만 떴다. 내부 의견으로 「한 시트에
-- 주석을 세로로 내리는 종단형」이 나왔고, **처음 만들 때 고르자**는 의견이 붙었다(2026-09-14).
--
-- 왜 작업 건에 두는가: ② 가 뜬 시트 이름·칸 주소를 ③ 이 다시 지어 대 보고 ④ 가 또 지어 도로
-- 넣는다. 셋이 각자 고르면 온통 못 찾았다고 나온다. 「여분 행」처럼 한곳에서 정한다.

alter table public.dsd_engagement
  add column if not exists sheet_layout text not null default 'sheets'
  check (sheet_layout in ('sheets', 'long'));

comment on column public.dsd_engagement.sheet_layout is
  '주석 서식 엑셀의 시트 구성 — sheets(주석별 시트) · long(한 시트 종단형). ②③④ 가 함께 읽는다.';
