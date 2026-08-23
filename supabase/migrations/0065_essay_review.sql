-- 0065: 습작(에세이) 열람·평점 — 비로그인 공개 페이지(/essay)와 숨김 관리화면(/essay/admin).
--   개인적/한시적 용도. 철회 시 rollback/0065_essay_review_down.sql 로 전체 제거.
--   보안 모델: anon 은 테이블에 직접 접근하지 못하고, SECURITY DEFINER RPC 4개로만 동작한다.
--     essay_register(이름등록) / essay_state(진행상태) / essay_next(다음 작품) / essay_rate(별점확정)
--   관리(업로드·삭제·집계)는 authenticated + is_superuser() 로만.

-- ── 작품 ────────────────────────────────────────────────────────────────
create table if not exists public.essay_piece (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,                                   -- 문단 구분 = 빈 줄(\n\n)
  bg_key      text not null default 'hanji',                    -- 배경 프리셋 키(프론트 essayTheme.tsx)
  bg_path     text,                                             -- 커스텀 배경 이미지(storage: essay-bg). 있으면 프리셋보다 우선
  font_key    text not null default 'serif',                    -- 본문 서체 프리셋
  status      text not null default 'draft' check (status in ('draft','published')),
  sort_order  int  not null default 0,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists essay_piece_status_idx on public.essay_piece(status);

-- ── 독자(이름 중복 불가) ─────────────────────────────────────────────────
create table if not exists public.essay_reader (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,                                   -- 표시용 원본
  name_key     text not null unique,                            -- 중복판정 키(공백제거·소문자)
  token        uuid not null unique default gen_random_uuid(),  -- 기기 기억용(localStorage)
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- ── 평점(독자×작품 1건) ──────────────────────────────────────────────────
create table if not exists public.essay_rating (
  id         uuid primary key default gen_random_uuid(),
  reader_id  uuid not null references public.essay_reader(id) on delete cascade,
  piece_id   uuid not null references public.essay_piece(id)  on delete cascade,
  stars      int  not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  unique (reader_id, piece_id)
);
create index if not exists essay_rating_piece_idx on public.essay_rating(piece_id);

-- ── RLS: anon 직접접근 전면 차단, 관리자(superuser)만 테이블 접근 ────────
alter table public.essay_piece  enable row level security;
alter table public.essay_reader enable row level security;
alter table public.essay_rating enable row level security;

drop policy if exists essay_piece_admin on public.essay_piece;
create policy essay_piece_admin on public.essay_piece for all to authenticated
  using (public.is_superuser()) with check (public.is_superuser());

drop policy if exists essay_reader_admin on public.essay_reader;
create policy essay_reader_admin on public.essay_reader for select to authenticated
  using (public.is_superuser());

drop policy if exists essay_rating_admin on public.essay_rating;
create policy essay_rating_admin on public.essay_rating for select to authenticated
  using (public.is_superuser());

-- created_by 자동
create or replace function public.essay_set_created_by()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is null then new.created_by := auth.uid(); end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_essay_piece_bi on public.essay_piece;
create trigger trg_essay_piece_bi before insert or update on public.essay_piece
  for each row execute function public.essay_set_created_by();

-- ── 공개 RPC ────────────────────────────────────────────────────────────
-- 이름 정규화: 앞뒤공백 제거 + 내부공백 제거 + 소문자
create or replace function public.essay_name_key(p_name text)
returns text language sql immutable as $$
  select lower(regexp_replace(coalesce(p_name, ''), '\s+', '', 'g'));
$$;

-- 1) 이름 등록 → 기기 토큰 발급. 중복이름은 거절(에러코드 ESSAY_DUP).
create or replace function public.essay_register(p_name text)
returns json language plpgsql security definer set search_path = public as $$
declare v_name text; v_key text; v_token uuid;
begin
  v_name := btrim(coalesce(p_name, ''));
  if char_length(v_name) < 1 or char_length(v_name) > 20 then
    raise exception '이름은 1~20자로 입력해 주세요.' using errcode = 'P0001';
  end if;
  v_key := public.essay_name_key(v_name);
  if v_key = '' then
    raise exception '이름을 입력해 주세요.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.essay_reader where name_key = v_key) then
    raise exception 'ESSAY_DUP' using errcode = 'P0001';
  end if;
  insert into public.essay_reader(name, name_key) values (v_name, v_key)
    returning token into v_token;
  return json_build_object('token', v_token, 'name', v_name);
end $$;

-- 2) 진행상태(재방문 복원용)
create or replace function public.essay_state(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_reader public.essay_reader; v_total int; v_rated int;
begin
  select * into v_reader from public.essay_reader where token = p_token;
  if not found then return null; end if;
  update public.essay_reader set last_seen_at = now() where id = v_reader.id;
  select count(*) into v_total from public.essay_piece where status = 'published';
  select count(*) into v_rated from public.essay_rating r
    join public.essay_piece p on p.id = r.piece_id and p.status = 'published'
   where r.reader_id = v_reader.id;
  return json_build_object('name', v_reader.name, 'total', v_total, 'rated', v_rated);
end $$;

-- 3) 아직 평가하지 않은 작품 1편(랜덤). 없으면 null.
create or replace function public.essay_next(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_reader_id uuid; v_piece public.essay_piece; v_total int; v_rated int;
begin
  select id into v_reader_id from public.essay_reader where token = p_token;
  if v_reader_id is null then
    raise exception 'ESSAY_NOREADER' using errcode = 'P0001';
  end if;
  select count(*) into v_total from public.essay_piece where status = 'published';
  select count(*) into v_rated from public.essay_rating r
    join public.essay_piece p on p.id = r.piece_id and p.status = 'published'
   where r.reader_id = v_reader_id;
  select p.* into v_piece from public.essay_piece p
   where p.status = 'published'
     and not exists (select 1 from public.essay_rating r
                      where r.piece_id = p.id and r.reader_id = v_reader_id)
   order by random() limit 1;
  if not found then
    return json_build_object('done', true, 'total', v_total, 'rated', v_rated);
  end if;
  return json_build_object(
    'done', false, 'total', v_total, 'rated', v_rated,
    'piece', json_build_object(
      'id', v_piece.id, 'title', v_piece.title, 'body', v_piece.body,
      'bgKey', v_piece.bg_key, 'bgPath', v_piece.bg_path, 'fontKey', v_piece.font_key)
  );
end $$;

-- 4) 별점 확정(재확정 시 덮어씀)
create or replace function public.essay_rate(p_token uuid, p_piece uuid, p_stars int)
returns json language plpgsql security definer set search_path = public as $$
declare v_reader_id uuid;
begin
  select id into v_reader_id from public.essay_reader where token = p_token;
  if v_reader_id is null then
    raise exception 'ESSAY_NOREADER' using errcode = 'P0001';
  end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then
    raise exception '별점은 1~5 사이여야 합니다.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.essay_piece where id = p_piece and status = 'published') then
    raise exception '작품을 찾을 수 없습니다.' using errcode = 'P0001';
  end if;
  insert into public.essay_rating(reader_id, piece_id, stars)
  values (v_reader_id, p_piece, p_stars)
  on conflict (reader_id, piece_id) do update set stars = excluded.stars;
  return public.essay_next(p_token);
