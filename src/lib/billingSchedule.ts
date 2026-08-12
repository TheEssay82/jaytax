// 매출계약 → 월별 청구/발생 매출 전개 엔진(순수함수). 월별 매출집계의 공통 토대.
// 설계 확정(2026-08-12): 인식기준 청구주의·발생주의 둘 다 / 분할 우선 / 부가세 순액 / 무료·할인 반영.
//   규칙 상세는 memory: jaytax-revenue-aggregation-spec.
import type { SalesContract, BillingCycle } from './salesContractApi';

/** 인식기준: 청구주의(청구월에 전액) | 발생주의(계약기간 균등배분). */
export type Basis = 'billing' | 'accrual';
/** 월별 순매출(공급가액). month = 'YYYY-MM'. */
export interface MonthNet { month: string; net: number }

const VAT_RATE = 0.1; // 부가세 10%
// 연환산 계수(주기→연 청구횟수). 발생주의 균등배분에 사용.
const CYCLE_ANN: Record<BillingCycle, number> = { 월: 12, 분기: 4, 반기: 2, 연: 1, 발생시: 1, 건: 1 };
// 주기 → 청구 간격(개월). 청구주의 정기 이벤트 생성에 사용.
const CYCLE_STEP: Partial<Record<BillingCycle, number>> = { 월: 1, 분기: 3, 반기: 6, 연: 12 };

