// 매출통계 — 청구 기록을 여러 각도로 잘라 보기 위한 재료.
//
// 원천은 **발행요청(biz_invoice_request)** 이다. 계약을 지금 읽는 것이 아니라
// 청구할 때 굳혀 둔 기록을 더하므로, 담당이나 금액이 나중에 바뀌어도 지난 통계는 변하지 않는다.
// 계약에만 있는 값(매출유형·청구주기)은 계약을 한 번 읽어 붙인다.
//
// 여기서는 **사실(fact) 한 줄씩만** 만들고, 어떤 축으로 묶을지는 화면이 정한다(엑셀 피벗처럼).
import { supabase } from './supabase';
import { listSalesContracts } from './salesContractApi';
import { listInvoiceStaff } from './invoiceStaffApi';
import { findNode, pathLabel } from './salesContractTaxonomy';

/** 정산기간은 7/1~익년 6/30. 종료 시점의 연도가 아니라 **시작 연도**로 부른다(FY2026 = 2026-07~2027-06). */
export const FY_START_MONTH = 7;

export function fyOf(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return m >= FY_START_MONTH ? y : y - 1;
}
export function fyRange(fy: number): { from: string; to: string } {
  return { from: `${fy}-07`, to: `${fy + 1}-06` };
}
export function fyLabel(fy: number): string {
  return `FY${fy} (${fy}-07~${fy + 1}-06)`;
}

export interface RevenueFact {
  id: string;
  ym: string;
  fy: number;
  team: string;              // taxteam | 감사team
  cpa: string;               // 담당회계사(청구 시점 스냅샷)
  /** 담당직원 배분. 비어 있으면 미지정. */
  shares: { name: string; share: number }[];
  erpAccount: string;        // ERP 매출계정
  company: string;
  place: string;
  typeTop: string;           // 매출유형 대분류
  typeFull: string;          // 매출유형 전체 경로
  billingCycle: string;      // 청구주기(계약)
  phase: string;             // 계약금·중도금·잔금(감사팀)
  status: string;
  supply: number;            // 공급가액(부가세 별도)
  /** 이 줄이 어디서 왔나 — 화면이 밝혀야 한다(원천마다 믿을 수 있는 축이 다르다). */
  origin: '청구' | '실적';
  /** 수입 종류를 세 갈래로 정규화 — 원천이 달라도 같은 말로 묶으려는 것. */
  kind: '세무조정' | '기장료' | '기타';
  /** 법인/개인 (실적 자료에만 있다). */
  bizType: string;
}

/**
 * 매출계정(청구)·항목(실적)을 세 갈래로 정규화한다.
 * 엑셀이 '총 기장료수입 / 조정료합계 / 기타수입'으로 갈라 보던 그 구분이다.
 */
export function revenueKind(s: string): RevenueFact['kind'] {
  const v = (s || '').trim();
  if (v.includes('세무조정')) return '세무조정';
  if (['기장', '기장대리수입', '원천', '신고대리', '컨설팅', '경영자문수입'].includes(v)) return '기장료';
  return '기타';
}

/**
 * 기간 안의 청구 사실을 모은다. 취소분은 뺀다.
 * team 을 주면 그 팀만.
 */
