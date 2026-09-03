// 접속기록 — 「개인정보의 안전성 확보조치 기준」 제8조.
//
// 업무 로그(biz_audit_log 등)와 다르다. 저쪽은 "무엇이 어떻게 바뀌었나"를 남기고,
// 이쪽은 **누가 · 언제 · 어디서 접속해 · 누구의 개인정보를 · 무엇을 했나**를 남긴다.
// 고시 제2조제3호가 요구하는 다섯 가지(식별자·접속일시·접속지·정보주체·수행업무)다.
//
// 기록은 서버(log_access RPC)가 한다 — IP 를 브라우저가 적으면 증거가 못 된다.
// 표는 수정·삭제가 막혀 있고, 줄마다 앞줄 해시를 물어 지운 자리가 드러난다.
import { supabase } from './supabase';

/** 수행업무 — 화면에 한국어로 보여 줄 이름표까지 여기서 정한다. */
export const ACTIONS = {
  login: '로그인',
  logout: '로그아웃',
  login_failed: '로그인 실패',
  login_locked: '로그인 차단',
  reveal_resident: '주민번호 열람',
  reveal_hometax_pw: '홈택스PW 열람',
  download_resident_all: '주민번호 일괄 열람',
  download_hometax_pw_all: '홈택스PW 일괄 열람',
  export: '자료 내려받기',
  purge: '파기',
  reveal_denied: '열람 거부됨',
} as const;
export type ActionKey = keyof typeof ACTIONS;
export const actionLabel = (a: string) => (ACTIONS as Record<string, string>)[a] ?? a;

export interface AccessLogRow {
  id: number;
  at: string;
  actorName: string;
  actorEmail: string;
  ip: string;
  userAgent: string;
  action: string;
  target: string;
  subjectId: string | null;
  subjectName: string;
  reason: string;
  detail: Record<string, unknown> | null;
}

/**
 * 한 줄 남긴다. **절대 예외를 던지지 않는다** —
 * 기록이 실패했다고 사용자의 업무가 막히면 안 된다(기록은 부수적이고 업무가 본체다).
 */
export async function logAccess(
  action: ActionKey | string,
  opts: { target?: string; subjectId?: string | null; subjectName?: string; reason?: string; detail?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await supabase.rpc('log_access', {
      p_action: action,
      p_target: opts.target ?? null,
      p_subject_id: opts.subjectId ?? null,
      p_subject_name: opts.subjectName ?? null,
      p_reason: opts.reason ?? null,
      p_detail: opts.detail ?? null,
    });
  } catch { /* 기록 실패가 업무를 막지 않는다 */ }
}

export interface LogFilter {
  from?: string;        // YYYY-MM-DD
  to?: string;          // YYYY-MM-DD (그 날 포함)
  actor?: string;       // 이름 일부
  action?: string;
  subject?: string;     // 정보주체 이름 일부
  limit?: number;
}

