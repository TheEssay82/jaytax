// 정산연도(귀속연도) 규칙과, 그 규칙에 기대는 순수 판정들.
//
// supabase 를 물지 않는다 — 이 규칙이 테스트로 지켜져야 하기 때문이다.
// (데이터 접근이 붙은 salesContractApi 는 여기서 가져다 다시 내보낸다.)

// 정산기간(회계연도) = 매년 7/1 ~ 익년 6/30. 어떤 날짜의 정산연도 = 월이 7~12면 그 해, 1~6이면 전년.
// (예: 종료 2027-03 → 2026 귀속 / 종료 2026-11 → 2026 귀속). 날짜는 'YYYY-MM' 또는 'YYYY-MM-DD'.
export function settlementYearOfDate(d: string | null | undefined): number | null {
  if (!d || d.length < 7) return null;
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
  if (!y || !m) return null;
  return m >= 7 ? y : y - 1;
}

export interface TaxFilingRow {
  id: string;
  contract_code: string | null;
  amount: number | null;
  fiscal_year: number | null;
  start_date: string | null;
  end_date: string | null;
}

/**
 * 확정일에 해당하는 세무조정 계약 하나를 고른다.
 *
 * **정산연도로 맞춘다.** 계약 기간으로 맞추면 안 된다 — 계약의 종료일은 관행상
 * `익년 06-01` 로 들어가 있어서(164건), 성실신고 종합소득세처럼 **6/30 에 확정되는
 * 건이 기간 밖으로 떨어진다**. 정산기간은 7/1~익6/30 이므로 3월말·5월말·6월말
 * 확정이 모두 같은 정산연도로 모인다.
 *
 * fiscal_year 가 비어 있는 옛 계약만 기간 포함으로 보조 판정한다.
 * 후보가 여럿이면 금액이 비어 있는 것(= 채워지길 기다리는 자리)을 먼저 고른다.
 */
export function pickTaxFilingContract(rows: TaxFilingRow[], onDate: string): TaxFilingRow | null {
  const fy = settlementYearOfDate(onDate);
  const byYear = rows.filter((c) => c.fiscal_year != null && Number(c.fiscal_year) === fy);
  const byRange = rows.filter((c) => c.fiscal_year == null
    && (!c.start_date || c.start_date <= onDate) && (!c.end_date || c.end_date >= onDate));
  const cands = byYear.length ? byYear : byRange;
  if (!cands.length) return null;
  return cands.find((c) => !Number(c.amount)) ?? cands[0];
}
