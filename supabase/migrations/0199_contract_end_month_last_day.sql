-- 0199 매출계약 종료일 = 그 달 말일(사용자 2026-11-20 「종료일이 연-월만 보여 실제로는 1일로 들어가 있다」).
-- 화면은 「연-월」만 받는다. 1일로 두면 종료월 안의 날짜(3월 결산 법인의 6월 세무조정 확정일)가 계약기간 밖으로 나간다.
-- 기존 1일 → 말일(2026-11-20 기준 230건 중 206건), 앞으로는 트리거가 1일을 말일로 바꾼다(SQL 적재 · 엑셀 일괄 등 어느 길로 들어와도).
create or replace function public.biz_contract_end_month_last()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.end_date is not null and extract(day from new.end_date) = 1 then
    new.end_date := (date_trunc('month', new.end_date) + interval '1 month - 1 day')::date;
  end if;
  return new;
end; $$;
revoke execute on function public.biz_contract_end_month_last() from public, anon, authenticated;

drop trigger if exists trg_biz_contract_end_month_last on public.biz_sales_contract;
create trigger trg_biz_contract_end_month_last before insert or update of end_date on public.biz_sales_contract
  for each row execute function public.biz_contract_end_month_last();

update public.biz_sales_contract
   set end_date = (date_trunc('month', end_date) + interval '1 month - 1 day')::date
 where end_date is not null and extract(day from end_date) = 1;
