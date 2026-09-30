// 2120A 주요 감사절차 표준(gwp_proc_std, 마이그 0156) — 읽기·고치기. 규칙은 gwpProcStd.ts.
import { supabase } from './supabase';
import type { ProcStd, Trigger } from './gwpProcStd';

/* eslint-disable @typescript-eslint/no-explicit-any */
const toStd = (r: any): ProcStd => ({
  id: r.id, account: r.account, aliases: r.aliases ?? [], trigger: r.trigger as Trigger, industry: r.industry,
  body: r.body, sort: r.sort, active: r.active, note: r.note ?? null,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listProcStd(): Promise<ProcStd[]> {
  const { data, error } = await supabase.from('gwp_proc_std').select('*').order('account').order('trigger').order('sort');
  if (error) throw new Error(error.message);
  return (data ?? []).map(toStd);
}

/** 새 줄(id 없음) 또는 고친 줄. */
export async function saveProcStd(s: Omit<ProcStd, 'id'> & { id?: string }): Promise<ProcStd> {
  const { data: u } = await supabase.auth.getUser();
  const row = {
    account: s.account.trim(), aliases: s.aliases.map((a) => a.trim()).filter(Boolean), trigger: s.trigger, industry: s.industry,
    body: s.body.trim(), sort: s.sort, active: s.active, note: s.note, updated_by: u.user?.id, updated_at: new Date().toISOString(),
  };
  const q = s.id ? supabase.from('gwp_proc_std').update(row).eq('id', s.id) : supabase.from('gwp_proc_std').insert(row);
  const { data, error } = await q.select('*').single();
  if (error) throw new Error(error.message);
  return toStd(data);
}

export async function deleteProcStd(id: string): Promise<void> {
  const { error } = await supabase.from('gwp_proc_std').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
