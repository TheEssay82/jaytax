-- 0067: 습작 평가를 '작품별 별점' → '전체를 읽은 뒤 매기는 순위'로 개편.
--   독자는 모든 공개작을 한 편씩 읽고(essay_read), 마지막에 전편을 한 화면에서 1~N위로 배열해
--   확정한다(essay_ranking). 한 줄 평(essay_reader.comment)도 함께 받는다.
--   평가 지표는 '평균 순위'(낮을수록 좋음)이며, 관리화면에서 평가자별 순위표까지 본다.
--   별점(essay_rating)은 폐기한다.

-- ── 읽음 표시 ────────────────────────────────────────────────────────────
create table if not exists public.essay_read (
  reader_id uuid not null references public.essay_reader(id) on delete cascade,
  piece_id  uuid not null references public.essay_piece(id)  on delete cascade,
  read_at   timestamptz not null default now(),
  primary key (reader_id, piece_id)
);

-- ── 최종 순위(독자 1명이 작품마다 1~N 을 한 번씩) ────────────────────────
create table if not exists public.essay_ranking (
  reader_id  uuid not null references public.essay_reader(id) on delete cascade,
  piece_id   uuid not null references public.essay_piece(id)  on delete cascade,
  rank       int  not null check (rank >= 1),
  created_at timestamptz not null default now(),
  primary key (reader_id, piece_id),
  unique (reader_id, rank)
);
create index if not exists essay_ranking_piece_idx on public.essay_ranking(piece_id);

-- 한 줄 평 + 제출 시각
alter table public.essay_reader add column if not exists comment text;
alter table public.essay_reader add column if not exists submitted_at timestamptz;

-- 별점 폐기
drop function if exists public.essay_rate(uuid, uuid, int);
drop function if exists public.essay_scoreboard();
drop table if exists public.essay_rating;

-- ── RLS: anon 직접접근 차단, 관리자(superuser)만 조회 ────────────────────
alter table public.essay_read    enable row level security;
alter table public.essay_ranking enable row level security;

drop policy if exists essay_read_admin on public.essay_read;
create policy essay_read_admin on public.essay_read for select to authenticated
  using (public.is_superuser());

drop policy if exists essay_ranking_admin on public.essay_ranking;
create policy essay_ranking_admin on public.essay_ranking for select to authenticated
  using (public.is_superuser());

