// 팀결산시스템 › 기장배분 — 표 읽고 쓰기(bk_settle · bk_settle_cost · bk_settle_cpa, 마이그 0176).
// 셈은 bkSettle.ts. fy = 끝나는 해(2026 = 2025.07.01 ~ 2026.06.30) — 경비귀속처리와 같은 셈.
// 인건비 계획(staff_cost)·매출 실적은 「시작하는 해」로 적혀 있다(staff_cost.fy 2025 = 2025.07~2026.06) — fy − 1 로 읽는다.
import { supabase } from './supabase';
import {
  BK_STAFF, CPAS, CPA_FIELDS, EXPENSE_ITEM, rollCosts, rollCpa,
  type CellState, type CostCell, type CpaField, type CpaRow, type Settle, type SettleBundle,
} from './bkSettle';
import { aggregateArFlow, aggregateLedger, applyWriteoffs, normName, readArFlow, readLedgerWorkbook, slipKindsByName, sumByCpa, writeoffsByName, type ArFlow, type ClientAgg, type ClientRow, type Dept, type LedgerLine } from './bkLedger';

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

// ── 거래처별 입금(ERP 부서별원장, 마이그 0177) ─────────────────────────

const CPA_SET = new Set<string>(CPAS);

export async function listClients(fy: number): Promise<ClientRow[]> {
  const { data, error } = await supabase.from('bk_settle_client').select('*').eq('fy', fy).order('name');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    dept: r.dept, code: r.code, name: r.name, cpa: r.cpa, tax_mode: r.tax_mode, mode_by_hand: r.mode_by_hand, cpa_by_hand: r.cpa_by_hand, memo: r.memo,
    cash: num(r.cash), cash_bk: num(r.cash_bk), cash_adv: num(r.cash_adv), cash_tax: num(r.cash_tax), cash_other: num(r.cash_other),
    billed_bk: num(r.billed_bk), billed_tax: num(r.billed_tax), billed_other: num(r.billed_other), writeoff: num(r.writeoff),
    ar_open: num(r.ar_open), ar_close: num(r.ar_close), source: r.source, erp_cpa: r.erp_cpa,
  }));
}

/** 자문(컨설팅) 비율 — 앱 매출 실적(기장팀, 그 해)에서 거래처마다 컨설팅 ÷ (세무조정을 뺀 전체). ERP 코드로 돌려준다. */
export async function advRatios(fy: number): Promise<Map<string, number>> {
  const [rev, pl] = await Promise.all([
    supabase.from('biz_revenue_actual').select('entity_id, category, amount').eq('team', 'taxteam').eq('settlement_year', fy - 1),
    supabase.from('biz_place').select('erp_client_code, entity_id'),
  ]);
  if (rev.error) throw new Error(rev.error.message);
  if (pl.error) throw new Error(pl.error.message);
  const by = new Map<string, { adv: number; all: number }>();
  for (const r of rev.data ?? []) {
    if (r.category === '세무조정') continue;
    const o = by.get(r.entity_id) ?? { adv: 0, all: 0 };
    o.all += num(r.amount);
    if (r.category === '컨설팅') o.adv += num(r.amount);
    by.set(r.entity_id, o);
  }
  const out = new Map<string, number>();
  for (const p of pl.data ?? []) {
    const o = p.erp_client_code ? by.get(p.entity_id) : undefined;
    if (o && o.all > 0 && o.adv > 0) out.set(p.erp_client_code, o.adv / o.all);
  }
  return out;
}

