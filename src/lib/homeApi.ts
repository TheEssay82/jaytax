// 내부홈(로그인 후 첫 화면)용 데이터 — 역할별 '할 일' 카운트.
//  각 카운트는 head:true 로 행을 가져오지 않고 개수만 센다. RLS가 자동 적용되므로
//  권한이 없는 역할(외부인·인당회계사)이 호출해도 0/오류→0 으로 안전하게 떨어진다.
import { supabase } from './supabase';

async function countOf(
  q: PromiseLike<{ count: number | null; error: unknown }>
): Promise<number> {
  try {
    const { count, error } = await q;
    return error ? 0 : count ?? 0;
  } catch {
    return 0;
  }
}

/** 처리 대기 발송요청(미접수) — 발송요청 처리 권한자용. */
export const countDispatchPending = () =>
  countOf(supabase.from('doc_send_requests').select('*', { count: 'exact', head: true }).eq('status', '미접수'));

/** 내가 요청한 발송 중 아직 발송완료 안 된 건. */
export const countMyDispatchActive = (uid: string) =>
  countOf(supabase.from('doc_send_requests').select('*', { count: 'exact', head: true }).eq('requester_id', uid).neq('status', '발송완료'));

/** 미완료 업데이트요청(미접수·개발중) — 최고관리자용. */
export const countOpenRequests = () =>
  countOf(supabase.from('update_requests').select('*', { count: 'exact', head: true }).in('status', ['미접수', '개발중']));

/** 내 임시저장(draft) 상담 초안. */
export const countMyConsultDrafts = (uid: string) =>
  countOf(supabase.from('consultations').select('*', { count: 'exact', head: true }).eq('author_id', uid).eq('status', 'draft'));

/** 내 임시저장(draft) 청구서. */
export const countMyBillingDrafts = (uid: string) =>
  countOf(supabase.from('billing_records').select('*', { count: 'exact', head: true }).eq('created_by', uid).eq('status', 'draft'));
