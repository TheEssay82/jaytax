// taxteam 발행요청의 '달' 관리 — 당월 전개 · 담당자 확인 · 최종확인.
//
// 엑셀에서 하던 일을 그대로 옮긴 것이다.
//   전월 열을 당월로 복사        → '당월 전개' (계약에서 그 달 청구분을 펼쳐 요청으로 등록)
//   담당자 3인이 변경분만 수정   → 화면에서 수정
//   변경이 없어도 봤다는 표시    → '확인' (누른 사실 자체가 기록)
//   김민섭이 3인 확인을 보고 마감 → '최종확인'
//
// 전개를 자동(매월 24일)이 아니라 **버튼**으로 둔 이유: 계약이 늦게 등록된 달에는
// 자동 전개 시점이 어긋난다. 대신 24일이 지나면 화면이 알림을 권한다.
import { supabase } from './supabase';

/** taxteam 월 확인 담당자 — 이 3인이 각자 확인을 눌러야 최종확인이 열린다. */
export const CHECKERS = ['김민섭', '김동주', '정남지'] as const;
/** 최종확인·발행완료를 누를 수 있는 사람. 김민섭이 원칙이고 부재 시 팀장·최고관리자. */
export const FINAL_APPROVER = '김민섭';
/** taxteam 작성일(발행기준일)은 매월 24일 고정. */
export const ISSUE_DAY = 24;

export interface MonthCheck { userId: string; name: string; checkedAt: string; note: string }
export interface MonthState {
  ym: string;
  opened: boolean;
  openedAt: string | null;
  openedBy: string;                 // 이름
  finalConfirmedAt: string | null;
  finalConfirmedBy: string;         // 이름
  checks: MonthCheck[];
}

const nameMap = async (ids: string[]): Promise<Map<string, string>> => {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const { data } = await supabase.from('profiles').select('id, name').in('id', uniq);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return new Map((data as any[] ?? []).map((r) => [r.id as string, ((r.name as string) || '').trim()]));
  /* eslint-enable @typescript-eslint/no-explicit-any */
};

export async function getMonthState(ym: string): Promise<MonthState> {
  const [m, c] = await Promise.all([
    supabase.from('biz_invoice_month').select('*').eq('ym', ym).maybeSingle(),
    supabase.from('biz_invoice_check').select('user_id, checked_at, note').eq('ym', ym),
  ]);
  if (m.error) throw new Error(m.error.message);
  if (c.error) throw new Error(c.error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const row = m.data as any | null;
  const checks = (c.data as any[]) ?? [];
  const names = await nameMap([row?.opened_by, row?.final_confirmed_by, ...checks.map((x) => x.user_id)]);
  return {
    ym,
    opened: !!row,
    openedAt: row?.opened_at ?? null,
    openedBy: names.get(row?.opened_by) ?? '',
    finalConfirmedAt: row?.final_confirmed_at ?? null,
    finalConfirmedBy: names.get(row?.final_confirmed_by) ?? '',
    checks: checks.map((x) => ({
      userId: x.user_id, name: names.get(x.user_id) ?? '', checkedAt: x.checked_at, note: x.note ?? '',
    })).sort((a, b) => CHECKERS.indexOf(a.name as never) - CHECKERS.indexOf(b.name as never)),
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** 그 달을 연다(전개 기록만 남긴다 — 요청 등록은 화면이 따로 한다). */
export async function openMonth(ym: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from('biz_invoice_month')
    .upsert({ ym, opened_by: u.user?.id ?? null }, { onConflict: 'ym' });
  if (error) throw new Error(error.message);
}

/** 담당자 3인에게 확인 요청 알림. 반환 = 보낸 사람 수(자기 자신은 제외된다). */
export async function notifyCheckers(ym: string): Promise<number> {
  const { data, error } = await supabase.rpc('biz_invoice_notify_check', { p_ym: ym });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

/** 내가 이 달을 확인했다고 표시. 변경이 없어도 눌러야 한다. */
export async function markMyCheck(ym: string, note = ''): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('로그인이 필요합니다.');
  const { error } = await supabase.from('biz_invoice_check')
    .upsert({ ym, user_id: uid, checked_at: new Date().toISOString(), note }, { onConflict: 'ym,user_id' });
  if (error) throw new Error(error.message);
}
export async function clearMyCheck(ym: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from('biz_invoice_check')
    .delete().eq('ym', ym).eq('user_id', u.user?.id ?? '');
  if (error) throw new Error(error.message);
}

/** 최종확인 / 해제. 누가 눌렀는지 남아 화면에 표시된다. */
export async function setFinalConfirm(ym: string, on: boolean): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from('biz_invoice_month')
    .update({
      final_confirmed_at: on ? new Date().toISOString() : null,
      final_confirmed_by: on ? (u.user?.id ?? null) : null,
    })
    .eq('ym', ym);
  if (error) throw new Error(error.message);
}

/** 그 달 24일. taxteam 작성일(발행기준일)로 쓴다. */
export const issueDateOf = (ym: string) => `${ym}-${String(ISSUE_DAY).padStart(2, '0')}`;
/** 24일이 지났는가 — 지났는데 아직 안 열었으면 화면이 재촉한다. */
export function pastIssueDay(ym: string, today: string): boolean {
  return today >= issueDateOf(ym);
}