/** 담당 회계사 찾기 — ① 사업장 ERP 코드의 담당 ② 이름이 같은 거래처의 계약 담당(감사팀 계약 먼저, 최근 해 먼저). */
export async function resolveCpas(rows: ClientAgg[]): Promise<Map<string, string>> {
  const [pl, en, ct] = await Promise.all([
    supabase.from('biz_place').select('erp_client_code, cpa, entity_id, place_name'),
    supabase.from('biz_entity').select('id, name'),
    supabase.from('biz_sales_contract').select('entity_id, cpa, team, fiscal_year'),
  ]);
  for (const r of [pl, en, ct]) if (r.error) throw new Error(r.error.message);
  const byName = new Map<string, string>();
  for (const e of en.data ?? []) byName.set(normName(e.name), e.id);
  for (const p of pl.data ?? []) if (p.place_name && !byName.has(normName(p.place_name))) byName.set(normName(p.place_name), p.entity_id);
  const out = new Map<string, string>();
  for (const r of rows) {
    const p = (pl.data ?? []).find((x) => x.erp_client_code === r.code);
    if (p && CPA_SET.has(p.cpa ?? '')) { out.set(`${r.dept}|${r.code}`, p.cpa); continue; }
    const eid = p?.entity_id ?? byName.get(normName(r.name));
    const cs = (ct.data ?? []).filter((c) => c.entity_id === eid && CPA_SET.has(c.cpa ?? ''))
      .sort((a, b) => (b.team === '감사team' ? 1 : 0) - (a.team === '감사team' ? 1 : 0) || num(b.fiscal_year) - num(a.fiscal_year));
    if (cs[0]) out.set(`${r.dept}|${r.code}`, cs[0].cpa);
  }
  return out;
}

/** 원장에서 모은 줄을 저장한다. 사람이 고친 담당·구분·메모는 남긴다. fallback: 앱에서 못 찾은 담당(지난해 엑셀 등). */
export async function saveClients(fy: number, rows: ClientAgg[], byName: string, fallback: Map<string, string> = new Map(), prefer: Map<string, string | null> = new Map()): Promise<{ saved: number; noCpa: number }> {
  const [old, found, lastYear] = await Promise.all([listClients(fy), resolveCpas(rows), listClients(fy - 1)]);
  // 지난해 사람이 고른 세무조정 구분·담당은 올해 기본값으로 이어받는다(사용자 2026-10-20 「지난해처럼 자가로」).
  const prevHand = new Map(lastYear.map((r) => [`${r.dept}|${r.code}`, r]));
  const prev = new Map(old.map((r) => [`${r.dept}|${r.code}`, r]));
  const recs = rows.map((r) => {
    const k = `${r.dept}|${r.code}`;
    const o = prev.get(k);
    const ly = prevHand.get(k);
    const cpa = o?.cpa_by_hand ? o.cpa : ly?.cpa_by_hand ? ly.cpa : prefer.has(k) ? prefer.get(k)! : found.get(k) ?? fallback.get(k) ?? o?.cpa ?? null;
    return {
      fy, ...r, cpa,
      tax_mode: o?.mode_by_hand ? o.tax_mode : ly?.mode_by_hand ? ly.tax_mode : r.tax_mode,
      mode_by_hand: o?.mode_by_hand ?? false, cpa_by_hand: o?.cpa_by_hand ?? false, memo: o?.memo ?? null, updated_name: byName,
    };
  });
  for (let i = 0; i < recs.length; i += 200) {
    const { error } = await supabase.from('bk_settle_client').upsert(recs.slice(i, i + 200), { onConflict: 'fy,dept,code' });
    if (error) throw new Error(error.message);
  }
  return { saved: recs.length, noCpa: recs.filter((r) => !r.cpa).length };
}

export async function updateClient(fy: number, dept: string, code: string, patch: { cpa?: string | null; tax_mode?: '기장수행' | '자가'; memo?: string | null }, byName: string) {
  const body: Record<string, unknown> = { ...patch, updated_name: byName };
  if ('cpa' in patch) body.cpa_by_hand = true;
  if ('tax_mode' in patch) body.mode_by_hand = true;
  const { error } = await supabase.from('bk_settle_client').update(body).eq('fy', fy).eq('dept', dept).eq('code', code);
  if (error) throw new Error(error.message);
}

