-- 0015: 상담기록 키워드 해시태그
-- 상담 저장 시 주요 키워드를 태그로 분류·검색한다. consult 함수가 회신과 함께 tags를 생성하고
-- 프런트에서 편집 후 저장한다. 목록/상세에서 #태그 칩 표시·필터에 사용.
alter table public.consultations
  add column if not exists tags text[] not null default '{}';

-- 태그 교집합/포함 검색용 GIN 인덱스
create index if not exists idx_consultations_tags on public.consultations using gin (tags);
