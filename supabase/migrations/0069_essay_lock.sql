-- 0069: 순위를 확정한 독자를 일정 시간 뒤 '잠금' 처리한다.
--   목적: 평가를 마친 사람의 접속을 언제까지고 열어두지 않는다.
--   주의: 토큰을 무효화해 이름 입력 화면으로 되돌리면, 같은 사람이 다른 이름으로
--   재등록해 이중 집계될 수 있다. 그래서 신원은 계속 알아보되 수정·재열람만 막는다.
--   기간 변경은 essay_lock_hours() 하나만 고치면 된다.

create or replace function public.essay_lock_hours()
returns int language sql immutable as $$ select 24 $$;

-- 진행상태에 locked 추가
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
    'locked', v_reader.submitted_at is not null
              and now() > v_reader.submitted_at + make_interval(hours => public.essay_lock_hours()),
    'comment', coalesce(v_reader.comment, ''));
end $$;

-- 순위표에도 locked 를 실어 보낸다(잠긴 사람에게는 확정 화면 대신 마감 안내를 띄운다)
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
    'locked', v_reader.submitted_at is not null
              and now() > v_reader.submitted_at + make_interval(hours => public.essay_lock_hours()),
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

-- 잠긴 뒤에는 순위를 바꿀 수 없다(서버에서도 막는다)
create or replace function public.essay_submit_ranking(p_token uuid, p_order uuid[], p_comment text)
returns json language plpgsql security definer set search_path = public as $$
declare v_reader public.essay_reader; v_total int; i int;
begin
  select * into v_reader from public.essay_reader where token = p_token;
  if not found then
    raise exception 'ESSAY_NOREADER' using errcode = 'P0001';
  end if;
  if v_reader.submitted_at is not null
     and now() > v_reader.submitted_at + make_interval(hours => public.essay_lock_hours()) then
    raise exception 'ESSAY_LOCKED' using errcode = 'P0001';
  end if;

  select count(*) into v_total from public.essay_piece where status = 'published';
  if p_order is null or array_length(p_order, 1) is distinct from v_total
     or (select count(distinct x) from unnest(p_order) x) <> v_total
     or exists (select 1 from unnest(p_order) x
                 where not exists (select 1 from public.essay_piece p
                                    where p.id = x and p.status = 'published'))
  then
    raise exception 'ESSAY_BADORDER' using errcode = 'P0001';
  end if;

  delete from public.essay_ranking where reader_id = v_reader.id;
  for i in 1 .. array_length(p_order, 1) loop
    insert into public.essay_ranking(reader_id, piece_id, rank) values (v_reader.id, p_order[i], i);
    insert into public.essay_read(reader_id, piece_id) values (v_reader.id, p_order[i])
    on conflict (reader_id, piece_id) do nothing;
  end loop;

  update public.essay_reader
     set comment = nullif(btrim(coalesce(p_comment, '')), ''),
         submitted_at = now()
   where id = v_reader.id;

  return json_build_object('ok', true, 'total', v_total);
end $$;

-- 잠긴 사람은 글도 다시 열람하지 못한다
create or replace function public.essay_mark_read(p_token uuid, p_piece uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_reader public.essay_reader;
begin
  select * into v_reader from public.essay_reader where token = p_token;
  if not found then
    raise exception 'ESSAY_NOREADER' using errcode = 'P0001';
  end if;
  if v_reader.submitted_at is not null
     and now() > v_reader.submitted_at + make_interval(hours => public.essay_lock_hours()) then
    raise exception 'ESSAY_LOCKED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.essay_piece where id = p_piece and status = 'published') then
    raise exception '작품을 찾을 수 없습니다.' using errcode = 'P0001';
  end if;
  insert into public.essay_read(reader_id, piece_id) values (v_reader.id, p_piece)
  on conflict (reader_id, piece_id) do nothing;
  return public.essay_next(p_token);
end $$;