/**
 * 브라우저에서 ERP 엑셀을 읽어 거래처 줄로 저장한다. 두 가지를 받는다:
 *   · **기간 미수금대장**(시트 「부서별 미수금현황」, 청구서마다 계약구분) — 있으면 이것으로 계산한다(입금 성격·기초/기말 미수금이 정확).
 *   · **부서별원장**(시트 「1_외상매출금」 …) — 미수금대장이 없으면 선입선출로 추정하고, 있으면 대손(대손상각비)만 가져다 쓴다.
 * 부서(기장팀 · 감사팀)는 자료의 머리말·계정으로 가린다. 한 부서의 파일은 한꺼번에 올린다 — 이번에 없는 그 부서 거래처는 0으로 둔다(지우지 않는다).
 */
export async function importErpFiles(fy: number, files: File[], byName: string): Promise<{ dept: Dept; saved: number; noCpa: number; files: number; source: string }[]> {
  const XLSX = await import('xlsx');
  const toRows = (sh: unknown) => XLSX.utils.sheet_to_json(sh as never, { header: 1, defval: '' }) as unknown[][];
  const per = new Map<Dept, { lines: LedgerLine[]; flow: ArFlow | null; files: number }>();
  const slot = (d: Dept) => { const o = per.get(d) ?? { lines: [], flow: null, files: 0 }; per.set(d, o); return o; };
  const want = { from: `${fy - 1}-07-01`, to: `${fy}-06-30` };
  for (const file of files) {
    const wb = XLSX.read(await file.arrayBuffer());
    const flowSheet = wb.SheetNames.find((n) => /미수금현황/.test(n));
    const flow = flowSheet ? readArFlow(toRows(wb.Sheets[flowSheet])) : null;
    if (flow) {
      if (!flow.dept) throw new Error(`${file.name} — 부서(기장팀 / 2본부5팀)를 알아보지 못했습니다.`);
      if (flow.from !== want.from || flow.to !== want.to) throw new Error(`${file.name} — 기간이 ${flow.from} ~ ${flow.to} 입니다. ${want.from} ~ ${want.to} 로 받은 미수금대장을 올려 주세요.`);
      const o = slot(flow.dept); o.flow = flow; o.files++;
      continue;
    }
    const lines = readLedgerWorkbook(wb, toRows);
    if (!lines.some((x) => x.acct === '외상매출금')) throw new Error(`${file.name} — 미수금대장(부서별 미수금현황)도, 부서별원장(외상매출금 시트)도 아닙니다.`);
    const o = slot(lines.some((x) => x.acct === '기장대리수입') ? '기장팀' : '감사팀');
    o.lines.push(...lines); o.files++;
  }
  const [old, pl, en, adv] = await Promise.all([
    listClients(fy),
    supabase.from('biz_place').select('erp_client_code, place_name, entity_id'),
    supabase.from('biz_entity').select('id, name'),
    advRatios(fy),
  ]);
  if (pl.error) throw new Error(pl.error.message);
  if (en.error) throw new Error(en.error.message);
  // 거래처명 → ERP 코드: 원장에서 본 이름 → 사업장 이름 → 거래처 이름. 못 찾으면 「N:이름」.
  const code = new Map<string, string>();
  for (const r of old) if (!r.code.startsWith('N:')) code.set(normName(r.name), r.code);
  const enName = new Map((en.data ?? []).map((e) => [e.id, e.name as string]));
  for (const p of pl.data ?? []) {
    if (!p.erp_client_code) continue;
    for (const nm of [p.place_name, enName.get(p.entity_id)]) if (nm && !code.has(normName(nm))) code.set(normName(nm), p.erp_client_code);
  }
  for (const [, o] of per) for (const x of o.lines) if (x.code && !code.has(normName(x.name))) code.set(normName(x.name), x.code);
  const codeOf = (name: string) => code.get(normName(name)) ?? `N:${normName(name)}`;

  const out = [];
  for (const [dept, o] of per) {
    let rows: ClientAgg[];
    const prefer = new Map<string, string | null>();
    let source: string;
    if (o.flow) {
      let fr = aggregateArFlow(o.flow, dept, codeOf, dept === '기장팀' ? adv : new Map(), o.lines.length ? slipKindsByName(o.lines) : undefined);
      if (o.lines.length) fr = applyWriteoffs(fr, o.flow, writeoffsByName(o.lines));
      // 감사팀 미수금대장의 「회계사」 = 담당 회계사. 송현주는 정우철 바구니(사용자 2026-10-19). 우리 셋이 아니면 팀 밖 거래처라 담당 없음(배분 제외).
      if (dept === '감사팀') for (const r of fr) { const p = r.erp_cpa === '송현주' ? '정우철' : r.erp_cpa; prefer.set(`${dept}|${r.code}`, CPA_SET.has(p ?? '') ? p : null); }
      rows = fr.map((r) => ({ ...r, source: '미수금대장' }) as ClientAgg);
      source = `미수금대장${o.lines.length ? ' + 원장(대손)' : ''}`;
    } else {
      rows = aggregateLedger(o.lines, dept, dept === '기장팀' ? adv : new Map()).map((r) => ({ ...r, source: '원장' }) as ClientAgg);
      source = '원장(선입선출 추정)';
    }
    const now = new Set(rows.map((r) => r.code));
    const gone = old.filter((r) => r.dept === dept && !now.has(r.code))
      .map((r) => ({ ...r, cash: 0, cash_bk: 0, cash_adv: 0, cash_tax: 0, cash_other: 0, billed_bk: 0, billed_tax: 0, billed_other: 0, writeoff: 0, ar_open: 0, ar_close: 0 }));
    const r = await saveClients(fy, [...rows, ...gone] as ClientAgg[], byName, new Map(), prefer);
    out.push({ dept, files: o.files, source, ...r });
  }
  return out;
}