end $$;

revoke all on function public.essay_register(text)          from public;
revoke all on function public.essay_state(uuid)             from public;
revoke all on function public.essay_next(uuid)              from public;
revoke all on function public.essay_rate(uuid, uuid, int)   from public;
grant execute on function public.essay_register(text)        to anon, authenticated;
grant execute on function public.essay_state(uuid)           to anon, authenticated;
grant execute on function public.essay_next(uuid)            to anon, authenticated;
grant execute on function public.essay_rate(uuid, uuid, int) to anon, authenticated;

-- ── 관리자 집계(작품별 평균·표본수) ──────────────────────────────────────
create or replace function public.essay_scoreboard()
returns table (piece_id uuid, title text, status text, votes int, avg_stars numeric, created_at timestamptz)
language sql security definer set search_path = public stable as $$
  select p.id, p.title, p.status,
         count(r.id)::int,
         round(coalesce(avg(r.stars), 0)::numeric, 2),
         p.created_at
    from public.essay_piece p
    left join public.essay_rating r on r.piece_id = p.id
   where public.is_superuser()
   group by p.id
   order by round(coalesce(avg(r.stars), 0)::numeric, 2) desc, count(r.id) desc, p.created_at;
$$;
revoke all on function public.essay_scoreboard() from public;
grant execute on function public.essay_scoreboard() to authenticated;

-- ── 배경 이미지 버킷(공개 읽기, 업로드는 superuser) ───────────────────────
insert into storage.buckets (id, name, public)
values ('essay-bg', 'essay-bg', true)
on conflict (id) do update set public = true;

drop policy if exists essay_bg_read on storage.objects;
create policy essay_bg_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'essay-bg');
drop policy if exists essay_bg_write on storage.objects;
create policy essay_bg_write on storage.objects for insert to authenticated
  with check (bucket_id = 'essay-bg' and public.is_superuser());
drop policy if exists essay_bg_delete on storage.objects;
create policy essay_bg_delete on storage.objects for delete to authenticated
  using (bucket_id = 'essay-bg' and public.is_superuser());
