// 월별 매출실적(biz_revenue_actual) 조회 레이어. 계약(projection)과 분리된 실제 청구실적.
import { supabase } from './supabase';

export interface MonthlyActual {
  ym: string;          // 'YYYY-MM'
  team: string;
  category: string;    // 기장/세무조정/신고대리/원천/컨설팅
  amount: number;      // 공급가액(순액)
}

/** 특정 정산연도(회계연도)의 월별 실적 행 전체. 컴포넌트에서 팀·월·카테고리로 집계. */
export async function listActualsForYear(settlementYear: number): Promise<MonthlyActual[]> {
  const { data, error } = await supabase
    .from('biz_revenue_actual')
    .select('ym, team, category, amount')
    .eq('settlement_year', settlementYear);
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data as any[]).map((r) => ({ ym: r.ym, team: r.team, category: r.category || '', amount: r.amount != null ? Number(r.amount) : 0 }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** 실적이 존재하는 정산연도 목록(내림차순). */
export async function listActualYears(): Promise<number[]> {
  const { data, error } = await supabase.from('biz_revenue_actual').select('settlement_year');
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const ys = [...new Set((data as any[]).map((r) => r.settlement_year).filter((y) => y != null))] as number[];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return ys.sort((a, b) => b - a);
}
