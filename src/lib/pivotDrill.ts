// 피벗 셀 하나에 담긴 **원자료를 되찾는** 규칙. supabase 를 물지 않는다.
//
// 왜 필요한가: 숫자만 보이고 「어느 거래처에서 언제 나온 것인가」를 알 수 없었다.
// 숫자가 이상할 때 왜 그런지 볼 방법이 없어 엑셀로 다시 뽑아야 했다(2026-09-06 지시).
//
// 피벗과 **같은 split 규칙**을 써야 한다 — 다른 규칙으로 되찾으면 합계가 셀 값과 어긋난다.

/** 한 축을 어떻게 가르는가 — DIMS 의 split 과 같은 모양. */
export interface SplitLike<F> { split: (f: F) => { name: string; weight: number }[] }

export interface DrillRow<F> {
  fact: F;
  /** 이 셀에 실제로 담긴 몫. 담당직원처럼 나뉘는 축이면 1보다 작다. */
  weight: number;
}

/**
 * 그 셀에 담긴 줄들을 몫과 함께 돌려준다.
 * `rowName`·`colName` 중 하나만 주면 그 축만 맞춘다(행 합계·열 합계를 볼 때).
 */
export function drill<F>(
  facts: F[], row: SplitLike<F>, col: SplitLike<F>,
  rowName: string | null, colName: string | null,
): DrillRow<F>[] {
  const out: DrillRow<F>[] = [];
  for (const f of facts) {
    for (const r of row.split(f)) {
      if (rowName !== null && r.name !== rowName) continue;
      for (const c of col.split(f)) {
        if (colName !== null && c.name !== colName) continue;
        const weight = r.weight * c.weight;
        if (weight <= 0) continue;
        out.push({ fact: f, weight });
      }
    }
  }
  return out;
}

/** 되찾은 줄들의 합 — 셀 값과 같아야 한다. 어긋나면 규칙이 갈라진 것이다. */
export function drillTotal<F extends { supply: number }>(rows: DrillRow<F>[]): number {
  return rows.reduce((s, r) => s + r.fact.supply * r.weight, 0);
}
