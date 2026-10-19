// 팀결산시스템 › 기장배분 — 표 읽고 쓰기(bk_settle · bk_settle_cost · bk_settle_cpa, 마이그 0176).
// 셈은 bkSettle.ts. fy = 끝나는 해(2026 = 2025.07.01 ~ 2026.06.30) — 경비귀속처리와 같은 셈.
// 인건비 계획(staff_cost)·매출 실적은 「시작하는 해」로 적혀 있다(staff_cost.fy 2025 = 2025.07~2026.06) — fy − 1 로 읽는다.
import { supabase } from './supabase';
import {
  BK_STAFF, CPAS, CPA_FIELDS, EXPENSE_ITEM, rollCosts, rollCpa,
  type CellState, type CostCell, type CpaField, type CpaRow, type Settle, type SettleBundle,
} from './bkSettle';

const num = (v: unknown) => Number(v ?? 0) || 0;

export async function listSettleYears(): Promise<number[]> {
  const { data, error } = await supabase.from('bk_settle').select('fy').order('fy', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => Number(r.fy));
}

export async function loadSettle(fy: number): Promise<SettleBundle | null> {
  const [s, c, k] = await Promise.all([
    supabase.from('bk_settle').select('*').eq('fy', fy).maybeSingle(),
    supabase.from('bk_settle_cpa').select('*').eq('fy', fy),
    supabase.from('bk_settle_cost').select('*').eq('fy', fy),
  ]);
  for (const r of [s, c, k]) if (r.error) throw new Error(r.error.message);
  if (!s.data) return null;
  const settle: Settle = { fy, status: s.data.status, fixed_share: num(s.data.fixed_share), common_rate: num(s.data.common_rate), note: s.data.note };
  const cpas = (c.data ?? []).map((r) => {
    const row = { cpa: r.cpa, states: r.states ?? {}, sources: r.sources ?? {}, memo: r.memo } as CpaRow;
    for (const f of CPA_FIELDS) row[f] = num(r[f]);
    return row;
  });
  const costs: CostCell[] = (k.data ?? []).map((r) => ({ item: r.item, staff: r.staff ?? '', amount: num(r.amount), state: r.state, source: r.source, memo: r.memo }));
  return { settle, cpas, costs };
}

export async function updateSettle(fy: number, patch: Partial<Pick<Settle, 'status' | 'fixed_share' | 'common_rate' | 'note'>>, byName: string) {
  const { error } = await supabase.from('bk_settle').update({ ...patch, updated_name: byName }).eq('fy', fy);
  if (error) throw new Error(error.message);
}

export async function saveCpaCell(fy: number, row: CpaRow, field: CpaField, value: number, state: CellState, source: string | null, byName: string) {
  const states = { ...row.states, [field]: state };
  const sources = { ...row.sources, [field]: source ?? undefined };
  const { error } = await supabase.from('bk_settle_cpa').update({ [field]: value, states, sources, updated_name: byName }).eq('fy', fy).eq('cpa', row.cpa);
  if (error) throw new Error(error.message);
}

export async function saveCostCell(fy: number, cell: CostCell, byName: string) {
  const { error } = await supabase.from('bk_settle_cost')
    .upsert({ fy, item: cell.item, staff: cell.staff, amount: cell.amount, state: cell.state, source: cell.source, memo: cell.memo, updated_name: byName }, { onConflict: 'fy,item,staff' });
  if (error) throw new Error(error.message);
}

async function writeBundle(fy: number, b: Omit<SettleBundle, 'settle'>, byName: string) {
  const c = await supabase.from('bk_settle_cpa').upsert(b.cpas.map((r) => {
    const o: Record<string, unknown> = { fy, cpa: r.cpa, states: r.states, sources: r.sources, memo: r.memo, updated_name: byName };
    for (const f of CPA_FIELDS) o[f] = r[f];
    return o;
  }), { onConflict: 'fy,cpa' });
  if (c.error) throw new Error(c.error.message);
  if (b.costs.length) {
    const k = await supabase.from('bk_settle_cost').upsert(b.costs.map((x) => ({ fy, ...x, updated_name: byName })), { onConflict: 'fy,item,staff' });
    if (k.error) throw new Error(k.error.message);
  }
}

// ── 앱에 이미 있는 값 ─────────────────────────────────────────────

/** 인건비 계획(직원별) → 급여+상여·퇴직급여·4대보험 「추정」. */
async function staffPlanCells(fy: number): Promise<CostCell[]> {
  const { data, error } = await supabase.from('staff_cost').select('staff_name, annual, bonus, severance, insurance').eq('fy', fy - 1).in('staff_name', BK_STAFF);
  if (error) throw new Error(error.message);
  const src = `인건비 계획(${fy - 1}.07~${fy}.06)`;
  return (data ?? []).flatMap((r) => [
    { item: '1) 급여+상여', staff: r.staff_name, amount: num(r.annual) + num(r.bonus), state: '추정' as const, source: src, memo: null },
    { item: '3) 퇴직급여', staff: r.staff_name, amount: num(r.severance), state: '추정' as const, source: src, memo: null },
    { item: '4) 복리후생비(4대보험)', staff: r.staff_name, amount: num(r.insurance), state: '추정' as const, source: src, memo: '회사부담분 별도 확인 필요' },
  ]);
}