export async function listRevenueFacts(
  fromYm: string, toYm: string, team?: string,
): Promise<RevenueFact[]> {
  let q = supabase.from('biz_invoice_request')
    .select('id, ym, team, cpa, staff, erp_account, company_name, place_name, contract_id, phase, status, supply_amount')
    .gte('ym', fromYm).lte('ym', toYm).neq('status', '취소');
  if (team) q = q.eq('team', team);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows = (data as any[]) ?? [];
  if (!rows.length) return [];

  const [contracts, shareMap] = await Promise.all([
    listSalesContracts(),
    listInvoiceStaff(rows.map((r) => r.id)),
  ]);
  const conMap = new Map(contracts.map((c) => [c.id, c]));

  return rows.map((r) => {
    const c = r.contract_id ? conMap.get(r.contract_id) : undefined;
    const code = c?.categoryCode ?? '';
    // 배분이 없으면 청구에 굳혀 둔 담당직원을 주담당 100% 로 본다.
    const list = (shareMap.get(r.id) ?? []).filter((s) => s.share > 0);
    const shares = list.length
      ? list.map((s) => ({ name: s.staffName, share: s.share }))
      : String(r.staff ?? '').split(',').map((x) => x.trim()).filter(Boolean)
        .map((n, i) => ({ name: n, share: i === 0 ? 100 : 0 })).filter((s) => s.share > 0);
    return {
      id: r.id,
      ym: r.ym,
      fy: fyOf(r.ym),
      team: r.team ?? '',
      cpa: (r.cpa ?? '').trim(),
      shares,
      erpAccount: r.erp_account ?? '',
      company: r.company_name ?? '',
      place: r.place_name ?? '',
      typeTop: code ? (findNode(code)?.path[0]?.label ?? '기타') : '',
      typeFull: code ? pathLabel(code) : '',
      billingCycle: c?.billingCycle ?? '',
      phase: r.phase ?? '',
      status: r.status ?? '',
      supply: Number(r.supply_amount) || 0,
      origin: '청구' as const,
      kind: revenueKind(r.erp_account ?? ''),
      bizType: '',
    };
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * 앱을 쓰기 전의 실적(biz_revenue_actual) 을 같은 모양으로 읽는다.
 *
 * 2025실적 엑셀에서 올린 자료다. 회계사·거래처·금액·담당직원 모두 원본과 맞는다
 * (FY2025 taxteam 384,937,273 · 101곳, 회계사 › 담당직원 소계까지 1원 단위로 일치).
 * 담당직원은 처음 올릴 때 열이 잘못 잡혀 두 사람만 들어가 있었는데, 원본 엑셀의
 * 거래처별 '기장담당'으로 되돌렸다(마이그 0132).
 */
async function listActualFacts(
  fromYm: string, toYm: string, team?: string,
): Promise<RevenueFact[]> {
  let q = supabase.from('biz_revenue_actual')
    .select('id, ym, team, cpa, manager, category, biz_type, entity_name, amount')
    .gte('ym', fromYm).lte('ym', toYm);
  if (team) q = q.eq('team', team);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return ((data as any[]) ?? []).map((r) => {
    const cat = (r.category ?? '').trim();
    const mgr = (r.manager ?? '').trim();
    return {
      id: `actual:${r.id}`,
      ym: r.ym,
      fy: fyOf(r.ym),
      team: r.team ?? '',
      cpa: (r.cpa ?? '').trim(),
      shares: mgr ? [{ name: mgr, share: 100 }] : [],
      erpAccount: cat,
      company: r.entity_name ?? '',
      place: '',
      typeTop: cat,
      typeFull: cat,
      billingCycle: '',
      phase: '',
      status: '실적',
      supply: Number(r.amount) || 0,
      origin: '실적' as const,
      kind: revenueKind(cat),
      bizType: (r.biz_type ?? '').trim(),
    };
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * 그 사업연도에 실적 자료가 있는가 — 있으면 **그 FY 는 실적만** 쓴다.
 *
 * 두 원천을 그냥 합치면 겹치는 달이 이중으로 계상된다(2026-06 이 그렇다).
 * 한 FY 안에서는 한 원천만 쓰는 것이 설명하기 쉽고 틀릴 여지가 없다.
 */
export async function fysWithActuals(): Promise<Set<number>> {
  const { data, error } = await supabase.from('biz_revenue_actual').select('ym');
  if (error) return new Set();
  return new Set(((data as { ym: string }[]) ?? []).map((r) => fyOf(r.ym)));
}

/**
 * 기간의 매출 사실 — **한 FY 안에서는 한 원천만** 쓴다.
 * 실적 자료가 있는 FY 는 실적을, 없는 FY 는 앱의 청구기록을 쓴다.
 */
export async function listRevenueAll(
  fromYm: string, toYm: string, team?: string,
): Promise<RevenueFact[]> {
  const actualFys = await fysWithActuals();
  const [req, act] = await Promise.all([
    listRevenueFacts(fromYm, toYm, team),
    actualFys.size ? listActualFacts(fromYm, toYm, team) : Promise.resolve([]),
  ]);
  return [...act, ...req.filter((f) => !actualFys.has(f.fy))];
}

// ── 피벗 ────────────────────────────────────────────────

/** 축 하나 — 사실 한 줄을 어떤 이름으로 묶을지. */
export interface Dim {
  key: string;
  label: string;
  /** 한 줄이 여러 칸에 나뉘어 들어갈 수 있다(담당직원 배분). 비율의 합은 1. */
  split: (f: RevenueFact) => { name: string; weight: number }[];
  /** 정렬 방식 — 월·FY 는 이름순, 나머지는 금액 큰 순. */
  sortByName?: boolean;
}

const one = (name: string) => [{ name: name || '(미지정)', weight: 1 }];

export const DIMS: Dim[] = [
  { key: 'none', label: '(묶지 않음)', split: () => [{ name: '전체', weight: 1 }], sortByName: true },
  { key: 'ym', label: '귀속월', split: (f) => one(f.ym), sortByName: true },
  { key: 'fy', label: '사업연도', split: (f) => one(`FY${f.fy}`), sortByName: true },
  { key: 'quarter', label: '분기(사업연도)', split: (f) => one(fyQuarter(f.ym)), sortByName: true },
  {
    key: 'staff', label: '담당직원',
    split: (f) => (f.shares.length
      ? f.shares.map((s) => ({ name: s.name, weight: s.share / 100 }))
      : one('')),
  },
  { key: 'cpa', label: '담당회계사', split: (f) => one(f.cpa) },
  { key: 'team', label: '팀', split: (f) => one(f.team === 'taxteam' ? 'taxteam' : '감사팀') },
  { key: 'erp', label: '매출계정', split: (f) => one(f.erpAccount) },
  { key: 'typeTop', label: '매출유형(대분류)', split: (f) => one(f.typeTop) },
  { key: 'typeFull', label: '매출유형(전체)', split: (f) => one(f.typeFull) },
  { key: 'cycle', label: '청구주기', split: (f) => one(f.billingCycle) },
  { key: 'phase', label: '구분(계약금·잔금)', split: (f) => one(f.phase) },
  { key: 'company', label: '거래처', split: (f) => one(f.company) },
  { key: 'status', label: '상태', split: (f) => one(f.status) },
];

/** 사업연도 안에서 몇 분기인가 — 7~9월이 1분기. */
function fyQuarter(ym: string): string {
  const [, m] = ym.split('-').map(Number);
  const q = Math.floor(((m - FY_START_MONTH + 12) % 12) / 3) + 1;
  return `${q}분기`;
}

export interface PivotResult {
  rows: string[];
  cols: string[];
  cell: Map<string, number>;          // `${row}|${col}` → 값
  rowTotal: Map<string, number>;
  colTotal: Map<string, number>;
  grand: number;
  counts: Map<string, number>;        // 행별 건수(배분 반영 전 원건수)
}

/**
 * 피벗 한 장. value 가 'count' 면 건수, 아니면 공급가액.
 * 담당직원처럼 한 줄이 나뉘는 축은 비율만큼 쪼개 더한다 — 합계가 부풀지 않는다.
 */
export function pivot(facts: RevenueFact[], row: Dim, col: Dim, value: 'supply' | 'count'): PivotResult {
  const cell = new Map<string, number>();
  const rowTotal = new Map<string, number>();
  const colTotal = new Map<string, number>();
  const counts = new Map<string, number>();
  const rowSet = new Set<string>();
  const colSet = new Set<string>();
  let grand = 0;

  for (const f of facts) {
    const v0 = value === 'count' ? 1 : f.supply;
    for (const r of row.split(f)) {
      rowSet.add(r.name);
      counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
      for (const c of col.split(f)) {
        colSet.add(c.name);
        const v = v0 * r.weight * c.weight;
        const k = `${r.name}|${c.name}`;
        cell.set(k, (cell.get(k) ?? 0) + v);
        rowTotal.set(r.name, (rowTotal.get(r.name) ?? 0) + v);
        colTotal.set(c.name, (colTotal.get(c.name) ?? 0) + v);
        grand += v;
      }
    }
  }
  const sortWith = (set: Set<string>, d: Dim, tot: Map<string, number>) => {
    const l = [...set];
    return d.sortByName ? l.sort() : l.sort((a, b) => (tot.get(b) ?? 0) - (tot.get(a) ?? 0) || a.localeCompare(b, 'ko'));
  };
  return {
    rows: sortWith(rowSet, row, rowTotal),
    cols: sortWith(colSet, col, colTotal),
    cell, rowTotal, colTotal, grand, counts,
  };
}
