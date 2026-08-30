-- 0068: 관리자가 평가 기록(독자·읽음·순위)을 통째로 지울 수 있게 한다.
--   시험 삼아 돌려본 데이터를 실제 공개 전에 비우는 용도. 작품(essay_piece)은 건드리지 않는다.
--   essay_read·essay_ranking 은 reader 에 on delete cascade 로 묶여 함께 지워진다.
drop policy if exists essay_reader_admin_del on public.essay_reader;
create policy essay_reader_admin_del on public.essay_reader for delete to authenticated
  using (public.is_superuser());
