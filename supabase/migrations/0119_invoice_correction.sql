-- 수정세금계산서((−)·(+))를 담을 자리.
--
-- 지금까지 우리 장부에는 (−)발행을 넣을 곳이 없었다. 그래서 ERP 가 (−)수정으로 지운 청구가
-- 우리 미수금에는 그대로 남았다(파인즈플래닝 2026-04·05·06 기장료 660,000).
--
-- 새 테이블을 만들지 않는다 — 수정발행도 발행이고, 미수금·매출통계·ERP 대사가 모두
-- biz_invoice_request 를 본다. 금액에 부호를 붙이고 status='수정발행' 으로 두면
-- 그 화면들이 이미 자연스럽게 더하고 뺀다. 여기서는 '무엇을 고친 것인가'만 덧붙인다.
alter table public.biz_invoice_request
  add column if not exists corrects_request_id uuid references public.biz_invoice_request(id) on delete set null,
  add column if not exists corrects_invoice_no text,
  add column if not exists correct_reason text;

create index if not exists biz_invoice_request_corrects_idx
  on public.biz_invoice_request (corrects_request_id);

comment on column public.biz_invoice_request.corrects_request_id is
  '고치는 원 발행요청. 원 건이 우리 장부에 없으면(기초미수금에 묻힌 건) 비워 두고 corrects_invoice_no 만 적는다.';
comment on column public.biz_invoice_request.corrects_invoice_no is
  '고치는 원 세금계산서/ERP 전표번호 — 원 건이 우리 장부에 없을 때의 실마리.';
comment on column public.biz_invoice_request.correct_reason is '수정 사유(계약 해지·금액 정정·크레딧 소멸 등).';
