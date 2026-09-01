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
    };
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
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
