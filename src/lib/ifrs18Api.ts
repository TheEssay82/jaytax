// K-IFRS 1118 월결산 — 서버에 두는 것은 회사별 판단표와 주의계정 판단 기록뿐이다(0189). 분개장은 올리지 않는다.
import { supabase } from './supabase';
import type { Ifrs18Config, Judgment, Decision, Line1118, CloseSummary, Close2Summary } from './ifrs18';

export interface Ifrs18ClientRow { key: string; name: string; config: Ifrs18Config; updatedAt: string }

export async function listIfrs18Clients(): Promise<Ifrs18ClientRow[]> {
  const { data, error } = await supabase.from('ifrs18_client').select('key, name, config, updated_at').order('name');
  if (error) throw error;
  return (data ?? []).map((r) => ({ key: r.key, name: r.name, config: r.config as Ifrs18Config, updatedAt: r.updated_at }));
}

/** 판단표 올리기(같은 key 면 덮어쓴다) — 최고관리자 · 회계사만(RLS). */
export async function saveIfrs18Client(cfg: Ifrs18Config): Promise<void> {
  const { error } = await supabase.from('ifrs18_client')
    .upsert({ key: cfg.clientKey, name: cfg.clientName, config: cfg, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

export async function listIfrs18Judgments(clientKey: string): Promise<Judgment[]> {
  const out: Judgment[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('ifrs18_judgment')
      .select('doc_no, gl, decision, target, reason, by_name, at').eq('client_key', clientKey).order('at').range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) out.push({ docNo: r.doc_no, gl: r.gl, decision: r.decision as Decision, target: (r.target as Line1118) || null, reason: r.reason ?? '', byName: r.by_name, at: r.at });
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function saveIfrs18Judgment(clientKey: string, j: Judgment, byName: string): Promise<void> {
  const { error } = await supabase.from('ifrs18_judgment').upsert({
    client_key: clientKey, doc_no: j.docNo, gl: j.gl, decision: j.decision, target: j.target || null,
    reason: j.reason, by_name: byName, at: new Date().toISOString(),
  }, { onConflict: 'client_key,doc_no,gl' });
  if (error) throw error;
}

export async function deleteIfrs18Judgment(clientKey: string, docNo: string, gl: string): Promise<void> {
  const { error } = await supabase.from('ifrs18_judgment').delete().eq('client_key', clientKey).eq('doc_no', docNo).eq('gl', gl);
  if (error) throw error;
}

// ── 월 마감 · 작업 기록(0191) ──
export interface Ifrs18CloseRow {
  year: number; month: number; summary: CloseSummary; byName: string | null; at: string;
  close2: { summary: Close2Summary; at: string; byName: string | null } | null;
}
export async function listIfrs18Closes(clientKey: string): Promise<Ifrs18CloseRow[]> {
  const { data, error } = await supabase.from('ifrs18_close').select('year, month, summary, by_name, at, close2_summary, close2_at, close2_by_name').eq('client_key', clientKey).order('year').order('month');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    year: r.year, month: r.month, summary: r.summary as CloseSummary, byName: r.by_name, at: r.at,
    close2: r.close2_at ? { summary: r.close2_summary as Close2Summary, at: r.close2_at, byName: r.close2_by_name } : null,
  }));
}
export async function closeIfrs18Month(clientKey: string, summary: CloseSummary, byName: string): Promise<void> {
  const { error } = await supabase.from('ifrs18_close').upsert({
    client_key: clientKey, year: summary.year, month: summary.month, summary, by_name: byName, at: new Date().toISOString(),
  }, { onConflict: 'client_key,year,month' });
  if (error) throw error;
}
export async function reopenIfrs18Month(clientKey: string, year: number, month: number): Promise<void> {
  const { error } = await supabase.from('ifrs18_close').delete().eq('client_key', clientKey).eq('year', year).eq('month', month);
  if (error) throw error;
}

/** 2차 마감 — 1차 마감 줄에 덧붙인다(해제는 비운다). */
export async function close2Ifrs18Month(clientKey: string, year: number, month: number, summary: Close2Summary | null, byName: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from('ifrs18_close').update(summary
    ? { close2_summary: summary, close2_at: new Date().toISOString(), close2_by_name: byName, close2_by_id: u.user?.id }
    : { close2_summary: null, close2_at: null, close2_by_name: null, close2_by_id: null })
    .eq('client_key', clientKey).eq('year', year).eq('month', month);
  if (error) throw error;
}

export type Ifrs18Action = '분개장 읽음' | '판단 저장' | '판단 삭제' | '마감' | '마감 해제' | '2차 마감' | '2차 마감 해제' | '엑셀 내려받기';
export interface Ifrs18LogRow { id: number; year: number | null; month: number | null; action: Ifrs18Action; detail: Record<string, unknown>; byName: string | null; at: string }
export async function listIfrs18Log(clientKey: string, limit = 200): Promise<Ifrs18LogRow[]> {
  const { data, error } = await supabase.from('ifrs18_log').select('id, year, month, action, detail, by_name, at')
    .eq('client_key', clientKey).order('at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, year: r.year, month: r.month, action: r.action as Ifrs18Action, detail: (r.detail ?? {}) as Record<string, unknown>, byName: r.by_name, at: r.at }));
}
/** 기록은 거들 뿐 — 실패해도 작업을 막지 않는다. */
export async function logIfrs18(clientKey: string, year: number, month: number, action: Ifrs18Action, detail: Record<string, unknown>, byName: string): Promise<void> {
  try {
    const { data: u } = await supabase.auth.getUser();
    await supabase.from('ifrs18_log').insert({ client_key: clientKey, year, month, action, detail, by_name: byName, by_id: u.user?.id });
  } catch { /* 기록 실패는 무시 */ }
}