/** 거래처 줄을 회계사별로 더해 수임료 칸(기장료·기장수행·자가·자문·대손)에 「확정」으로 넣는다. 미수금 칸은 건드리지 않는다. */
export async function fillCpaFromClients(fy: number, byName: string): Promise<string[]> {
  const [cur, rows] = await Promise.all([loadSettle(fy), listClients(fy)]);
  if (!cur) throw new Error('그 해 기장배분이 없습니다.');
  const { byCpa, loose } = sumByCpa(rows);
  const depts = [...new Set(rows.map((r) => r.dept))].join('·');
  const src = `ERP 부서별원장(${depts}) 거래처 ${rows.length}곳`;
  const cpas = CPAS.map((cpa) => {
    const row = cur.cpas.find((r) => r.cpa === cpa) ?? ({ cpa, states: {}, sources: {}, memo: null, bk_fee: 0, tax_bk: 0, tax_self: 0, advisory_excl: 0, ar_open: 0, ar_close: 0, writeoff: 0 } as CpaRow);
    const v = byCpa[cpa];
    const next = { ...row, states: { ...row.states }, sources: { ...row.sources } };
    const hasAr = rows.some((r) => r.dept === '기장팀' && r.source === '미수금대장');
    for (const k of ['bk_fee', 'tax_bk', 'tax_self', 'advisory_excl', 'writeoff', ...(hasAr ? ['ar_open', 'ar_close'] as const : [])] as const) {
      next[k] = Math.round(v[k]);
      next.states[k] = '확정';
      next.sources[k] = k === 'writeoff' ? `${src} — 대손상각비 ÷ 1.1` : k === 'ar_open' || k === 'ar_close' ? `ERP 기간 미수금대장(기장팀) 거래처별 합계, VAT 제외` : src;
    }
    return next;
  });
  await writeBundle(fy, { cpas, costs: [] }, byName);
  return [`회계사별 수임료를 채웠습니다`, ...(loose.clients ? [`담당 없는 거래처 ${loose.clients}곳(입금 ${Math.round(loose.cash).toLocaleString()} · 대손 ${Math.round(loose.writeoff).toLocaleString()})은 빠졌습니다`] : [])];
}
