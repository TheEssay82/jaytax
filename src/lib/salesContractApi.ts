// 매출계약(biz_sales_contract) + 위성(담당직원·분할·할인) 데이터 접근 레이어. 거래처관리 2.0.0 step2.
import { supabase, assertWrote } from './supabase';
import { typeMnemonic, teamCode, type Team } from './salesContractTaxonomy';
import { settlementYearOfDate, pickTaxFilingContract, type TaxFilingRow } from './fiscalYear';
import { buildStaffIndex, resolveStaff, staffActiveOn as staffActiveOnRow } from './contractStaff';

export type OccurrenceUnit = '사업장' | '법인' | '개인';
export type BillingUnit = '사업장' | '법인' | '개인' | '건';
export type BillingCycle = '월' | '분기' | '반기' | '연' | '발생시' | '건';
export type AdvisoryType = '일반' | '전문';
export const BILLING_CYCLES: BillingCycle[] = ['월', '분기', '반기', '연', '발생시', '건'];

// ── 정산연도(귀속연도) 규칙 ──────────────────────────────
// 규칙 본체는 fiscalYear.ts 에 있다(supabase 를 물지 않아야 테스트가 돈다). 여기서 다시 내보낸다.
export { settlementYearOfDate, pickTaxFilingContract } from './fiscalYear';
export type { TaxFilingRow } from './fiscalYear';
// 계약의 귀속(정산)연도: 명시 fiscalYear 우선, 없으면 종료시점에서 도출(일회성 감사·컨설팅·신고).
// 기장 등 계속거래(종료 없음)는 계약 단위 귀속이 없어 null(귀속은 월 청구/발생 단계에서 적용).
export function contractFiscalYear(c: { fiscalYear: number | null; endDate: string | null }): number | null {
  return c.fiscalYear ?? settlementYearOfDate(c.endDate);
}
// 팀별 담당직원 후보(#10) · 담당CPA 후보. 입사·변경 시 여기만 수정.
export const AUDIT_STAFF = ['정우철', '김준성', '조현규', '송현주'] as const;   // 감사team 담당직원=CPA
export const TAX_STAFF = ['정남지', '김민섭', '김동주', '송현주'] as const;      // taxteam 담당직원=기장팀
export const CPA_LIST = ['정우철', '조현규', '김준성', '송현주', '법인(지정)'] as const; // 담당CPA 후보 · '법인(지정)'=지정감사(개인 담당 없이 법인 배정)
export function staffCandidatesForTeam(team: Team): readonly string[] { return team === '감사team' ? AUDIT_STAFF : TAX_STAFF; }

