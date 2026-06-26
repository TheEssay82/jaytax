-- 0004: 업데이트요청 게시판 — 댓글 컬럼 추가
-- update_requests.comments(jsonb) = [{id, author, text, createdAt}, ...]
alter table public.update_requests
  add column if not exists comments jsonb not null default '[]'::jsonb;
