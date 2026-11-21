-- 0203: 쏭비서 텔레그램 — 같은 메시지 한 번만 처리 + 짧은 대화 기억(대표님 승인 2026-11-21)
--
-- 왜: Vercel 은 메시지마다 서버를 여러 대 중 아무거나 쓴다. 서버 안 기억·중복막기로는
--     한 지시로 결재 2건이 올라가고(17:46), 앞 대화를 잊었다(18:09). 그래서 DB 에 둔다.
--
-- 지키는 것
--   · 표는 RLS 켜고 정책 없음 — 사람·anon 이 직접 못 본다. 쏭비서 열쇠(x-ssong-key)가 맞는 함수로만.
--   · 대화 기억에는 거래처명·금액이 들어갈 수 있다 → 30분 지나면 지운다(부를 때마다 청소), 8마디까지만.
--   · 처리한 메시지 번호는 하루 지나면 지운다.
--   · 함수는 PUBLIC EXECUTE 부터 회수(0150 규칙), anon 에만 준다.

create table if not exists public.ssong_tg_seen (
  key text primary key,
  at  timestamptz not null default now()
);
alter table public.ssong_tg_seen enable row level security;

create table if not exists public.ssong_tg_memory (
  chat_id text primary key,
  turns   jsonb not null default '[]'::jsonb,
  at      timestamptz not null default now()
);
alter table public.ssong_tg_memory enable row level security;

revoke all on public.ssong_tg_seen, public.ssong_tg_memory from public, anon, authenticated;

-- 처음 보는 메시지면 true(그리고 적어 둔다), 이미 처리했으면 false.
create or replace function public.ssong_tg_claim(p_key text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.ssong_require();
  if coalesce(btrim(p_key), '') = '' or length(p_key) > 200 then raise exception '메시지 번호가 이상합니다'; end if;
  delete from public.ssong_tg_seen where at < now() - interval '1 day';
  insert into public.ssong_tg_seen(key) values (p_key) on conflict do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- 최근 대화(30분 안). 없으면 [].
create or replace function public.ssong_tg_recall(p_chat text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.ssong_require();
  delete from public.ssong_tg_memory where at < now() - interval '30 minutes';
  select m.turns into v from public.ssong_tg_memory m where m.chat_id = p_chat;
  return coalesce(v, '[]'::jsonb);
end $$;

-- 대화를 덧붙인다(마지막 8마디만). p_reset 이면 비운다.
create or replace function public.ssong_tg_remember(p_chat text, p_turns jsonb, p_reset boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare cur jsonb; merged jsonb;
begin
  perform public.ssong_require();
  if coalesce(btrim(p_chat), '') = '' then raise exception '대화방 번호가 없습니다'; end if;
  if p_reset then delete from public.ssong_tg_memory where chat_id = p_chat; return; end if;
  if jsonb_typeof(p_turns) <> 'array' or length(p_turns::text) > 40000 then raise exception '대화 내용이 이상합니다'; end if;
  delete from public.ssong_tg_memory where at < now() - interval '30 minutes';
  select m.turns into cur from public.ssong_tg_memory m where m.chat_id = p_chat;
  select coalesce(jsonb_agg(t order by i), '[]'::jsonb) into merged from (
    select t, i from jsonb_array_elements(coalesce(cur, '[]'::jsonb) || p_turns) with ordinality as x(t, i)
    order by i desc limit 8) q;
  insert into public.ssong_tg_memory(chat_id, turns, at) values (p_chat, merged, now())
  on conflict (chat_id) do update set turns = excluded.turns, at = excluded.at;
end $$;

revoke all on function public.ssong_tg_claim(text) from public, anon, authenticated;
revoke all on function public.ssong_tg_recall(text) from public, anon, authenticated;
revoke all on function public.ssong_tg_remember(text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.ssong_tg_claim(text) to anon;
grant execute on function public.ssong_tg_recall(text) to anon;
grant execute on function public.ssong_tg_remember(text, jsonb, boolean) to anon;
