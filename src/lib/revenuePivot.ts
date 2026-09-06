// 매출통계 피벗의 **셈법**만 모은 곳. supabase 를 물지 않는다(테스트가 돌아야 하므로).
//
// 엑셀에서 하던 모양을 그대로 담는 것이 목표다 —
//   행: 담당회계사 **>** 담당직원 (2단계 중첩)
//   값: 거래처 수 · 기장료수입 · 조정료 · 기타 · 합계 (여러 개를 한 표에)
//
// 열 축을 함께 쓰면 값은 하나만 쓴다. 값 여러 개를 열로 펼치면서 열 축까지 두면
// 표가 3차원이 되어 사람이 못 읽는다 — 화면이 둘 중 하나만 고르게 한다.

/**
 * 피벗이 셈에 쓰는 최소한의 모양. 이것만 갖추면 어떤 줄이든 받는다
 * (revenueStatsApi 의 RevenueFact 가 그대로 들어맞는다).
 */
export interface PivotFact {
  company: string;
  supply: number;
  kind: '세무조정' | '기장료' | '기타';
  /** 담당직원 배분. 비어 있으면 미지정. 합이 100 이다. */
  shares: { name: string; share: number }[];
  // ── 아래 셋은 단가(평균)를 셀 때만 쓴다. 없으면 그 규칙이 느슨해질 뿐 깨지지 않는다.
  /** 청구주기(계약). 「월정액」을 가릴 때 쓴다. */
  billingCycle?: string;
  /** 사업장(상호). 평균의 **분모**다 — 없으면 거래처로 갈음한다. */
  place?: string;
  /** 귀속월. 실적의 단가를 낼 때 **나눌 달**을 세는 데 쓴다. */
  ym?: string;
  /** 매출계정. 청구주기가 없는 옛 실적 자료에서 월정액을 가릴 때 쓴다. */
  erpAccount?: string;
}

/**
 * **월정액 계약인가** — 기장뿐 아니라 원천·컨설팅까지. 엑셀의 「월기장료」가 이것이다.
 *
 * 청구·예상은 계약의 청구주기로 가른다. 그런데 **옛 실적 자료(FY2025 이전)에는
 * 청구주기가 없다** — 계약에 연결되어 있지 않기 때문이다. 그때는 매출계정으로 가른다:
 * 「기장·컨설팅·원천」은 달마다 받는 돈이고, 「세무조정·신고대리」는 한 해에 한 번이다
 * (2026-09-07 실측 — 세무조정은 열두 달 중 다섯 달에만 찍힌다).
 */
const MONTHLY_ACCOUNTS = new Set(['기장', '컨설팅', '원천', '기장대리수입']);
export const isMonthlyFact = (f: PivotFact): boolean =>
  (f.billingCycle ? f.billingCycle === '월' : MONTHLY_ACCOUNTS.has((f.erpAccount ?? '').trim()));

/** 축 하나 — 사실 한 줄을 어떤 이름으로 묶을지. 한 줄이 여러 칸에 나뉠 수 있다. */
export interface Dim<F = PivotFact> {
  key: string;
  label: string;
  split: (f: F) => { name: string; weight: number }[];
  sortByName?: boolean;
}

/** 값 하나 — 셀에 무엇을 담을지. */
export interface Measure<F = PivotFact> {
  key: string;
  label: string;
  /**
   * 'sum' 은 금액을 더하고, 'clients' 는 서로 다른 거래처를 센다.
   * 'avg' 는 **거래처 하나당 얼마**인가 — 금액 ÷ 그 금액이 잡힌 거래처 수다.
   */
  agg: 'sum' | 'clients' | 'count' | 'avg';
  /** agg='sum' 일 때 이 줄에서 뽑을 값. 없으면 supply. */
  pick?: (f: F) => number;
  /** 이 줄을 셈에 넣을지. 없으면 전부. */
  where?: (f: F) => boolean;
  /**
   * 평균의 **분모를 무엇으로 셀지**. 없으면 거래처(company).
   * 「평균 월기장료」는 <b>사업장</b>으로 센다 — 한 거래처가 사업장을 셋 맡기면
   * 단가는 셋으로 나뉘어야 한다(시파사가 그런 자리다).
   */
  unit?: (f: F) => string;
  /**
   * true 면 **그 칸에 실제로 매출이 잡힌 달 수**로 한 번 더 나눈다.
   *
   * 실적을 볼 때 필요하다 — 창구를 열두 달로 잡아도 여섯 달만 청구된 사업장은
   * 12 로 나누면 단가가 절반으로 보인다. 「단가가 낮다」와 「몇 달만 청구했다」는
   * 다른 이야기이고, 사장님이 찾으시는 것은 앞엣것이다(2026-09-07).
   * 예상은 한 줄에 기간 전체 금액이 담기므로 이 방식을 쓰지 않는다(pick 으로 나눈다).
   */
  perMonth?: boolean;
}

