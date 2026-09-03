// 보존기한·파기 — 개인정보 보호법 제21조.
//
// 제21조제1항: 보유기간이 지나거나 목적을 달성해 **불필요하게 되었을 때 지체 없이 파기**한다.
//   다만 **다른 법령에 따라 보존하여야 하는 경우**에는 그러하지 아니하다.
// 제21조제2항: 파기할 때는 **복구·재생되지 않도록** 한다 — soft delete 는 파기가 아니다.
//
// 그래서 이 화면이 하는 일은 둘이다.
//   ① 자료마다 **어느 법에 따라 몇 년인지**를 눈에 보이게 두고,
//   ② 그 기간이 지난 것을 세어 실제로 지운다(이력을 남기고).
//
// 기간은 코드가 아니라 표(retention_policy)에 둔다 — 근거와 함께 화면에 그대로 보여야
// 점검이 되고, 법이 바뀌면 배포 없이 고칠 수 있다.
import { supabase } from './supabase';

export interface RetentionRow {
  key: string;
  label: string;
  tableName: string;
  months: number;
  basis: string;
  destroyOk: boolean;
  note: string;
  /** 이 날짜보다 앞선 것이 파기 대상. */
  cutoff: string;
  /** 파기 대상 건수. */
  due: number;
  /** 전체 건수. */
  total: number;
}

export interface PurgeLogRow {
  id: number;
  at: string;
  actorName: string;
  policyKey: string;
  tableName: string;
  cutoff: string;
  deleted: number;
  reason: string;
  method: string;
}

/** 보존기한 현황 — 자료별로 근거·기간·경과 건수. 최고관리자만. */
export async function surveyRetention(): Promise<RetentionRow[]> {
  const { data, error } = await supabase.rpc('retention_survey');
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return ((data as any[]) ?? []).map((r) => ({
    key: r.key, label: r.label, tableName: r.table_name, months: Number(r.months),
    basis: r.basis, destroyOk: !!r.destroy_ok, note: r.note ?? '',
    cutoff: r.cutoff, due: Number(r.due), total: Number(r.total),
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * 실제 파기. **되돌릴 수 없다** — 행을 지운다(제21조제2항).
 * 사유는 필수이고 파기 이력과 접속기록에 함께 남는다.
 */
export async function purgeRetention(key: string, reason: string): Promise<number> {
  const { data, error } = await supabase.rpc('retention_purge', { p_key: key, p_reason: reason });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/** 파기 이력. */
export async function listPurgeLog(): Promise<PurgeLogRow[]> {
  const { data, error } = await supabase
    .from('purge_log').select('*').order('at', { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return ((data as any[]) ?? []).map((r) => ({
    id: Number(r.id), at: r.at, actorName: r.actor_name || '', policyKey: r.policy_key,
    tableName: r.table_name, cutoff: r.cutoff, deleted: Number(r.deleted),
    reason: r.reason || '', method: r.method || '',
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** 개월 수를 사람이 읽는 말로 — 24 → '2년', 3 → '3개월'. */
export const periodLabel = (months: number): string =>
  months % 12 === 0 ? `${months / 12}년` : `${months}개월`;
