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
}

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
  /** 'sum' 은 금액을 더하고, 'clients' 는 서로 다른 거래처를 센다. */
  agg: 'sum' | 'clients' | 'count';
  /** agg='sum' 일 때 이 줄에서 뽑을 값. 없으면 supply. */
  pick?: (f: F) => number;
  /** 이 줄을 셈에 넣을지. 없으면 전부. */
  where?: (f: F) => boolean;
}

export const MEASURES: Measure[] = [
  { key: 'clients', label: '거래처 수', agg: 'clients' },
  { key: 'count', label: '건수', agg: 'count' },
  { key: 'book', label: '기장료수입', agg: 'sum', where: (f) => f.kind === '기장료' },
  { key: 'adj', label: '조정료', agg: 'sum', where: (f) => f.kind === '세무조정' },
  { key: 'etc', label: '기타수입', agg: 'sum', where: (f) => f.kind === '기타' },
  { key: 'supply', label: '합계(공급가액)', agg: 'sum' },
];

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

interface Bucket { sum: Record<string, number>; clients: Set<string>; count: number }
const newBucket = (): Bucket => ({ sum: {}, clients: new Set(), count: 0 });

function add<F extends PivotFact>(b: Bucket, f: F, w: number, ms: Measure<F>[]) {
  b.clients.add(f.company);
  b.count += 1;
  for (const m of ms) {
    if (m.agg !== 'sum') continue;
    if (m.where && !m.where(f)) continue;
    b.sum[m.key] = (b.sum[m.key] ?? 0) + (m.pick ? m.pick(f) : f.supply) * w;
  }
}

const read = <F,>(b: Bucket, ms: Measure<F>[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const m of ms) {
    out[m.key] = m.agg === 'clients' ? b.clients.size
      : m.agg === 'count' ? b.count
        : (b.sum[m.key] ?? 0);
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
