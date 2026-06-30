-- 0014: 상담기록 (회계·세무 상담 회신 초안 저장)
-- 상담진행에서 생성한 회신 초안 + 사용한 근거를 저장하고, 상담기록에서 조회한다.
-- 직원 4명이 공유하는 상담 이력. 인증 직원은 모두 읽기, 작성/수정은 본인 것만.

create table if not exists public.consultations (
  id           uuid primary key default gen_random_uuid(),
  author_id    uuid not null default auth.uid() references auth.users (id) on delete set null,
  author_email text,

  title        text not null default '',   -- 상담 제목(쟁점 한 줄)
  question     text not null,              -- 직원이 올린 질문/사실관계
  answer_md    text not null default '',   -- 생성·편집된 회신 초안(마크다운)
  citations    jsonb not null default '[]'::jsonb, -- 사용한 근거(회계기준 문단 + 세법 조문 등)
  llm_model    text,                       -- 작성에 쓴 모델(예: claude-sonnet-4-6)
  status       text not null default 'draft', -- 'draft' | 'final'

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_consultations_created on public.consultations (created_at desc);
create index if not exists idx_consultations_author on public.consultations (author_id);

create trigger trg_consultations_updated
  before update on public.consultations
  for each row execute function public.set_updated_at();

-- RLS: 인증 직원은 전체 열람(공유 이력), 작성은 본인 명의, 수정/삭제는 본인 것만.
alter table public.consultations enable row level security;

create policy consultations_sel on public.consultations
  for select to authenticated using (true);

create policy consultations_ins on public.consultations
  for insert to authenticated with check (author_id = auth.uid());

create policy consultations_upd on public.consultations
  for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());

create policy consultations_del on public.consultations
  for delete to authenticated using (author_id = auth.uid());