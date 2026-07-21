-- 조회서 변경이력 — 감사증빙이므로 '누가 언제 무엇을 바꿨는지'가 반드시 남아야 한다.
-- 문서발송(doc_audit_log)과 섞지 않는다: 두 시스템은 목적이 다르고,
-- 문서발송 변경로그 화면이 entity 필터 없이 전부 읽고 있어 섞으면 오염된다.

create table if not exists public.confirmation_audit_log (
  id              bigserial primary key,
  confirmation_id uuid,                 -- 거래처×회계연도 세트
  item_id         uuid,                 -- 조회처 단위 변경이면 채워진다
  entity          text not null check (entity in ('confirmation','item')),
  action          text not null check (action in ('insert','update','delete')),
  actor_id        uuid,
  actor_name      text,
  summary         text,                 -- 사람이 읽는 요약(발송·회수 전이 포함)
  before          jsonb,
  after           jsonb,
  at              timestamptz not null default now()
);

create index if not exists confirmation_audit_conf_idx
  on public.confirmation_audit_log (confirmation_id, at desc);
create index if not exists confirmation_audit_at_idx
  on public.confirmation_audit_log (at desc);

create or replace function public.confirm_actor_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select name from public.profiles where id = auth.uid()), '(알 수 없음)');
$$;

/**
 * 조회처(item) 변경 요약 — 발송·회수 전이를 우선 서술한다.
 * 감사에서 중요한 건 "언제 발송했고 언제 회수됐는가"라서 그 전이를 앞세운다.
 * 주의: text[] || text 는 배열 리터럴로 해석돼 실패할 수 있어 array[...] 로 감싼다.
 */
create or replace function public.confirm_item_summary(o jsonb, n jsonb, op text)
returns text language plpgsql immutable as $$
declare
  inst text := coalesce(n->>'institution', o->>'institution', '(미상)');
  parts text[] := '{}';
  ob boolean; nb boolean;
begin
  if op = 'INSERT' then return '조회처 추가: ' || inst; end if;
  if op = 'DELETE' then return '조회처 삭제: ' || inst; end if;

  ob := coalesce((o->>'sent')::boolean, false);
  nb := coalesce((n->>'sent')::boolean, false);
  if ob is distinct from nb then
    parts := parts || array[case when nb then '발송처리' else '발송취소' end];
  end if;
  if coalesce(o->>'sent_date','') is distinct from coalesce(n->>'sent_date','') then
    parts := parts || array['발송일 ' || coalesce(nullif(o->>'sent_date',''),'—') || ' → ' || coalesce(nullif(n->>'sent_date',''),'—')];
  end if;
  if coalesce(o->>'tracking_no','') is distinct from coalesce(n->>'tracking_no','') then
    parts := parts || array['등기번호 ' || coalesce(nullif(o->>'tracking_no',''),'—') || ' → ' || coalesce(nullif(n->>'tracking_no',''),'—')];
  end if;
  if coalesce(o->>'collect_status','') is distinct from coalesce(n->>'collect_status','') then
    parts := parts || array['회수 ' || coalesce(nullif(o->>'collect_status',''),'미처리') || ' → ' || coalesce(nullif(n->>'collect_status',''),'미처리')];
  end if;
  if coalesce(o->>'return_reason','') is distinct from coalesce(n->>'return_reason','') then
    parts := parts || array['반송사유: ' || coalesce(nullif(n->>'return_reason',''),'(삭제)')];
  end if;
  if coalesce(o->>'institution','') is distinct from coalesce(n->>'institution','') then
    parts := parts || array['기관명 ' || coalesce(nullif(o->>'institution',''),'—') || ' → ' || coalesce(nullif(n->>'institution',''),'—')];
  end if;
  if coalesce(o->>'kind','') is distinct from coalesce(n->>'kind','')
     or coalesce(o->>'is_electronic','') is distinct from coalesce(n->>'is_electronic','')
     or coalesce(o->>'address','') is distinct from coalesce(n->>'address','')
     or coalesce(o->>'phone','') is distinct from coalesce(n->>'phone','')
     or coalesce(o->>'contact_name','') is distinct from coalesce(n->>'contact_name','')
     or coalesce(o->>'note','') is distinct from coalesce(n->>'note','') then
    parts := parts || array['명세 수정'];
  end if;

  if array_length(parts, 1) is null then return null; end if;  -- 실질 변경 없음 → 기록 생략
  return inst || ' — ' || array_to_string(parts, ', ');
end; $$;

create or replace function public.confirm_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_entity text := TG_ARGV[0];
  rec jsonb;
  v_conf uuid;
  v_item uuid;
  v_summary text;
  v_act text := case TG_OP when 'INSERT' then '등록' when 'UPDATE' then '수정' else '삭제' end;
begin
  if TG_OP = 'DELETE' then rec := to_jsonb(old); else rec := to_jsonb(new); end if;

  if v_entity = 'confirmation' then
    v_conf := (rec->>'id')::uuid;
    v_summary := '조회서 ' || v_act || ': ' || coalesce(rec->>'company_name','(무제)')
                 || ' ' || coalesce(rec->>'fiscal_year','') || '년';
    if TG_OP = 'UPDATE' and (old.status is distinct from new.status) then
      v_summary := v_summary || ' (상태 ' || coalesce(old.status,'—') || ' → ' || coalesce(new.status,'—') || ')';
    end if;
  else
    v_conf := (rec->>'confirmation_id')::uuid;
    v_item := (rec->>'id')::uuid;
    v_summary := public.confirm_item_summary(
      case when TG_OP <> 'INSERT' then to_jsonb(old) else '{}'::jsonb end,
      case when TG_OP <> 'DELETE' then to_jsonb(new) else '{}'::jsonb end,
      TG_OP);
    -- 실질 변경이 없으면(updated_at 만 바뀐 경우 등) 로그를 남기지 않는다
    if v_summary is null then
      if TG_OP = 'DELETE' then return old; else return new; end if;
    end if;
  end if;

  insert into public.confirmation_audit_log
    (confirmation_id, item_id, entity, action, actor_id, actor_name, summary, before, after)
  values (
    v_conf, v_item, v_entity, lower(TG_OP), auth.uid(), public.confirm_actor_name(), v_summary,
    case when TG_OP <> 'INSERT' then to_jsonb(old) end,
    case when TG_OP <> 'DELETE' then to_jsonb(new) end
  );
  if TG_OP = 'DELETE' then return old; else return new; end if;
end; $$;

drop trigger if exists trg_confirmations_audit on public.confirmations;
create trigger trg_confirmations_audit
  after insert or update or delete on public.confirmations
  for each row execute function public.confirm_audit('confirmation');

drop trigger if exists trg_confirmation_items_audit on public.confirmation_items;
create trigger trg_confirmation_items_audit
  after insert or update or delete on public.confirmation_items
  for each row execute function public.confirm_audit('item');

-- 로그는 내부 구성원 조회 전용. 앱에서 쓰거나 지울 수 없다(트리거만 기록).
alter table public.confirmation_audit_log enable row level security;
drop policy if exists confirmation_audit_sel on public.confirmation_audit_log;
create policy confirmation_audit_sel on public.confirmation_audit_log
  for select to authenticated using (not public.is_external());
