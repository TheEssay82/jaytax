import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // 개발 중 환경변수 누락을 빠르게 알아채기 위함
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 설정되지 않았습니다. .env.local 을 확인하세요.'
  );
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

/**
 * RLS 의 USING 조건에 걸린 UPDATE/DELETE 는 오류가 아니라 "대상 행 없음"으로 끝난다.
 * PostgREST 는 200 을 돌려주므로 error 만 검사하면 실패를 성공으로 오인한다.
 * (예: 기장팀원이 확정된 청구서를 수정 → 조용히 무시되는데 화면엔 '저장됨')
 *
 * 그래서 쓰기 호출에는 `.select('id')` 를 붙이고 그 결과를 이 함수로 확인한다.
 * 0행이 정상인 호출(멱등 삭제, 조건부 일괄 해제 등)에는 쓰지 않는다.
 */
export function assertWrote(rows: unknown[] | null, action = '변경'): void {
  if (!rows || rows.length === 0) {
    throw new Error(`${action}되지 않았습니다 — 권한이 없거나 대상 건이 없습니다.`);
  }
}