-- ── 공개 RPC ────────────────────────────────────────────────────────────
-- 진행상태: 읽은 편수 / 전체 / 순위 제출 여부
create or replace function public.essay_state(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_reader public.essay_reader; v_total int; v_read int;
begin
  select * into v_reader from public.essay_reader where token = p_token;
  if not found then return null; end if;
  update public.essay_reader set last_seen_at = now() where id = v_reader.id;
  select count(*) into v_total from public.essay_piece where status = 'published';
  select count(*) into v_read from public.essay_read r
    join public.essay_piece p on p.id = r.piece_id and p.status = 'published'
   where r.reader_id = v_reader.id;
  return json_build_object(
    'name', v_reader.name, 'total', v_total, 'read', v_read,
    'submitted', v_reader.submitted_at is not null,
    'comment', coalesce(v_reader.comment, ''));
end $$;

-- 아직 안 읽은 작품 1편(랜덤). 다 읽었으면 done=true → 순위 화면으로.
create or replace function public.essay_next(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_reader_id uuid; v_piece public.essay_piece; v_total int; v_read int;
begin
  select id into v_reader_id from public.essay_reader where token = p_token;
  if v_reader_id is null then
    raise exception 'ESSAY_NOREADER' using errcode = 'P0001';
  end if;
  select count(*) into v_total from public.essay_piece where status = 'published';
  select count(*) into v_read from public.essay_read r
    join public.essay_piece p on p.id = r.piece_id and p.status = 'published'
   where r.reader_id = v_reader_id;
  select p.* into v_piece from public.essay_piece p
   where p.status = 'published'
     and not exists (select 1 from public.essay_read r
                      where r.piece_id = p.id and r.reader_id = v_reader_id)
   order by random() limit 1;
  if not found then
    return json_build_object('done', true, 'total', v_total, 'read', v_read);
  end if;
  return json_build_object(
    'done', false, 'total', v_total, 'read', v_read,
    'piece', json_build_object(
      'id', v_piece.id, 'title', v_piece.title, 'body', v_piece.body,
      'bgKey', v_piece.bg_key, 'bgPath', v_piece.bg_path, 'fontKey', v_piece.font_key)
  );
end $$;

-- 한 편 다 읽음 → 다음 편을 돌려준다
create or replace function public.essay_mark_read(p_token uuid, p_piece uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_reader_id uuid;
begin
  select id into v_reader_id from public.essay_reader where token = p_token;
  if v_reader_id is null then
    raise exception 'ESSAY_NOREADER' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.essay_piece where id = p_piece and status = 'published') then
    raise exception '작품을 찾을 수 없습니다.' using errcode = 'P0001';
  end if;
  insert into public.essay_read(reader_id, piece_id) values (v_reader_id, p_piece)
  on conflict (reader_id, piece_id) do nothing;
  return public.essay_next(p_token);
end $$;

-- 순위 화면에 쓸 전체 공개작(다시 읽기용 본문 포함) + 내가 이미 낸 순위
create or replace function public.essay_ranking_sheet(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_reader public.essay_reader;
begin
  select * into v_reader from public.essay_reader where token = p_token;
  if not found then
    raise exception 'ESSAY_NOREADER' using errcode = 'P0001';
  end if;
  return json_build_object(
    'name', v_reader.name,
    'comment', coalesce(v_reader.comment, ''),
    'submitted', v_reader.submitted_at is not null,
    'pieces', coalesce((
      select json_agg(json_build_object(
               'id', p.id, 'title', p.title, 'body', p.body,
               'bgKey', p.bg_key, 'bgPath', p.bg_path, 'fontKey', p.font_key)
               order by p.created_at)
        from public.essay_piece p where p.status = 'published'), '[]'::json),
    'myOrder', coalesce((
      select json_agg(g.piece_id order by g.rank)
        from public.essay_ranking g where g.reader_id = v_reader.id), '[]'::json)
  );
end $$;

-- 순위 확정. p_order 는 1위부터 나열한 작품 id 배열. 다시 내면 이전 것을 대체한다.
create or replace function public.essay_submit_ranking(p_token uuid, p_order uuid[], p_comment text)
returns json language plpgsql security definer set search_path = public as $$
declare v_reader_id uuid; v_total int; i int;
begin
  select id into v_reader_id from public.essay_reader where token = p_token;
  if v_reader_id is null then
    raise exception 'ESSAY_NOREADER' using errcode = 'P0001';
  end if;
  select count(*) into v_total from public.essay_piece where status = 'published';

  -- 공개작 전부가 한 번씩 들어 있어야 한다(중복·누락·비공개작 방지)
  if p_order is null or array_length(p_order, 1) is distinct from v_total
     or (select count(distinct x) from unnest(p_order) x) <> v_total
     or exists (select 1 from unnest(p_order) x
                 where not exists (select 1 from public.essay_piece p
                                    where p.id = x and p.status = 'published'))
  then
    raise exception 'ESSAY_BADORDER' using errcode = 'P0001';
  end if;

  delete from public.essay_ranking where reader_id = v_reader_id;
  for i in 1 .. array_length(p_order, 1) loop
    insert into public.essay_ranking(reader_id, piece_id, rank) values (v_reader_id, p_order[i], i);
    -- 순위를 냈다면 읽은 것으로 본다(중간에 이탈했다 돌아온 경우 보정)
    insert into public.essay_read(reader_id, piece_id) values (v_reader_id, p_order[i])
    on conflict (reader_id, piece_id) do nothing;
  end loop;

  update public.essay_reader
     set comment = nullif(btrim(coalesce(p_comment, '')), ''),
         submitted_at = now()
   where id = v_reader_id;

  return json_build_object('ok', true, 'total', v_total);
end $$;

revoke all on function public.essay_mark_read(uuid, uuid)                 from public;
revoke all on function public.essay_ranking_sheet(uuid)                   from public;
revoke all on function public.essay_submit_ranking(uuid, uuid[], text)    from public;
grant execute on function public.essay_mark_read(uuid, uuid)              to anon, authenticated;
grant execute on function public.essay_ranking_sheet(uuid)                to anon, authenticated;
grant execute on function public.essay_submit_ranking(uuid, uuid[], text) to anon, authenticated;
