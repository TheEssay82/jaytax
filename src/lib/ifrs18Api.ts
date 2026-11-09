// K-IFRS 1118 월결산 — 서버에 두는 것은 회사별 판단표와 주의계정 판단 기록뿐이다(0189). 분개장은 올리지 않는다.
import { supabase } from './supabase';
import type { Ifrs18Config, Judgment, Decision, Line1118 } from './ifrs18';

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
