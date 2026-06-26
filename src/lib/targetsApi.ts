// 청구대상(billing_targets) Supabase 데이터 레이어
// 원본 ind_tgt4 = {year: {clientId: true}} → (fiscal_year, client_id) 한 행 = 대상 선택됨
import { supabase } from './supabase';

export interface Target {
  fiscalYear: number;
  clientId: string;
}

/** 전체 청구대상 조회 */
export async function listTargets(): Promise<Target[]> {
  const { data, error } = await supabase.from('billing_targets').select('fiscal_year, client_id');
  if (error) throw new Error(error.message);
  return (data as { fiscal_year: number; client_id: string }[]).map((r) => ({
    fiscalYear: r.fiscal_year,
    clientId: r.client_id,
  }));
}

/** 청구대상 설정/해제 (원본 setTarget) */
export async function setTarget(year: number, clientId: string, val: boolean): Promise<void> {
  if (val) {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('billing_targets')
      .upsert(
        { fiscal_year: year, client_id: clientId, created_by: u.user?.id ?? null },
        { onConflict: 'fiscal_year,client_id' },
      );
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from('billing_targets')
      .delete()
      .eq('fiscal_year', year)
      .eq('client_id', clientId);
    if (error) throw new Error(error.message);
  }
}
