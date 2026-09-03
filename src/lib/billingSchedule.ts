// 매출계약 → 월별 청구/발생 매출 전개 엔진(순수함수). 월별 매출집계의 공통 토대.
// 설계 확정(2026-08-12): 인식기준 청구주의·발생주의 둘 다 / 분할 우선 / 부가세 순액 / 무료·할인 반영.
//   규칙 상세는 memory: jaytax-revenue-aggregation-spec.
import type { SalesContract, BillingCycle } from './salesContractApi';

/** 인식기준: 청구주의(청구월에 전액) | 발생주의(계약기간 균등배분). */
export type Basis = 'billing' | 'accrual';
/** 월별 순매출(공급가액). month = 'YYYY-MM'. */
export interface MonthNet { month: string; net: number }

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

/**
 * 계약금액은 **언제나 공급가액(부가세 별도)** 이다. 원 단위로만 맞춘다.
 *
 * ※ 계약의 `includesVat`/`includesWht` 는 금액과 아무 상관이 없다.
 *   '기장 계약에 부가세·원천세 신고업무가 포함되는가'라는 **업무 범위** 표시다
 *   (화면 라벨도 「기장 포함: 부가가치세 / 원천세」). 한때 이 값을 '금액에 부가세 포함'으로
 *   잘못 읽어 /1.1 로 깎았고, 그 탓에 해당 계약의 공급가액이 9% 적게 잡혔다.
 */
export function toNet(gross: number): number {
  return Math.round(gross);
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
 * 청구주의 정기청구의 첫 청구월(인덱스).
 * 연 1회 계약에 청구월(billingMonth)이 지정돼 있으면 계약기간 안의 그 달이 첫 청구다 —
 * 세무조정처럼 '정산기간은 7월에 시작하지만 청구는 신고 후 익년 상반기'인 계약을 위한 것.
 * 지정이 없으면 기존대로 개시월.
 */
function billingAnchor(c: SalesContract): number | null {
  const start = monthIndex(c.startDate);
  if (start == null) return null;
  const bm = c.billingMonth;
  if (!bm || c.billingCycle !== '연') return start;
  const startMonth = (start % 12) + 1;            // 1~12
  const diff = (bm - startMonth + 12) % 12;       // 개시월부터 청구월까지 남은 개월
  return start + diff;
}

/**
 * **단발 계약**인가 — 그 금액이 '주기당'이 아니라 **그 건의 총액**인 계약.
 * 한 번 하고 끝나는 일은 **주기 '건'** 으로 등록한다(사용자 확정 2026-09-03).
 * 개시월에 전액 인식한다.
 *
 * **기간이 주기보다 짧다고 단발로 넘겨짚지 않는다.** 한때 그렇게 추론했는데
 * (연건아트레지던스가 '연·1개월'로 등록돼 800,000 이 66,667 로 잡히던 자리),
 * 그 추론은 **종료일 오타를 12배 과대계상으로 키우는 길**이 된다 —
 * 연 12,000,000 계약의 종료일을 잘못 눌러 1개월이 되면 전액이 한 달에 잡힌다.
 * 단발은 '건'으로 **명시**하기로 했으므로 넘겨짚을 이유가 없다.
 * 짧게 등록된 주기계약은 종전대로 기간에 걸쳐 월할한다(적게 잡히는 쪽 = 안전한 쪽).
 *
 * 분할회차가 있으면 그쪽이 우선(분할 우선 규칙)이라 단발로 보지 않는다.
 * '발생시'는 언제 몇 번 일어날지 모르므로 여기에 넣지 않는다 — 스케줄 없음 그대로다.
 */
export function isOneOff(c: SalesContract): boolean {
  if (c.installments.length) return false;
  return c.billingCycle === '건';
}

/**
 * 계약의 월별 순매출을 [fromMonth, toMonth] 창구 안에서 전개.
 * fromMonth/toMonth = 'YYYY-MM'(포함). 종료 없는 계속계약은 창구 상한까지만 생성.
 */
export function monthlyRevenue(c: SalesContract, basis: Basis, fromMonth: string, toMonth: string): MonthNet[] {
  const from = monthIndex(fromMonth), to = monthIndex(toMonth);
  if (from == null || to == null || to < from) return [];
  const inWin = (mi: number) => mi >= from && mi <= to;
  const net = (mi: number, gross: number) => toNet(applyDiscounts(c, gross, mi));

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
    } else if (isOneOff(c)) {
      // 단발: 개시월(연 1회 계약은 지정 청구월)에 계약금액 전액.
      const mi = billingAnchor(c);
      if (mi != null && inWin(mi)) out.push({ month: indexToMonth(mi), net: net(mi, c.amount) });
    } else if (step) {
      // 정기: 첫 청구월(연 1회는 청구월 지정 반영)부터 주기마다 계약금액(주기당) 청구.
      const start = billingAnchor(c);
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

  // 발생주의: 단발은 월할하지 않고 인식구간 첫 달에 전액.
  if (isOneOff(c)) {
    const mi = monthIndex(recognitionSpan(c).from);
    if (mi != null && inWin(mi)) out.push({ month: indexToMonth(mi), net: net(mi, c.amount) });
    return out;
  }
  // 주기계약은 연환산/12를 활성월(인식구간)마다 균등배분. 감사는 회계연도로 remap.
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

/** 그 달에 청구할 항목 하나. 분할계약이면 회차별로 나뉜다. */
export interface BillingItem {
  /** 분할 회차 id(정기청구면 null) */
  installmentId: string | null;
  /** 회차 라벨(정기청구면 '') */
  label: string;
  /** 공급가액(할인·부가세 반영 후) */
  net: number;
}

/**
 * 계약의 'YYYY-MM' 월 청구 항목 전개 — 세금계산서 발행요청 후보를 만드는 데 쓴다.
 * monthlyRevenue(basis='billing')와 같은 규칙(분할 우선·정기는 개시월부터 주기마다)이되,
 * 어느 분할 회차인지까지 돌려준다.
 */
export function billingItemsForMonth(c: SalesContract, ym: string): BillingItem[] {
  const mi = monthIndex(ym);
  if (mi == null) return [];
  const net = (gross: number) => toNet(applyDiscounts(c, gross, mi));

  if (c.installments.length > 0) {
    return c.installments
      .filter((it) => monthIndex(it.dueDate) === mi)
      .map((it) => ({ installmentId: it.id ?? null, label: it.label || '', net: net(it.amount) }));
  }
  const step = CYCLE_STEP[c.billingCycle];
  // 발생시·건 = 발행요청 후보를 자동으로 만들지 않는다. monthlyRevenue 는 단발('건')을 개시월에
  // 전액 인식하지만(예산·예상용), 여기는 **세금계산서를 실제로 끊는 자리**라 자동 제안하지 않는다 —
  // 이미 수기로 발행한 건이 후보로 되살아나 이중발행이 될 수 있다. 건별은 손으로 요청한다.
  if (!step) return [];
  const start = billingAnchor(c);
  if (start == null || mi < start) return [];
  const end = monthIndex(c.endDate);
  if (end != null && mi > end) return [];
  if ((mi - start) % step !== 0) return [];   // 주기에 해당하는 달이 아님
  const v = net(c.amount);
  return v > 0 ? [{ installmentId: null, label: '', net: v }] : [];
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
