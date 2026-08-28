-- 0065 롤백: 습작(에세이) 열람·평점 전체 제거. 한시적 기능이므로 사용 종료 후 이 파일을 실행한다.
drop function if exists public.essay_name_suggestions(text);
drop function if exists public.essay_scoreboard();
drop function if exists public.essay_rate(uuid, uuid, int);
drop function if exists public.essay_next(uuid);
drop function if exists public.essay_state(uuid);
drop function if exists public.essay_register(text);
drop function if exists public.essay_name_key(text);
drop table if exists public.essay_rating;
drop table if exists public.essay_reader;
drop table if exists public.essay_piece;
drop function if exists public.essay_set_created_by();

drop policy if exists essay_bg_read   on storage.objects;
drop policy if exists essay_bg_write  on storage.objects;
drop policy if exists essay_bg_delete on storage.objects;
delete from storage.objects where bucket_id = 'essay-bg';
delete from storage.buckets where id = 'essay-bg';