/** 경비귀속처리 — 정우철 바구니(송현주 포함) 「기장」 업무 금액. */
async function expenseCell(fy: number): Promise<CostCell | null> {
  const { data, error } = await supabase.from('expense_line').select('work_amount, status, excluded').eq('fy', fy).eq('basket', '정우철').eq('client', '기장');
  if (error) throw new Error(error.message);
  if (!data?.length) return null;
  const rows = data.filter((r) => !r.excluded);
  const amount = rows.reduce((s, r) => s + num(r.work_amount), 0);
  const all = rows.every((r) => r.status === '확정');
  return { item: EXPENSE_ITEM, staff: '', amount, state: all ? '확정' : '추정', source: `경비귀속처리 「기장」 ${rows.length}줄${all ? '' : '(확정 안 된 줄 있음)'}`, memo: null };
}

/** 기말 미수금 — 기장팀 기초 미수금(그 해 6월말 = 다음 해 7/1 기초), 사업장 담당 회계사별, VAT 제외. */
async function arCloseByCpa(fy: number): Promise<Map<string, number> | null> {
  const { data, error } = await supabase.from('biz_receivable_opening').select('amount, biz_place!inner(cpa)').eq('team', 'taxteam').eq('as_of', `${fy}-07-01`);
  if (error) throw new Error(error.message);
  if (!data?.length) return null;
  const m = new Map<string, number>();
  for (const r of data as unknown as { amount: number; biz_place: { cpa: string | null } }[]) {
    const k = r.biz_place?.cpa ?? '';
    m.set(k, (m.get(k) ?? 0) + num(r.amount));
  }
  return m;
}

/** 예상안에 앱 값을 얹는다. 사람이 「확정」으로 바꾼 칸(출처가 앱이 아닌 것)은 건드리지 않는다. */
async function overlayApp(fy: number, cpas: CpaRow[], costs: CostCell[]): Promise<{ cpas: CpaRow[]; costs: CostCell[]; notes: string[] }> {
  const notes: string[] = [];
  const keep = (c?: CostCell) => c && c.state === '확정' && !(c.source ?? '').startsWith('인건비 계획') && !(c.source ?? '').startsWith('경비귀속처리');
  const put = (cell: CostCell) => {
    const i = costs.findIndex((c) => c.item === cell.item && c.staff === cell.staff);
    if (keep(costs[i])) return;
    if (i >= 0) costs[i] = cell; else costs.push(cell);
  };
  const plan = await staffPlanCells(fy);
  plan.forEach(put);
  notes.push(plan.length ? `인건비 계획 ${plan.length / 3}명` : '인건비 계획 없음 — 작년값 그대로');
  const ex = await expenseCell(fy);
  if (ex) { put(ex); notes.push(`경비귀속처리 기장 ${Math.round(ex.amount).toLocaleString()}`); } else notes.push('경비귀속처리 자료 없음 — 작년값 그대로');
  const ar = await arCloseByCpa(fy);
  if (ar) {
    for (const r of cpas) {
      if (r.states.ar_close === '확정' && !(r.sources.ar_close ?? '').startsWith('앱 기초 미수금')) continue;
      r.ar_close = Math.round(ar.get(r.cpa) ?? 0);
      r.states = { ...r.states, ar_close: '확정' };
      r.sources = { ...r.sources, ar_close: `앱 기초 미수금 ${fy}-07-01(기장팀, VAT 제외)` };
    }
    notes.push('기말 미수금 = 앱 기초 미수금');
  } else notes.push(`${fy}-07-01 기초 미수금 없음 — 기말 미수금 비어 있음`);
  return { cpas, costs, notes };
}

/** 지난해 값으로 새 해 예상안을 만든다(+ 앱 값 얹기). 이미 있으면 만들지 않는다. */
export async function createEstimate(fy: number, byName: string): Promise<string[]> {
  const prev = await loadSettle(fy - 1);
  if (!prev) throw new Error(`지난해(${fy - 1}) 기장배분이 없어 예상안을 만들 수 없습니다.`);
  const ins = await supabase.from('bk_settle').insert({ fy, status: '예상', fixed_share: prev.settle.fixed_share, common_rate: prev.settle.common_rate, updated_name: byName });
  if (ins.error) throw new Error(ins.error.code === '23505' ? '이미 그 해 기장배분이 있습니다.' : ins.error.message);
  const r = await overlayApp(fy, rollCpa(prev.cpas), rollCosts(prev.costs));
  await writeBundle(fy, r, byName);
  return r.notes;
}

/** 앱 값(인건비 계획·경비귀속처리·기말 미수금)을 다시 가져온다. */
export async function refreshFromApp(fy: number, byName: string): Promise<string[]> {
  const cur = await loadSettle(fy);
  if (!cur) throw new Error('그 해 기장배분이 없습니다.');
  const r = await overlayApp(fy, cur.cpas.length ? cur.cpas : CPAS.map((cpa) => ({ cpa, states: {}, sources: {}, memo: null, bk_fee: 0, tax_bk: 0, tax_self: 0, advisory_excl: 0, ar_open: 0, ar_close: 0, writeoff: 0 })), cur.costs);
  await writeBundle(fy, r, byName);
  return r.notes;
}
