// 팀결산 경비 귀속 — 읽고 쓰기(마이그 0172·0173, 사용자 2026-10-19).
// 확정은 사람이 줄마다 한다. 다시 올려도 이미 정한 줄은 그대로 두고 ERP 값만 새로 한다.
import { supabase } from './supabase';
import { corpDisplayName, type CorpForm } from './bizRegistryApi';
import type { ParsedExpense } from './expenseParse';
import { suggest, type ClientRef, type PriorDecision } from './expenseSuggest';

export interface ExpenseLine {
  id: string;
  fy: number;
  basket: string;
  writer: string;
  exjunpyo_no: string;
  line_no: number;
  evid_date: string | null;
  title: string | null;
  description: string;
  account: string | null;
  vendor: string | null;
  supply: number;
  vat: number;
  total: number;
  inv_slip: string | null;
  acct_slip: string | null;
  wf_no: string | null;
  card_type: string | null;
  client: string | null;
  work_amount: number | null;
  split_kjs: number;
  split_jhg: number;
  excluded: boolean;
  status: '미분류' | '제안' | '확정';
  suggest_reason: string | null;
  memo: string | null;
  decided_name: string | null;
  decided_at: string | null;
}

const num = (v: unknown) => Number(v) || 0;
const toLine = (r: Record<string, unknown>): ExpenseLine => ({
  ...(r as unknown as ExpenseLine),
  supply: num(r.supply), vat: num(r.vat), total: num(r.total),
  work_amount: r.work_amount == null ? null : num(r.work_amount),
  split_kjs: num(r.split_kjs), split_jhg: num(r.split_jhg), excluded: !!r.excluded,
});

export async function listExpenseLines(fy: number): Promise<ExpenseLine[]> {
  const out: ExpenseLine[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('expense_line').select('*').eq('fy', fy)
      .order('basket').order('writer').order('evid_date').order('exjunpyo_no').order('line_no').range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as Record<string, unknown>[]).map(toLine));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function listExpenseYears(): Promise<number[]> {
  const { data } = await supabase.from('expense_upload').select('fy');
  return [...new Set(((data ?? []) as { fy: number }[]).map((r) => r.fy))].sort((a, b) => b - a);
}

/** 적요에서 찾을 거래처 목록 + 누가 가진 거래처인가(기장팀 계약 = 기장·세무조정, 감사팀 계약 = 담당 회계사). */
export async function loadClientRefs(): Promise<ClientRef[]> {
  const [{ data: ents }, { data: cons }] = await Promise.all([
    supabase.from('biz_entity').select('id, name, corp_form, corp_form_position'),
    supabase.from('biz_sales_contract').select('entity_id, team, cpa'),
  ]);
  const owners = new Map<string, { tax: Set<string>; audit: Set<string> }>();
  for (const c of (cons ?? []) as { entity_id: string; team: string | null; cpa: string | null }[]) {
    const o = owners.get(c.entity_id) ?? { tax: new Set<string>(), audit: new Set<string>() };
    const cpa = (c.cpa || '').trim();
    // 기장팀 계약은 담당 회계사 칸이 대개 비어 있다 — 기장사업부(정우철 바구니) 거래처로 본다.
    if (c.team === 'taxteam') o.tax.add(cpa && cpa !== '법인(지정)' ? cpa : '정우철');
    else if (cpa && cpa !== '법인(지정)') o.audit.add(cpa);
    owners.set(c.entity_id, o);
  }
  return ((ents ?? []) as { id: string; name: string; corp_form: CorpForm | null; corp_form_position: '앞' | '뒤' | null }[])
    .filter((e) => (e.name || '').replace(/\s/g, '').length >= 2)
    .map((e) => {
      const o = owners.get(e.id);
      return {
        name: corpDisplayName(e.name, e.corp_form, e.corp_form_position || (e.corp_form ? '앞' : null)),
        keys: [e.name],
        taxOwners: o ? [...o.tax] : [],
        auditOwners: o ? [...o.audit] : [],
      };
    });
}

/** 확정한 줄 = 다음 제안의 근거(같은 바구니). */
export function priorFrom(lines: ExpenseLine[], basket: string): PriorDecision[] {
  return lines.filter((l) => l.basket === basket && l.status === '확정' && !l.excluded && l.client && l.work_amount != null && l.supply)
    .map((l) => ({ description: l.description, account: l.account || '', client: l.client!, workRatio: Math.max(0, Math.min(1, (l.work_amount ?? 0) / l.supply)) }));
}

export interface UploadResult { inserted: number; updated: number; kept: number; reset: number }

/**
 * 올린 줄을 그 연도에 합친다. 같은 결의서·라인이면 ERP 칸만 새로 하고 사람 판단은 둔다.
 * 확정한 줄의 공급가액이 바뀌었으면 「제안」으로 되돌려 다시 보게 한다.
 */