export const MEASURES: Measure[] = measuresFor(12);

/**
 * 값 목록 — **기간의 개월 수**를 받는다. 「평균 월 기장료」가 그 수로 나뉘기 때문이다.
 *
 * 왜 개월 수가 필요한가: 엑셀에서 보시던 「평균 월 기장료」(김준성 개인 88,571 …)는
 * **월 단가**다. 그런데 피벗이 더하는 것은 기간 전체의 금액이라, 12 로 나누지 않으면
 * 열두 배로 보인다. 기간을 석 달만 잡으면 3 으로 나누어야 하므로 상수로 둘 수 없다.
 */
export function measuresFor(months: number, forecast = false): Measure[] {
  const m = Math.max(1, months);
  /** 평균의 분모 — 사업장. 한 거래처가 사업장을 여럿 맡기면 그만큼 나뉜다. */
  const place = (f: PivotFact) => f.place || f.company;
  return [
    { key: 'clients', label: '거래처 수', agg: 'clients' },
    { key: 'count', label: '건수', agg: 'count' },
    { key: 'book', label: '기장료수입', agg: 'sum', where: (f) => f.kind === '기장료' },
    { key: 'adj', label: '조정료', agg: 'sum', where: (f) => f.kind === '세무조정' },
    { key: 'etc', label: '기타수입', agg: 'sum', where: (f) => f.kind === '기타' },
    { key: 'supply', label: '합계(공급가액)', agg: 'sum' },
    // ── 단가. 합계는 많이 맡은 사람이 크고, 단가는 **한 곳당 얼마를 받는지**를 말한다.
    // 「월기장료」는 달마다 받는 돈이라 개월 수로 나눈다(엑셀의 「평균 월 기장료」).
    // 「평균 월기장료」 — **월정액 계약(기장·원천·컨설팅)의 사업장당 월 단가**.
    // 실적은 그 칸에 청구가 잡힌 달 수로 나누고(perMonth), 예상은 한 줄에 기간 전체
    // 금액이 담기므로 창구의 개월 수로 나눈다(pick).
    forecast
      ? {
        key: 'avgBookM', label: '평균 월기장료', agg: 'avg',
        where: isMonthlyFact, unit: place, pick: (f) => f.supply / m,
      }
      : {
        key: 'avgBookM', label: '평균 월기장료', agg: 'avg',
        where: isMonthlyFact, unit: place, perMonth: true,
      },
    // 조정료는 한 해에 한 번 받는 돈이라 월로 나누지 않는다 — 나누면 뜻이 없다.
    { key: 'avgAdj', label: '거래처당 조정료', agg: 'avg', where: (f) => f.kind === '세무조정' },
    { key: 'avgClient', label: '거래처당 합계', agg: 'avg' },
  ];
}

/** 표의 한 줄. 2단계면 부모 아래에 자식 줄이 붙는다. */
export interface PivotRow {
  /** 1단계 이름. */
  key: string;
  /** 2단계 이름. 1단계 소계 줄이면 null. */
  sub: string | null;
  /** 소계 줄인가(2단계를 쓸 때 부모 줄). */
  isSubtotal: boolean;
  /** 측정값 key → 값. */
  values: Record<string, number>;
}

export interface PivotTable {
  rows: PivotRow[];
  /** 열 축을 쓸 때의 열 이름들. 값 여러 개 모드면 비어 있다. */
  cols: string[];
  /** 총계 줄. */
  total: Record<string, number>;
}

/** 줄의 귀속월. PivotFact 최소 모양에는 없으므로 있으면 쓰고 없으면 한 덩어리로 본다. */
const monthOf = (f: unknown): string =>
  (typeof f === 'object' && f !== null && 'ym' in f ? String((f as { ym: unknown }).ym) : '') || '-';

