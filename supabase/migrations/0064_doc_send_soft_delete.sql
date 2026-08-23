-- 0064: 문서발송요청 소프트삭제(휴지통). 삭제 대신 deleted_at 표시 → 복원 가능.
--   목록 조회는 deleted_at is null 만. 영구삭제(행 제거+첨부정리)는 휴지통에서만.
--   가드 트리거(doc_send_process_guard)는 status/sent_date/tracking_no/status_note만 검사하므로 deleted_at 변경엔 영향 없음.
alter table public.doc_send_requests add column if not exists deleted_at timestamptz;
create index if not exists doc_send_deleted_idx on public.doc_send_requests(deleted_at);