export async function saveExpenseUpload(
  fy: number, writer: string, basket: string, rows: ParsedExpense[], fileName: string, byName: string,
  clients: ClientRef[], existing: ExpenseLine[],
): Promise<UploadResult> {
  const { data: up, error: e1 } = await supabase.from('expense_upload').insert({
    fy, writer, basket, file_name: fileName, row_count: rows.length,
    supply_total: rows.reduce((s, r) => s + r.supply, 0), uploaded_name: byName,
  }).select('id').single();
  if (e1) throw new Error(e1.message);
  const uploadId = (up as { id: string }).id;
  const byKey = new Map(existing.map((l) => [`${l.exjunpyo_no}|${l.line_no}`, l]));
  const prior = priorFrom(existing, basket);
  const res: UploadResult = { inserted: 0, updated: 0, kept: 0, reset: 0 };
  const inserts: Record<string, unknown>[] = [];
  for (const r of rows) {
    const raw = {
      fy, basket, writer: r.writer || writer, upload_id: uploadId, exjunpyo_no: r.exjunpyoNo, line_no: r.lineNo,
      evid_date: r.evidDate, title: r.title || null, description: r.description, account: r.account || null,
      vendor: r.vendor || null, supply: r.supply, vat: r.vat, total: r.total, inv_slip: r.invSlip || null,
      acct_slip: r.acctSlip || null, wf_no: r.wfNo || null, card_type: r.cardType || null,
    };
    const old = byKey.get(`${r.exjunpyoNo}|${r.lineNo}`);
    if (old) {
      const patch: Record<string, unknown> = { ...raw };
      if (old.status === '확정' && Math.abs(old.supply - r.supply) >= 1) {
        Object.assign(patch, { status: '제안', memo: `${old.memo ? old.memo + ' / ' : ''}다시 올릴 때 공급가액이 ${old.supply.toLocaleString()} → ${r.supply.toLocaleString()} 로 바뀌어 확정을 풀었습니다` });
        res.reset++;
      } else res.kept++;
      const { error } = await supabase.from('expense_line').update(patch).eq('id', old.id);
      if (error) throw new Error(error.message);
      res.updated++;
      continue;
    }
    let s: { client: string | null; work: number | null; reason: string; excluded?: boolean; kjs?: number; jhg?: number; memo?: string | null };
    if (r.prior) {
      s = { client: r.prior.client, work: r.prior.work, reason: '작업본에 적힌 판단을 제안으로 가져옴 — 확인 후 확정', excluded: r.prior.excluded, kjs: r.prior.kjs, jhg: r.prior.jhg, memo: r.prior.memo };
    } else {
      s = suggest({ description: r.description, account: r.account, vendor: r.vendor, supply: r.supply }, basket, clients, prior);
    }
    inserts.push({
      ...raw, client: s.client, work_amount: s.excluded ? 0 : s.work, excluded: !!s.excluded,
      split_kjs: s.kjs || 0, split_jhg: s.jhg || 0, memo: s.memo || null,
      status: s.client != null && s.work != null ? '제안' : '미분류', suggest_reason: s.reason,
    });
  }
  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await supabase.from('expense_line').insert(inserts.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  res.inserted = inserts.length;
  return res;
}

export type LinePatch = Partial<Pick<ExpenseLine, 'client' | 'work_amount' | 'split_kjs' | 'split_jhg' | 'memo' | 'excluded'>>;

/** 확정하지 않은 줄의 판단 고치기 — 손으로 고치면 「제안」(근거: 직접 입력). */
export async function updateExpenseLine(id: string, patch: LinePatch): Promise<void> {
  const body: Record<string, unknown> = { ...patch };
  if ('client' in patch || 'work_amount' in patch || 'excluded' in patch) { body.status = '제안'; body.suggest_reason = '직접 입력'; }
  const { error } = await supabase.from('expense_line').update(body).eq('id', id).neq('status', '확정');
  if (error) throw new Error(error.message);
}

/** 사람이 고른 줄만 확정한다. 클라이언트·업무 금액이 비어 있거나 금액이 맞지 않는 줄은 건너뛴다. */
export async function confirmExpenseLines(lines: ExpenseLine[], byName: string): Promise<{ done: number; skipped: number }> {
  const { data: u } = await supabase.auth.getUser();
  const ok = lines.filter((l) => l.status !== '확정' && l.client && l.work_amount != null
    && l.work_amount + l.split_kjs + l.split_jhg <= l.supply + 0.5 && l.work_amount >= 0);
  for (let i = 0; i < ok.length; i += 200) {
    const { error } = await supabase.from('expense_line')
      .update({ status: '확정', decided_by: u.user?.id ?? null, decided_name: byName, decided_at: new Date().toISOString() })
      .in('id', ok.slice(i, i + 200).map((l) => l.id));
    if (error) throw new Error(error.message);
  }
  return { done: ok.length, skipped: lines.length - ok.length };
}

export async function unconfirmExpenseLine(id: string): Promise<void> {
  const { error } = await supabase.from('expense_line').update({ status: '제안', decided_by: null, decided_name: null, decided_at: null }).eq('id', id);
  if (error) throw new Error(error.message);
}

/** 확정 안 된 줄의 제안을 지금 규칙·확정 기록으로 다시 만든다(작업본에서 가져온 제안은 그대로). */
export async function resuggest(lines: ExpenseLine[], all: ExpenseLine[], clients: ClientRef[]): Promise<number> {
  let n = 0;
  for (const l of lines) {
    if (l.status === '확정' || (l.suggest_reason || '').startsWith('작업본') || l.suggest_reason === '직접 입력') continue;
    const s = suggest({ description: l.description, account: l.account || '', vendor: l.vendor || '', supply: l.supply }, l.basket, clients, priorFrom(all, l.basket));
    const { error } = await supabase.from('expense_line').update({
      client: s.client, work_amount: s.work, status: s.client != null && s.work != null ? '제안' : '미분류', suggest_reason: s.reason,
    }).eq('id', l.id).neq('status', '확정');
    if (error) throw new Error(error.message);
    n++;
  }
  return n;
}