export interface StaffProfileLite { id: string; name: string }
/** 매출계약 담당직원 후보 프로필(감사·기장 관련 이름만). */
export async function listContractStaffProfiles(): Promise<StaffProfileLite[]> {
  const names = Array.from(new Set([...AUDIT_STAFF, ...TAX_STAFF]));
  const { data, error } = await supabase.from('profiles').select('id, name').in('name', names);
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data as any[]).map((r) => ({ id: r.id, name: (r.name || '').trim() }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export interface ContractStaff {
  id: string; contractId: string; staffId: string; staffName: string; active: boolean;
  /** 담당 시작 귀속월(YYYY-MM-01). null=처음부터 */
  fromMonth: string | null;
  /** 담당 종료 귀속월(YYYY-MM-01, 포함). null=현재까지 */
  toMonth: string | null;
}
/** 담당직원 이력을 귀속월로 관리하는 대상 — 매월 청구하는 taxteam 계약(기장 등). */
export function staffHistoryApplies(c: { team: Team; billingCycle: BillingCycle }): boolean {
  return c.team === 'taxteam' && c.billingCycle === '월';
}
/**
 * 그 달(YYYY-MM)에 유효한 담당직원인지.
 * 판정은 contractStaff.ts 에 있다 — 규칙이 두 벌이 되면 한쪽만 고쳐 어긋난다.
 */
export const staffActiveOn = (s: ContractStaff, month: string): boolean => staffActiveOnRow(s, month);
export interface Installment { id?: string; seq: number; label: string; amount: number; dueDate: string | null; conditionNote: string; billedAt?: string | null }
export interface Discount { id?: string; discType: '무료' | '할인'; startDate: string | null; endDate: string | null; rate: number | null; amount: number | null; note: string }

export interface SalesContract {
  id: string;
  entityId: string;
  placeId: string | null;
  occurrenceUnit: OccurrenceUnit;
  billingUnit: BillingUnit | null;
  team: Team;
  categoryCode: string;
  categoryEtcName: string;
  includesVat: boolean;
  includesWht: boolean;
  advisoryType: AdvisoryType | null;
  parentContractId: string | null;
  fiscalYear: number | null;
  billingCycle: BillingCycle;
  isInstallment: boolean;
  amount: number;
  cpa: string;
  contractDate: string | null;
  startDate: string | null;
  endDate: string | null;
  note: string;
  /** 매출계약코드(자동생성). 거래처-사업장-자동갱신(R/F)-유형-팀-시작연도-순번. */
  contractCode: string;
  /** 복합계약 포함유형(부수) leaf code 목록. 대표 유형(categoryCode)과 별개. */
  includedCodes: string[];
  /** 개시/종료 추정 여부(정보관리 2026-07 이전 등). */
  dateEstimated: boolean;
  /** 계약확정 여부. false = 미계약(예산 반영용 예정 계약) */
  confirmed: boolean;
  /** 연 1회 계약의 청구월(1~12). null = 개시월 기준(기존 동작) */
  billingMonth: number | null;
  staff: ContractStaff[];
  installments: Installment[];
  discounts: Discount[];
  /** 실제로 쓸 담당CPA — 계약에 적혀 있으면 그 값, 비어 있으면 거래처(사업장)에서 상속. */
  effectiveCpa: string;
  /** effectiveCpa 가 상속값인지(계약에 직접 적힌 값이 아님). */
  cpaInherited: boolean;
  /** 담당직원 전체 이력(기간 포함). staff 는 조회시점에 유효한 것만. */
  staffHistory: ContractStaff[];
  /** 실제로 쓸 담당직원 — 계약에 있으면 그 값, 없으면 거래처(사업장)에서 상속. */
  effectiveStaff: { staffId: string; staffName: string }[];
  /** effectiveStaff 가 상속값인지. */
  staffInherited: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const toContract = (r: any): SalesContract => ({
  id: r.id, entityId: r.entity_id, placeId: r.place_id, occurrenceUnit: r.occurrence_unit,
  billingUnit: r.billing_unit, team: r.team, categoryCode: r.category_code, categoryEtcName: r.category_etc_name || '',
  includesVat: !!r.includes_vat, includesWht: !!r.includes_wht, advisoryType: r.advisory_type,
  parentContractId: r.parent_contract_id, fiscalYear: r.fiscal_year, billingCycle: r.billing_cycle,
  isInstallment: !!r.is_installment, amount: r.amount != null ? Number(r.amount) : 0, cpa: r.cpa || '',
  contractDate: r.contract_date, startDate: r.start_date, endDate: r.end_date, note: r.note || '',
  contractCode: r.contract_code || '', includedCodes: r.included_codes || [], dateEstimated: !!r.date_estimated,
  confirmed: r.confirmed !== false, billingMonth: r.billing_month ?? null,
  staff: [], installments: [], discounts: [], effectiveCpa: r.cpa || '', cpaInherited: false,
  staffHistory: [], effectiveStaff: [], staffInherited: false,
  createdAt: r.created_at, updatedAt: r.updated_at,
});
const toStaff = (r: any): ContractStaff => ({ id: r.id, contractId: r.contract_id, staffId: r.staff_id, staffName: r.staff_name || '', active: !!r.active, fromMonth: r.from_month ?? null, toMonth: r.to_month ?? null });
const toInst = (r: any): Installment => ({ id: r.id, seq: r.seq ?? 1, label: r.label || '', amount: r.amount != null ? Number(r.amount) : 0, dueDate: r.due_date, conditionNote: r.condition_note || '', billedAt: r.billed_at ?? null });
const toDisc = (r: any): Discount => ({ id: r.id, discType: r.disc_type, startDate: r.start_date, endDate: r.end_date, rate: r.rate != null ? Number(r.rate) : null, amount: r.amount != null ? Number(r.amount) : null, note: r.note || '' });
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 전체 매출계약 조립 조회. */
export async function listSalesContracts(): Promise<SalesContract[]> {
  const [con, stf, inst, disc] = await Promise.all([
    supabase.from('biz_sales_contract').select('*').order('created_at', { ascending: false }),
    supabase.from('biz_contract_staff').select('*').eq('active', true),   // 이력 포함(기간으로 걸러 쓴다)
    supabase.from('biz_contract_installment').select('*').order('seq'),
    supabase.from('biz_contract_discount').select('*'),
  ]);
  for (const r of [con, stf, inst, disc]) if (r.error) throw new Error(r.error.message);
  // 담당CPA 는 계약에 비어 있으면 거래처(사업장)에서 상속한다 — 폼 안내('거래처 CPA 상속·수정')대로.
  // 계약에 직접 적힌 값이 있으면 그게 우선(계약별 override).
  const { data: pl, error: ple } = await supabase.from('biz_place').select('id, entity_id, cpa, is_headquarters');
  if (ple) throw new Error(ple.message);
  const cpaByEntity = new Map<string, string>();
  // 담당직원도 같은 원칙 — 계약에 없으면 사업장(계약에 달린 사업장 → 본사 → 아무 사업장)에서 상속한다.
  const { data: ps, error: pse } = await supabase
    .from('biz_place_staff').select('place_id, staff_id, staff_name').eq('active', true);
  if (pse) throw new Error(pse.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  for (const p of (pl as any[]) ?? []) {
    const v = (p.cpa || '').trim();
    if (!v) continue;
    if (p.is_headquarters || !cpaByEntity.has(p.entity_id)) cpaByEntity.set(p.entity_id, v);
  }
  // 담당직원 판정(active 걸러내기·상속 순서)은 contractStaff.ts 한 곳에 있다.
  // 여기서 직접 짜지 않는다 — 규칙이 두 벌이 되면 한쪽만 고쳐 어긋난다.
  const staffIndex = buildStaffIndex(
    ((pl as any[]) ?? []).map((p) => ({ id: p.id, entityId: p.entity_id, isHeadquarters: !!p.is_headquarters })),
    ((ps as any[]) ?? []).map((r) => ({
      placeId: r.place_id, staffId: r.staff_id, staffName: r.staff_name || '', active: r.active,
    })),
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const byC = <T,>(rows: any[], map: (r: any) => T & { contractId?: string }, key = 'contract_id') => {
    const m = new Map<string, T[]>();
    for (const raw of rows) { const v = map(raw); (m.get(raw[key]) ?? m.set(raw[key], []).get(raw[key])!).push(v); }
    return m;
  };
  const sM = byC(stf.data as any[], toStaff);
  const iM = byC(inst.data as any[], toInst);
  const dM = byC(disc.data as any[], toDisc);
  const nowMonth = new Date().toISOString().slice(0, 7);
  return (con.data as any[]).map(toContract).map((c) => {
    const inherited = !c.cpa ? cpaByEntity.get(c.entityId) ?? '' : '';
    const history = sM.get(c.id) ?? [];
    // 조회시점(이번 달) 기준. 계약 우선 → 없으면 사업장 상속(계약 사업장 → 본사 → 나머지).
    const current = history.filter((s) => staffActiveOn(s, nowMonth));
    const resolved = resolveStaff(
      { entityId: c.entityId, placeId: c.placeId, staff: history }, staffIndex, nowMonth);
    return {
      ...c, staff: current, installments: iM.get(c.id) ?? [], discounts: dM.get(c.id) ?? [],
      effectiveCpa: c.cpa || inherited, cpaInherited: !c.cpa && !!inherited,
      staffHistory: history,
      effectiveStaff: resolved.staff,
      staffInherited: resolved.inherited,
    };
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * 사업장별 '최근 매출계약의 담당직원' — place_id → 담당직원명[].
 * 거래처등록 화면에서 담당직원을 '가장 최근 배정된 계약 담당직원'으로 표시하기 위한 경량 조회.
 * biz_contract_staff.created_at(배정 시각) 최신 배치를 사업장별로 하나 취한다(로그 개념).
 */
export async function listPlaceContractStaff(): Promise<Map<string, string[]>> {
  const [con, stf] = await Promise.all([
    supabase.from('biz_sales_contract').select('id, place_id'),
    supabase.from('biz_contract_staff').select('contract_id, staff_name, created_at').eq('active', true).order('created_at', { ascending: false }),
  ]);
  if (con.error) throw new Error(con.error.message);
  if (stf.error) throw new Error(stf.error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const placeByContract = new Map<string, string>();
  for (const c of con.data as any[]) placeByContract.set(c.id, c.place_id);
  const bestByPlace = new Map<string, string>();     // place_id → 최신 배정 계약 id
  const namesByContract = new Map<string, string[]>();
  for (const s of stf.data as any[]) {                // created_at desc → 사업장별 첫 계약이 최신
    const placeId = placeByContract.get(s.contract_id);
    if (!placeId) continue;
    if (!bestByPlace.has(placeId)) bestByPlace.set(placeId, s.contract_id);
    if (bestByPlace.get(placeId) === s.contract_id && s.staff_name) {
      const arr = namesByContract.get(s.contract_id) ?? [];
      arr.push(s.staff_name);
      namesByContract.set(s.contract_id, arr);
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const result = new Map<string, string[]>();
  for (const [placeId, contractId] of bestByPlace) {
    const names = namesByContract.get(contractId) ?? [];
    if (names.length) result.set(placeId, names);
  }
  return result;
}

export interface ContractInput {
  entityId: string; placeId?: string | null; occurrenceUnit: OccurrenceUnit; billingUnit?: BillingUnit | null;
  team: Team; categoryCode: string; categoryEtcName?: string; includesVat?: boolean; includesWht?: boolean;
  advisoryType?: AdvisoryType | null; parentContractId?: string | null; fiscalYear?: number | null;
  billingCycle: BillingCycle; isInstallment?: boolean; amount: number; cpa?: string;
  contractDate?: string | null; startDate?: string | null; endDate?: string | null; note?: string;
  includedCodes?: string[]; dateEstimated?: boolean; confirmed?: boolean; billingMonth?: number | null;
}
function toRow(c: Partial<ContractInput>): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => { if (v !== undefined) r[k] = v; };
  set('entity_id', c.entityId); set('place_id', c.placeId ?? undefined); set('occurrence_unit', c.occurrenceUnit);
  set('billing_unit', c.billingUnit ?? undefined); set('team', c.team); set('category_code', c.categoryCode);
  set('category_etc_name', c.categoryEtcName); set('includes_vat', c.includesVat); set('includes_wht', c.includesWht);
  set('advisory_type', c.advisoryType ?? undefined); set('parent_contract_id', c.parentContractId ?? undefined);
  set('fiscal_year', c.fiscalYear ?? undefined); set('billing_cycle', c.billingCycle); set('is_installment', c.isInstallment);
  set('amount', c.amount); set('cpa', c.cpa); set('contract_date', c.contractDate ?? undefined);
  set('start_date', c.startDate ?? undefined); set('end_date', c.endDate ?? undefined); set('note', c.note);
  set('included_codes', c.includedCodes); set('date_estimated', c.dateEstimated); set('confirmed', c.confirmed); set('billing_month', c.billingMonth ?? undefined);
  return r;
}

/** 매출계약코드 베이스(순번 제외) 생성 — 거래처-사업장-자동갱신-유형-팀-시작연도. */
export function contractCodeBase(o: {
  entityCode: string; placeNo: number | null; occurrenceUnit: OccurrenceUnit;
  endDate: string | null; categoryCode: string; team: Team; year: number | string;
}): string {
  const pcode = o.occurrenceUnit === '사업장' ? String(o.placeNo ?? 0).padStart(2, '0') : '00';
  const renew = o.endDate ? 'F' : 'R';
  return `${o.entityCode}-${pcode}-${renew}-${typeMnemonic(o.categoryCode)}-${teamCode(o.team)}-${o.year}`;
}

/** 신규 계약 매출계약코드 자동생성(순번 채번). 거래처/사업장 조회 후 base+seq. */
async function genContractCode(input: ContractInput): Promise<string | undefined> {
  const { data: e } = await supabase.from('biz_entity').select('code').eq('id', input.entityId).single();
  const entityCode = (e as { code?: string } | null)?.code;
  if (!entityCode) return undefined;
  let placeNo: number | null = null;
  if (input.placeId) {
    const { data: p } = await supabase.from('biz_place').select('place_no').eq('id', input.placeId).single();
    placeNo = (p as { place_no?: number } | null)?.place_no ?? null;
  }
  const year = input.startDate?.slice(0, 4) || (input.fiscalYear ? String(input.fiscalYear) : String(new Date().getFullYear()));
  const base = contractCodeBase({ entityCode, placeNo, occurrenceUnit: input.occurrenceUnit, endDate: input.endDate ?? null, categoryCode: input.categoryCode, team: input.team, year });
  const { data: ex } = await supabase.from('biz_sales_contract').select('contract_code').like('contract_code', base + '-%');
  let maxSeq = 0;
  for (const r of (ex as { contract_code?: string }[] | null) ?? []) { const m = /-(\d+)$/.exec(r.contract_code || ''); if (m) maxSeq = Math.max(maxSeq, Number(m[1])); }
  return `${base}-${String(maxSeq + 1).padStart(2, '0')}`;
}

/** 매출계약코드가 비어 있는 계약에 코드를 일괄 부여한다(최고관리자 정리용).
 *  SQL 로 직접 적재한 계약은 앱의 생성 경로를 타지 않아 코드가 비어 있다.
 *  규칙이 두 벌이 되지 않도록 contractCodeBase 를 그대로 쓴다. */
export interface CodeBackfillResult { updated: number; skipped: number; failed: { id: string; error: string }[] }

export async function backfillContractCodes(): Promise<CodeBackfillResult> {
  const res: CodeBackfillResult = { updated: 0, skipped: 0, failed: [] };
  const [rows, ents, places, all] = await Promise.all([
    supabase.from('biz_sales_contract')
      .select('id, entity_id, place_id, occurrence_unit, category_code, team, start_date, end_date, fiscal_year')
      .or('contract_code.is.null,contract_code.eq.')
      .order('created_at'),
    supabase.from('biz_entity').select('id, code'),
    supabase.from('biz_place').select('id, place_no'),
    supabase.from('biz_sales_contract').select('contract_code').not('contract_code', 'is', null),
  ]);
  for (const r of [rows, ents, places, all]) if (r.error) throw new Error(r.error.message);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const entCode = new Map((ents.data as any[]).map((e) => [e.id as string, e.code as string]));
  const placeNo = new Map((places.data as any[]).map((p) => [p.id as string, p.place_no as number]));
  // 같은 base 안에서 순번이 겹치지 않도록 기존 최대순번을 미리 모아 둔다.
  const maxSeq = new Map<string, number>();
  for (const r of all.data as any[]) {
    const code = (r.contract_code as string) || '';
    const m = /^(.*)-(\d+)$/.exec(code);
    if (m) maxSeq.set(m[1], Math.max(maxSeq.get(m[1]) ?? 0, Number(m[2])));
  }

  for (const c of rows.data as any[]) {
    const entityCode = entCode.get(c.entity_id as string);
    if (!entityCode) { res.skipped++; continue; }
    const year = (c.start_date as string | null)?.slice(0, 4) || (c.fiscal_year ? String(c.fiscal_year) : '');
    if (!year) { res.skipped++; continue; }
    const base = contractCodeBase({
      entityCode,
      placeNo: c.place_id ? placeNo.get(c.place_id as string) ?? null : null,
      occurrenceUnit: c.occurrence_unit as OccurrenceUnit,
      endDate: (c.end_date as string | null) ?? null,
      categoryCode: c.category_code as string,
      team: c.team as Team,
      year,
    });
    const seq = (maxSeq.get(base) ?? 0) + 1;
    maxSeq.set(base, seq);
    const code = `${base}-${String(seq).padStart(2, '0')}`;
    const { error } = await supabase.from('biz_sales_contract').update({ contract_code: code }).eq('id', c.id);
    if (error) res.failed.push({ id: c.id as string, error: error.message });
    else res.updated++;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return res;
}

// ── 전년 세무조정 계약 갱신 ────────────────────────────────
// 세무조정(법인세·종합소득세)은 귀속연도가 고정된 재계약형이라 해마다 새로 등록해야 한다.
// 기장처럼 종료일 없는 계속계약이 아니어서, 전년 계약을 다음 해로 복제하는 창구가 필요하다.

export interface RenewCandidate {
  id: string;
  contractCode: string;
  entityId: string;
  placeId: string | null;
  code: string;               // 거래처코드
  companyName: string;
  taxType: '법인세' | '종합소득세';
  amount: number;
  cpa: string;                // 담당CPA(계약값 우선, 없으면 사업장 상속)
  placeStatus: string;        // 사업장 상태(폐업·이관이면 기본 제외)
  alreadyRenewed: boolean;    // 대상연도 계약이 이미 있음
}

/** fromYear 귀속 세무조정 계약을 toYear 로 갱신할 후보 목록 */
export async function listRenewableTaxContracts(fromYear: number, toYear: number): Promise<RenewCandidate[]> {
  const all = await listSalesContracts();
  const TAX = ['TAX.FILING.CORP', 'TAX.FILING.INCOME'];
  const src = all.filter((c) => TAX.includes(c.categoryCode) && Number(c.fiscalYear) === fromYear);
  const done = new Set(
    all.filter((c) => TAX.includes(c.categoryCode) && Number(c.fiscalYear) === toYear)
       .map((c) => `${c.entityId}|${c.categoryCode}`),
  );

  const { data: ents, error: ee } = await supabase.from('biz_entity').select('id, code, name, corp_form, corp_form_position');
  if (ee) throw new Error(ee.message);
  const { data: pls, error: pe } = await supabase.from('biz_place').select('id, entity_id, status, is_headquarters');
  if (pe) throw new Error(pe.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const sym: Record<string, string> = { 주식회사: '㈜', 유한회사: '(유)', 유한책임회사: '(유책)', 합자회사: '(합자)', 합명회사: '(합명)' };
  const entMap = new Map((ents as any[]).map((e) => {
    const mark = e.corp_form ? sym[e.corp_form] ?? '' : '';
    const name = !mark || !e.corp_form_position ? (e.name || '')
      : e.corp_form_position === '앞' ? mark + (e.name || '') : (e.name || '') + mark;
    return [e.id as string, { code: e.code as string, name }];
  }));
  const places = pls as any[];
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return src.map((c) => {
    const e = entMap.get(c.entityId);
    const mine = places.filter((p) => p.entity_id === c.entityId);
    const place = mine.find((p) => p.id === c.placeId) ?? mine.find((p) => p.is_headquarters) ?? mine[0];
    return {
      id: c.id,
      contractCode: c.contractCode,
      entityId: c.entityId,
      placeId: c.placeId,
      code: e?.code ?? '',
      companyName: e?.name ?? '',
      taxType: (c.categoryCode === 'TAX.FILING.CORP' ? '법인세' : '종합소득세') as '법인세' | '종합소득세',
      amount: c.amount,
      cpa: c.effectiveCpa,
      placeStatus: place?.status ?? '정상',
      alreadyRenewed: done.has(`${c.entityId}|${c.categoryCode}`),
    };
  }).sort((a, b) => a.companyName.localeCompare(b.companyName, 'ko'));
}

/** 선택한 전년 계약을 toYear 귀속으로 복제 — 생성 건수 반환 */
export async function renewTaxContracts(rows: RenewCandidate[], toYear: number): Promise<number> {
  const all = await listSalesContracts();
  const byId = new Map(all.map((c) => [c.id, c]));
  let made = 0;
  for (const r of rows) {
    if (r.alreadyRenewed) continue;
    const src = byId.get(r.id);
    if (!src) continue;
    const newId = await createSalesContract({
      entityId: src.entityId,
      placeId: src.placeId,
      team: src.team,
      categoryCode: src.categoryCode,
      occurrenceUnit: src.occurrenceUnit,
      billingUnit: src.billingUnit,
      billingCycle: src.billingCycle,
      amount: src.amount,
      cpa: src.cpa,                       // 원본이 비어 있으면 그대로 비워 상속을 유지한다
      fiscalYear: toYear,
      startDate: `${toYear}-07-01`,
      endDate: `${toYear + 1}-06-01`,
      includesVat: src.includesVat,
      includesWht: src.includesWht,
      confirmed: false,                   // 갱신분은 아직 체결 전 — 미계약으로 시작
      billingMonth: src.billingMonth,     // 청구월(법인세 3월·소득세 5월/성실 6월)은 그대로 이어받는다
      note: `${fromLabel(src.fiscalYear)} 계약 갱신`,
    });
    // 계약에 직접 지정된 담당직원이 있으면 이어받는다(상속분은 자동으로 따라오므로 건드리지 않는다).
    if (src.staff.length) await saveContractStaff(newId, src.staff.map((x) => ({ staffId: x.staffId, staffName: x.staffName })));
    made++;
  }
  return made;
}
const fromLabel = (y: number | null) => (y ? `${y}년 귀속` : '전년');

export async function createSalesContract(input: ContractInput): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  const row = toRow(input);
  if (row.contract_code === undefined) row.contract_code = await genContractCode(input);
  if (row.date_estimated === undefined && input.startDate) row.date_estimated = input.startDate < '2026-07';
  const { data, error } = await supabase.from('biz_sales_contract').insert({ ...row, created_by: u.user?.id ?? null }).select('id').single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}
export async function updateSalesContract(id: string, patch: Partial<ContractInput>): Promise<void> {
  const { data, error } = await supabase.from('biz_sales_contract').update(toRow(patch)).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '저장');
}
export async function deleteSalesContract(id: string): Promise<void> {
  const { data, error } = await supabase.from('biz_sales_contract').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '삭제');
}

/** 분할 회차 교체(전체 삭제 후 재삽입). */
export async function saveInstallments(contractId: string, rows: Installment[]): Promise<void> {
  const del = await supabase.from('biz_contract_installment').delete().eq('contract_id', contractId);
  if (del.error) throw new Error(del.error.message);
  if (!rows.length) return;
  const ins = await supabase.from('biz_contract_installment').insert(
    rows.map((x, i) => ({ contract_id: contractId, seq: x.seq || i + 1, label: x.label, amount: x.amount, due_date: x.dueDate || null, condition_note: x.conditionNote || null, billed_at: x.billedAt || null })),
  );
  if (ins.error) throw new Error(ins.error.message);
}

/** 분할 회차 청구완료(확인) 토글 — 알람 CONFIRM. billed=true면 지금 시각 기록, false면 해제. */
export async function setInstallmentBilled(id: string, billed: boolean): Promise<void> {
  const { data, error } = await supabase.from('biz_contract_installment')
    .update({ billed_at: billed ? new Date().toISOString() : null }).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '청구확인');
}
/** 무료/할인 구간 교체. */
export async function saveDiscounts(contractId: string, rows: Discount[]): Promise<void> {
  const del = await supabase.from('biz_contract_discount').delete().eq('contract_id', contractId);
  if (del.error) throw new Error(del.error.message);
  if (!rows.length) return;
  const ins = await supabase.from('biz_contract_discount').insert(
    rows.map((x) => ({ contract_id: contractId, disc_type: x.discType, start_date: x.startDate || null, end_date: x.endDate || null, rate: x.rate, amount: x.amount, note: x.note || null })),
  );
  if (ins.error) throw new Error(ins.error.message);
}
/** 계약 담당직원 교체(활성 전부 삭제 후 재삽입). */
/**
 * 담당직원을 '적용 귀속월'부터 교체한다(매월 청구하는 taxteam 계약용).
 * 기존 담당은 지우지 않고 그 전월까지로 닫아서, 지난 달 청구가 누구 담당이었는지 남는다.
 *  · applyMonth 는 'YYYY-MM'. 그 달부터 새 담당이 유효하다.
 *  · 같은 달에 이미 시작한 행은 이력을 남길 게 없으므로 지우고 다시 넣는다.
 */
export async function changeContractStaffFrom(
  contractId: string,
  staff: { staffId: string; staffName: string }[],
  applyMonth: string,
): Promise<void> {
  const from = `${applyMonth}-01`;
  const prevEnd = (() => {
    const [y, m] = applyMonth.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 2, 1));           // 적용월의 전월
    return d.toISOString().slice(0, 10);
  })();

  const { data: cur, error } = await supabase
    .from('biz_contract_staff').select('id, from_month').eq('contract_id', contractId).eq('active', true);
  if (error) throw new Error(error.message);

  for (const r of (cur as { id: string; from_month: string | null }[]) ?? []) {
    if (r.from_month && r.from_month >= from) {
      // 적용월 이후에 시작한 행 = 아직 청구 이력이 없는 예약분이라 지운다.
      const del = await supabase.from('biz_contract_staff').delete().eq('id', r.id);
      if (del.error) throw new Error(del.error.message);
    } else {
      const upd = await supabase.from('biz_contract_staff').update({ to_month: prevEnd }).eq('id', r.id);
      if (upd.error) throw new Error(upd.error.message);
    }
  }
  if (!staff.length) return;
  const { data: u } = await supabase.auth.getUser();
  const ins = await supabase.from('biz_contract_staff').insert(
    staff.map((s) => ({
      contract_id: contractId, staff_id: s.staffId, staff_name: s.staffName,
      active: true, from_month: from, to_month: null, created_by: u.user?.id ?? null,
    })),
  );
  if (ins.error) throw new Error(ins.error.message);
}

/**
 * 현재 담당직원 교체(이력 없이). 닫힌 이력 행(to_month 있음)은 건드리지 않는다 —
 * Excel 일괄등록이나 일반 수정이 지난 담당 기록까지 지우면 안 되기 때문이다.
 * 닫힌 이력이 있으면 새 담당은 그 다음 달부터 시작한 것으로 본다.
 */
export async function saveContractStaff(contractId: string, staff: { staffId: string; staffName: string }[]): Promise<void> {
  const { data: cur, error: se } = await supabase
    .from('biz_contract_staff').select('id, to_month').eq('contract_id', contractId);
  if (se) throw new Error(se.message);
  const rows = (cur as { id: string; to_month: string | null }[]) ?? [];
  const openIds = rows.filter((r) => !r.to_month).map((r) => r.id);
  if (openIds.length) {
    const del = await supabase.from('biz_contract_staff').delete().in('id', openIds);
    if (del.error) throw new Error(del.error.message);
  }
  if (!staff.length) return;

  // 닫힌 이력이 있으면 그 다음 달부터 이어붙인다(구멍이 생기지 않게).
  const lastClosed = rows.map((r) => r.to_month).filter((v): v is string => !!v).sort().pop() ?? null;
  let fromMonth: string | null = null;
  if (lastClosed) {
    const [y, m] = lastClosed.slice(0, 7).split('-').map(Number);
    fromMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  }

  const { data: u } = await supabase.auth.getUser();
  const ins = await supabase.from('biz_contract_staff').insert(
    staff.map((s) => ({
      contract_id: contractId, staff_id: s.staffId, staff_name: s.staffName,
      active: true, from_month: fromMonth, to_month: null, created_by: u.user?.id ?? null,
    })),
  );
  if (ins.error) throw new Error(ins.error.message);
}

/* ────────────────────────────────────────────────────────────────
   세무조정수수료관리 → 매출계약 금액 밀어넣기

   담당회계사 정우철인 거래처의 법인세조정·종합소득세는 기장계약을 등록할 때
   금액 0 인 계약이 함께 생긴다(SalesContractTab.createTaxFiling). 실제 금액은
   세무조정수수료관리에서 청구서를 확정할 때 정해진다 — 그 값을 여기서 계약에
   되돌려 놓는다. 사람이 두 화면을 오가며 옮겨 적지 않게 하려는 것이다.
   ──────────────────────────────────────────────────────────────── */

export interface TaxFilingSync {
  /** 계약 금액을 실제로 고쳤는가. */
  updated: boolean;
  contractCode?: string;
  /** 새로 넣은 공급가액. */
  amount?: number;
  /** 고치기 전 금액(0 이면 처음 채운 것). */
  previous?: number;
  /** 못 고친 이유 — 화면에 그대로 보여 준다. */
  reason?: string;
}

/**
 * 확정된 세무조정 청구서의 공급가액을 그 거래처의 세무조정 매출계약에 적는다.
 *
 * 계약은 **확정일이 청구기간(start_date~end_date) 안에 드는** 세무조정 계약으로 찾는다.
 * 계약의 fiscal_year 는 대상 사업연도가 아니라 정산연도(청구가 일어나는 7/1~익6/30)라,
 * 날짜로 찾는 편이 어긋나지 않는다.
 *
 * 실패해도 예외를 던지지 않는다 — 청구 확정 자체가 막히면 안 된다.
 */
export async function syncTaxFilingContractAmount(input: {
  clientId: string | null;
  companyName: string;
  /** 공급가액(D). grand 는 부가세가 붙은 값이라 쓰지 않는다. */
  supplyAmount: number;
  /** 확정일(YYYY-MM-DD). 계약 기간 매칭에 쓴다. */
  onDate: string;
}): Promise<TaxFilingSync> {
  try {
    if (!(input.supplyAmount > 0)) return { updated: false, reason: '공급가액이 0이라 옮기지 않았습니다.' };

    // 청구기록의 거래처(clients) → 거래처마스터(biz_entity). 연결이 없으면 상호로 찾는다.
    let entityId: string | null = null;
    if (input.clientId) {
      const { data } = await supabase.from('clients').select('entity_id').eq('id', input.clientId).maybeSingle();
      entityId = (data as { entity_id: string | null } | null)?.entity_id ?? null;
    }
    if (!entityId) {
      const { data } = await supabase.from('biz_entity').select('id').eq('name', input.companyName.trim()).limit(2);
      const hit = (data as { id: string }[] | null) ?? [];
      if (hit.length === 1) entityId = hit[0].id;
    }
    if (!entityId) {
      return { updated: false, reason: `‘${input.companyName}’이 거래처관리의 어느 거래처인지 찾지 못했습니다 — 매출계약 금액은 직접 적어 주세요.` };
    }

    const { data: cons, error } = await supabase
      .from('biz_sales_contract')
      .select('id, contract_code, amount, fiscal_year, start_date, end_date, note')
      .eq('entity_id', entityId)
      .in('category_code', ['TAX.FILING.CORP', 'TAX.FILING.INCOME']);
    if (error) return { updated: false, reason: error.message };

    const target = pickTaxFilingContract((cons as TaxFilingRow[] | null) ?? [], input.onDate);
    if (!target) {
      const fy = settlementYearOfDate(input.onDate);
      return { updated: false, reason: `FY${fy} 세무조정 매출계약이 없습니다 — 계약을 먼저 등록해 주세요.` };
    }
    const previous = Number(target.amount) || 0;
    if (previous === Math.round(input.supplyAmount)) {
      return { updated: false, contractCode: target.contract_code ?? undefined, reason: '계약 금액이 이미 같습니다.' };
    }

    const { data: u } = await supabase.auth.getUser();
    const { error: ue } = await supabase.from('biz_sales_contract').update({
      amount: Math.round(input.supplyAmount),
      note: `세무조정수수료관리에서 확정 (${input.onDate})`,
      updated_by: u.user?.id ?? null,
      updated_at: new Date().toISOString(),
    }).eq('id', target.id);
    if (ue) return { updated: false, reason: ue.message };

    return {
      updated: true,
      contractCode: target.contract_code ?? undefined,
      amount: Math.round(input.supplyAmount),
      previous,
    };
  } catch (e) {
    return { updated: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
