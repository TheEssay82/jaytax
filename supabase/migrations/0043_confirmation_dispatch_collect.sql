-- 조회서 발송·회수 진행상태. 조회처(item) 단위로 기록하고, 거래처 단위 현황은 여기서 집계한다.
-- (2025 엑셀은 총괄 숫자를 손으로 적어 개별 시트와 어긋났으므로 집계는 저장하지 않는다)

alter table public.confirmation_items
  -- 발송
  add column if not exists sent            boolean not null default false,
  add column if not exists sent_date       date,
  add column if not exists tracking_no     text,          -- 실물발송 등기번호(전자조회는 없음)
  -- 회수: 미처리(null) / 회수완료 / 반송
  add column if not exists collect_status  text,
  add column if not exists collect_date    date,
  add column if not exists return_reason   text;          -- 반송 사유(조회현황에 표시)

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'confirmation_items_collect_status_chk') then
    alter table public.confirmation_items
      add constraint confirmation_items_collect_status_chk
      check (collect_status is null or collect_status in ('회수완료','반송'));
  end if;
end $$;

-- 현황 화면이 연도별로 훑으므로 발송/회수 상태에 인덱스를 둔다.
create index if not exists confirmation_items_progress_idx
  on public.confirmation_items (confirmation_id, sent, collect_status);

comment on column public.confirmation_items.sent is '발송 여부. 전자조회는 클릭 토글, 실물발송은 등기번호 등록 시 함께 처리';
comment on column public.confirmation_items.collect_status is '회수완료 | 반송 | null(미처리)';