/** 조회 — 최고관리자만 읽을 수 있다(RLS). 남의 접속기록도 그 자체가 개인정보다. */
export async function listAccessLog(f: LogFilter = {}): Promise<AccessLogRow[]> {
  let q = supabase.from('access_log').select('*').order('at', { ascending: false }).limit(f.limit ?? 500);
  if (f.from) q = q.gte('at', `${f.from}T00:00:00`);
  if (f.to) q = q.lte('at', `${f.to}T23:59:59.999`);
  if (f.action) q = q.eq('action', f.action);
  if (f.actor?.trim()) q = q.ilike('actor_name', `%${f.actor.trim()}%`);
  if (f.subject?.trim()) q = q.ilike('subject_name', `%${f.subject.trim()}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return ((data as any[]) ?? []).map((r) => ({
    id: Number(r.id),
    at: r.at,
    actorName: r.actor_name || '(이름 없음)',
    actorEmail: r.actor_email || '',
    ip: r.ip || '',
    userAgent: r.user_agent || '',
    action: r.action,
    target: r.target || '',
    subjectId: r.subject_id ?? null,
    subjectName: r.subject_name || '',
    reason: r.reason || '',
    detail: r.detail ?? null,
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export interface VerifyResult { checked: number; ok: boolean; firstBadId: number | null; firstBadAt: string | null }

/**
 * 위·변조 검증(제8조제3항). 줄마다 앞줄 해시를 다시 계산해 맞춰 본다.
 * 한 줄이라도 고치거나 빼면 그 뒤가 전부 어긋나 처음 어긋난 자리가 나온다.
 */
export async function verifyAccessLog(from?: string): Promise<VerifyResult> {
  const { data, error } = await supabase.rpc('access_log_verify', { p_from: from ? `${from}T00:00:00` : null });
  if (error) throw new Error(error.message);
  const r = (Array.isArray(data) ? data[0] : data) as
    { checked: number; ok: boolean; first_bad_id: number | null; first_bad_at: string | null } | undefined;
  return {
    checked: Number(r?.checked ?? 0),
    ok: !!r?.ok,
    firstBadId: r?.first_bad_id ?? null,
    firstBadAt: r?.first_bad_at ?? null,
  };
}

// ── 인증 실패 제한 (고시 제5조제6항) ─────────────────────
// 같은 (계정, 접속지) 에서 15분 안에 5회 실패하면 15분간 막는다.
// 계정만으로 잠그면 남의 이메일만 알아도 그 사람을 잠글 수 있어(서비스 거부) 접속지까지 묶는다.

export interface LoginGate { locked: boolean; fails: number; retryAfterSec: number }
const MAX_FAILS = 5;

/* eslint-disable @typescript-eslint/no-explicit-any */
const toGate = (data: any): LoginGate => {
  const r = (Array.isArray(data) ? data[0] : data) ?? {};
  return { locked: !!r.locked, fails: Number(r.fails ?? 0), retryAfterSec: Number(r.retry_after_sec ?? 0) };
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 로그인 시도 **전에** 확인 — 막혀 있으면 비밀번호를 보내지도 않는다. */
export async function checkLoginGate(email: string): Promise<LoginGate> {
  const { data, error } = await supabase.rpc('login_gate', { p_email: email });
  if (error) return { locked: false, fails: 0, retryAfterSec: 0 };  // 판정 실패로 사람을 잠그지 않는다
  return toGate(data);
}

/** 실패를 남기고, 남은 횟수를 돌려준다. */
export async function recordLoginFailure(email: string): Promise<LoginGate> {
  const { data, error } = await supabase.rpc('login_failed', { p_email: email });
  if (error) return { locked: false, fails: 0, retryAfterSec: 0 };
  return toGate(data);
}

/** 성공을 남긴다 — 이 뒤로 실패 카운터가 0 부터 다시 센다. */
export async function recordLoginSuccess(email: string): Promise<void> {
  try { await supabase.rpc('login_ok', { p_email: email }); } catch { /* 업무를 막지 않는다 */ }
}

/** 사람이 읽을 잠금 안내. */
export function lockMessage(g: LoginGate): string {
  const min = Math.max(1, Math.ceil(g.retryAfterSec / 60));
  return `비밀번호를 ${MAX_FAILS}회 이상 틀려 이 자리에서의 접속이 잠겼습니다. `
    + `약 ${min}분 뒤에 다시 시도해 주세요.\n\n`
    + '비밀번호가 기억나지 않으면 최고관리자에게 재설정을 요청하세요. (개인정보보호법 「안전성 확보조치 기준」 제5조제6항)';
}

/** 실패했을 때 보여 줄 남은 횟수 안내. */
export function remainMessage(g: LoginGate): string {
  const left = Math.max(0, MAX_FAILS - g.fails);
  return left > 0 && left <= 3 ? ` (${left}회 더 틀리면 15분간 잠깁니다)` : '';
}
