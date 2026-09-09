-- 거래처 코드 채번이 이미 쓰이는 번호를 다시 내주던 것
--
-- 증상: 거래처등록에서 "duplicate key value violates unique constraint biz_entity_code_key".
--
-- 원인: 코드는 biz_corp_seq / biz_person_seq 로 매기는데, **코드를 직접 넣고 들어온 행**은
--       시퀀스를 올리지 않는다. 2026-09-01 에 원일사(L0151)·서로앤컬쳐(L0152)가 SQL 로
--       직접 들어오면서(created_by 없음) 시퀀스는 150 에 머물렀다. 그래서 다음 등록이
--       L0151 을 받아 충돌했다.
--
-- 고치는 방법 두 가지를 함께 넣는다.
--   ① 지금 어긋난 시퀀스를 실제 최대번호에 맞춘다.
--   ② 앞으로도 어긋나지 않게 트리거를 고친다 —
--      · 자동 채번은 **이미 쓰이는 번호를 건너뛴다**(그날의 사고를 그 자리에서 흡수)
--      · 코드를 직접 넣으면 **시퀀스를 그만큼 끌어올린다**(다음 사람이 밟지 않게)

-- ── ① 지금 어긋난 것을 맞춘다 ────────────────────────────────────────────
select setval(
  'public.biz_corp_seq',
  greatest(
    coalesce(pg_sequence_last_value('public.biz_corp_seq'::regclass), 1),
    coalesce((select max(substring(code from 2)::bigint) from public.biz_entity
              where kind = '법인' and code ~ '^L[0-9]+$'), 1)
  )
);
select setval(
  'public.biz_person_seq',
  greatest(
    coalesce(pg_sequence_last_value('public.biz_person_seq'::regclass), 1),
    coalesce((select max(substring(code from 2)::bigint) from public.biz_entity
              where kind = '개인' and code ~ '^I[0-9]+$'), 1)
  )
);

-- ── ② 다시 어긋나지 않게 ─────────────────────────────────────────────────
create or replace function public.biz_entity_before_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_seq  text;
  v_pre  text;
  v_num  bigint;
  v_last bigint;
  v_try  int := 0;
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  new.updated_by := coalesce(new.updated_by, auth.uid());

  if new.kind = '법인' then v_seq := 'public.biz_corp_seq';   v_pre := 'L';
  else                      v_seq := 'public.biz_person_seq'; v_pre := 'I';
  end if;

  if new.code is null or new.code = '' then
    -- **이미 쓰이는 번호는 건너뛴다.** 시퀀스가 어떤 이유로든 뒤처져 있어도
    -- 등록이 실패하지 않고, 지나가면서 시퀀스가 저절로 따라잡는다.
    loop
      v_try := v_try + 1;
      new.code := v_pre || lpad(nextval(v_seq)::text, 4, '0');
      exit when not exists (select 1 from public.biz_entity where code = new.code);
      -- 있을 수 없는 일이지만, 무한히 도는 것보다 실패해서 알리는 편이 낫다.
      if v_try > 1000 then
        raise exception '거래처 코드를 매기지 못했습니다(% 번 시도). 시퀀스를 확인하세요.', v_try;
      end if;
    end loop;
  elsif new.code ~ ('^' || v_pre || '[0-9]+$') then
    -- 코드를 직접 넣은 경우(자료 이관·SQL 직접입력) — 시퀀스를 그 번호까지 끌어올린다.
    v_num  := substring(new.code from 2)::bigint;
    v_last := coalesce(pg_sequence_last_value(v_seq::regclass), 0);
    if v_num > v_last then
      perform setval(v_seq, v_num);
    end if;
  end if;

  return new;
end;
$function$;