interface Bucket {
  sum: Record<string, number>;
  clients: Set<string>;
  count: number;
  /**
   * 평균의 **분모**. 측정값마다 따로 센다 — 기장료 평균의 분모는 「기장료가 잡힌 거래처」이지
   * 전체 거래처가 아니다. 전체로 나누면 기장을 안 맡는 곳까지 분모에 들어가 단가가 낮아진다.
   */
  avgClients: Record<string, Set<string>>;
  /** 평균을 낼 때 나눌 **달**. perMonth 인 측정값만 채운다. */
  avgMonths: Record<string, Set<string>>;
}
const newBucket = (): Bucket => ({
  sum: {}, clients: new Set(), count: 0, avgClients: {}, avgMonths: {},
});

function add<F extends PivotFact>(b: Bucket, f: F, w: number, ms: Measure<F>[]) {
  b.clients.add(f.company);
  b.count += 1;
  for (const m of ms) {
    if (m.agg !== 'sum' && m.agg !== 'avg') continue;
    if (m.where && !m.where(f)) continue;
    const v = (m.pick ? m.pick(f) : f.supply) * w;
    b.sum[m.key] = (b.sum[m.key] ?? 0) + v;
    // 0 원짜리 줄은 분모에 넣지 않는다 — 기장료 없는 신고대리 건까지 세면 평균이 꺼진다.
    if (m.agg === 'avg' && v !== 0) {
      (b.avgClients[m.key] ??= new Set()).add(m.unit ? m.unit(f) : f.company);
      if (m.perMonth) (b.avgMonths[m.key] ??= new Set()).add(monthOf(f));
    }
  }
}

const read = <F,>(b: Bucket, ms: Measure<F>[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const m of ms) {
    if (m.agg === 'clients') { out[m.key] = b.clients.size; continue; }
    if (m.agg === 'count') { out[m.key] = b.count; continue; }
    if (m.agg === 'avg') {
      const n = b.avgClients[m.key]?.size ?? 0;
      const mm = m.perMonth ? (b.avgMonths[m.key]?.size ?? 0) : 1;
      out[m.key] = n > 0 && mm > 0 ? (b.sum[m.key] ?? 0) / mm / n : 0;
      continue;
    }
    out[m.key] = b.sum[m.key] ?? 0;
  }
  return out;
};

/**
 * 값 여러 개를 한 표에. 행은 1단계 또는 2단계(중첩).
 *
 * **거래처 수는 더하지 않고 센다.** 소계의 거래처 수가 하위 줄의 합보다 작을 수 있다 —
 * 한 거래처를 두 직원이 나눠 맡으면 각 직원 줄에 한 번씩, 소계에는 한 번만 잡힌다.
 * 엑셀도 그렇게 센다.
 */
export function pivotMulti<F extends PivotFact>(
  facts: F[], row: Dim<F>, sub: Dim<F> | null, measures: Measure<F>[],
): PivotTable {
  const tops = new Map<string, Bucket>();
  const subs = new Map<string, Map<string, Bucket>>();
  const total = newBucket();

  for (const f of facts) {
    for (const r of row.split(f)) {
      const tb = tops.get(r.name) ?? newBucket();
      add(tb, f, r.weight, measures);
      tops.set(r.name, tb);
      if (sub) {
        const inner = subs.get(r.name) ?? new Map<string, Bucket>();
        for (const s of sub.split(f)) {
          const sb = inner.get(s.name) ?? newBucket();
          add(sb, f, r.weight * s.weight, measures);
          inner.set(s.name, sb);
        }
        subs.set(r.name, inner);
      }
    }
    add(total, f, 1, measures);
  }

  const sortNames = (m: Map<string, Bucket>, d: Dim<F>) => {
    const l = [...m.keys()];
    return d.sortByName
      ? l.sort()
      : l.sort((a, b) => (m.get(b)!.sum.supply ?? 0) - (m.get(a)!.sum.supply ?? 0) || a.localeCompare(b, 'ko'));
  };

  const rows: PivotRow[] = [];
  for (const name of sortNames(tops, row)) {
    rows.push({ key: name, sub: null, isSubtotal: !!sub, values: read(tops.get(name)!, measures) });
    if (sub) {
      const inner = subs.get(name)!;
      for (const sName of sortNames(inner, sub)) {
        rows.push({ key: name, sub: sName, isSubtotal: false, values: read(inner.get(sName)!, measures) });
      }
    }
  }
  return { rows, cols: [], total: read(total, measures) };
}
