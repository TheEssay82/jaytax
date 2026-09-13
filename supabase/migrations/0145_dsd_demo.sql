-- 0145 주석·DSD 관리 — 외부인에게 보여 줄 「시연용」 작업 건
--
-- 왜 필요한가: 이 시스템을 홍보하려면 외부인이 직접 ①~④ 를 밟아 봐야 한다. 그런데
-- 0143 에서 dsd_engagement·dsd_note 를 `not is_external()` 로 통째로 막아 두었다 —
-- 외부인이 들어오면 ① 대상이 **빈 화면**이 된다. 거래처 이름이 새지 않게 한 것이라
-- 그 기본값은 옳다.
--
-- 그래서 **딱 한 줄만 뚫는다.** 「시연용」 표가 붙은 작업 건과 그 주석 목록만 외부인이
-- **읽을 수 있다.** 쓰기는 그대로 막는다(is_external + is_readonly) — 시연자가 화면을
-- 망가뜨릴 수 없고, 진짜 거래처는 여전히 한 줄도 보이지 않는다.
--
-- ②③④ 는 서버를 쓰지 않는다(파일은 브라우저 안에서만 열린다). 그래서 ① 의 주석 목록만
-- 읽히면 시연은 끝까지 돈다.

-- ── 「시연용」 표 ───────────────────────────────────────────────────
alter table public.biz_entity
  add column if not exists is_demo boolean not null default false;
comment on column public.biz_entity.is_demo is
  '시연용 가짜 거래처. 외부인에게도 보인다 — 진짜 거래처는 is_external() 로 막혀 있다.';

alter table public.dsd_engagement
  add column if not exists is_demo boolean not null default false;
comment on column public.dsd_engagement.is_demo is
  '외부인 시연용 작업 건. 외부인은 이 건과 그 주석 목록만 읽을 수 있고 쓰지는 못한다.';

-- ── 읽기만 뚫는다 ──────────────────────────────────────────────────
-- biz_entity: 0056 에서 `not is_external()` 로 좁혔다. 시연용 한 곳만 더 내놓는다.
alter policy biz_entity_sel on public.biz_entity
  using (not public.is_external() or is_demo);

drop policy if exists dsd_engagement_sel on public.dsd_engagement;
create policy dsd_engagement_sel on public.dsd_engagement for select
  using (not public.is_external() or is_demo);

drop policy if exists dsd_note_sel on public.dsd_note;
create policy dsd_note_sel on public.dsd_note for select
  using (
    not public.is_external()
    or exists (
      select 1 from public.dsd_engagement e
      where e.id = dsd_note.engagement_id and e.is_demo
    )
  );

-- 쓰기 정책은 건드리지 않는다 — dsd_engagement_write · dsd_note_write 는 그대로
-- `not is_external() and not is_readonly()` 다. 외부인은 **보기만** 한다.

-- ── 시연용 거래처 한 곳 ────────────────────────────────────────────
-- 이름에 「(시연)」을 달아 둔다 — 거래처 목록에서 사람이 한눈에 가려내야 한다.
insert into public.biz_entity (kind, name, is_demo)
select '법인', '(시연) 데모산업', true
where not exists (select 1 from public.biz_entity where name = '(시연) 데모산업');