// ── 월(index) 산술 ─────────────────────────────────────────
/** 'YYYY-MM' 또는 'YYYY-MM-DD' → 월 인덱스(y*12 + (m-1)). 잘못된 값은 null. */
export function monthIndex(d: string | null | undefined): number | null {
  if (!d || d.length < 7) return null;
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
  if (!y || !m) return null;
  return y * 12 + (m - 1);
}
/** 월 인덱스 → 'YYYY-MM'. */
export function indexToMonth(i: number): string {
  const y = Math.floor(i / 12), m = (i % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** 공급가액(순액) 환산 — 부가세 포함 계약은 /1.1, 아니면 그대로. 원 단위 반올림. */
export function toNet(gross: number, includesVat: boolean): number {
  return Math.round(includesVat ? gross / (1 + VAT_RATE) : gross);
}

/** 특정 월(index)에 적용될 총액 = 정가에서 무료·할인 반영(총액 기준). */
function applyDiscounts(c: SalesContract, gross: number, mi: number): number {
  let g = gross;
  for (const d of c.discounts) {
    const s = monthIndex(d.startDate), e = monthIndex(d.endDate);
    if (s != null && mi < s) continue;        // 시작 전
    if (e != null && mi > e) continue;         // 종료 후 (null = 무기한)
    if (d.discType === '무료') return 0;
    if (d.rate != null) g = g * (1 - d.rate / 100);       // 할인율%
    else if (d.amount != null) g = Math.max(0, g - d.amount); // 정액 할인
  }
  return g;
}

/**
 * 매출(발생주의) 인식 구간 — 회계감사(AUD.AUDIT)는 회사 회계연도(fy-07~fy+1-06)에 걸쳐 월할 인식,
 * 그 외 계약은 계약 개시~종료. 청구주의(현금)엔 적용 안 함(개시월/분할 그대로).
 * 감사 계약의 startDate/endDate는 감사 대상연도(1~12월)라 회계연도(7~6월)와 달라 remap이 필요하다.
 */
export function recognitionSpan(c: SalesContract): { from: string | null; to: string | null } {
  if (c.categoryCode === 'AUD.AUDIT') {
    // 계약 귀속(정산)연도: 명시 fiscalYear 우선, 없으면 종료시점 정산연도(7월~ 그 해, ~6월 전년).
    const fy = c.fiscalYear ?? settlementYearOf(c.endDate);
    if (fy != null) return { from: `${fy}-07`, to: `${fy + 1}-06` };
  }
  return { from: c.startDate, to: c.endDate };
}
/** 날짜의 정산연도(회계연도 7/1~익6/30). salesContractApi.settlementYearOfDate와 동일 규칙(엔진 자립을 위해 로컬 정의). */
function settlementYearOf(d: string | null | undefined): number | null {
  if (!d || d.length < 7) return null;
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
  if (!y || !m) return null;
  return m >= 7 ? y : y - 1;
}

/**
 * 계약의 월별 순매출을 [fromMonth, toMonth] 창구 안에서 전개.
 * fromMonth/toMonth = 'YYYY-MM'(포함). 종료 없는 계속계약은 창구 상한까지만 생성.
 */
export function monthlyRevenue(c: SalesContract, basis: Basis, fromMonth: string, toMonth: string): MonthNet[] {
  const from = monthIndex(fromMonth), to = monthIndex(toMonth);
  if (from == null || to == null || to < from) return [];
  const inWin = (mi: number) => mi >= from && mi <= to;
  const net = (mi: number, gross: number) => toNet(applyDiscounts(c, gross, mi), c.includesVat);

  const out: MonthNet[] = [];
  const hasInstallments = c.installments.length > 0;
  const step = CYCLE_STEP[c.billingCycle];

  if (basis === 'billing') {
    // 청구주의: 분할 우선. 분할 있으면 회차 due월에 회차금액.
    if (hasInstallments) {
      for (const it of c.installments) {
        const mi = monthIndex(it.dueDate);
        if (mi == null || !inWin(mi)) continue;
        out.push({ month: indexToMonth(mi), net: net(mi, it.amount) });
      }
    } else if (step) {
      // 정기: 개시월부터 주기마다 계약금액(주기당) 청구.
      const start = monthIndex(c.startDate);
      if (start == null) return [];
      const end = monthIndex(c.endDate); // null = 계속 → 창구 상한까지
      const last = end == null ? to : Math.min(end, to);
      for (let mi = start; mi <= last; mi += step) {
        if (inWin(mi)) out.push({ month: indexToMonth(mi), net: net(mi, c.amount) });
      }
    }
    // 발생시·건(분할 없음): 예측 스케줄 없음 → 아무것도 생성 안 함.
    return out;
  }

  // 발생주의: 주기계약은 연환산/12를 활성월(인식구간)마다 균등배분. 감사는 회계연도로 remap.
  if (step) {
    const span = recognitionSpan(c);
    const start = monthIndex(span.from);
    if (start == null) return [];
    const end = monthIndex(span.to);
    const last = end == null ? to : Math.min(end, to);
    const monthlyGross = (c.amount * (CYCLE_ANN[c.billingCycle] ?? 1)) / 12;
    for (let mi = Math.max(start, from); mi <= last; mi++) {
      if (inWin(mi)) out.push({ month: indexToMonth(mi), net: net(mi, monthlyGross) });
    }
    return out;
  }
  // 발생시·건: 균등배분 불가 → 분할 있으면 due월 인식, 없으면 없음.
  if (hasInstallments) {
    for (const it of c.installments) {
      const mi = monthIndex(it.dueDate);
      if (mi == null || !inWin(mi)) continue;
      out.push({ month: indexToMonth(mi), net: net(mi, it.amount) });
    }
  }
  return out;
}

/** 계약의 [from,to] 기간 순매출 합계(단일 스칼라). */
export function periodRevenue(c: SalesContract, basis: Basis, fromMonth: string, toMonth: string): number {
  return monthlyRevenue(c, basis, fromMonth, toMonth).reduce((s, m) => s + m.net, 0);
}

/** 여러 계약을 월별로 합산 → Map<'YYYY-MM', 순매출>. 시계열(현황조회 추이)용. */
export function monthlyTotals(cs: SalesContract[], basis: Basis, fromMonth: string, toMonth: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cs) for (const { month, net } of monthlyRevenue(c, basis, fromMonth, toMonth)) {
    m.set(month, (m.get(month) ?? 0) + net);
  }
  return m;
}

/**
 * 계약 집합에서 기본 창구[from,to] 도출 — 가장 이른 개시월 ~ (가장 늦은 종료월 또는 오늘).
 * todayMonth = 'YYYY-MM'(호출측에서 주입, 순수성 유지). capToToday=true면 상한을 오늘로 제한(경과분).
 */
export function defaultWindow(cs: SalesContract[], todayMonth: string, capToToday = false): { from: string; to: string } {
  let min = Infinity, max = -Infinity;
  const today = monthIndex(todayMonth) ?? 0;
  for (const c of cs) {
    const s = monthIndex(c.startDate); if (s != null) min = Math.min(min, s);
    const e = monthIndex(c.endDate); if (e != null) max = Math.max(max, e);
  }
  if (min === Infinity) min = today;
  if (max === -Infinity) max = today;
  let to = Math.max(max, today);
  if (capToToday) to = Math.min(to, today);
  return { from: indexToMonth(min), to: indexToMonth(to) };
}
