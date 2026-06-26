// 청구기록(billing_records) Supabase 데이터 레이어
// payload(jsonb)에 WizardState+CalcResult 전체 스냅샷을 저장하고, 조회용 핵심 컬럼을 별도 보관한다.
import { supabase } from './supabase';
import type { BillingRecord } from '../types';

interface BillingRow {
  id: string;
  client_id: string | null;
  fiscal_year: number;
  biz_type: string;
  company_name: string;
  manager: string;
  revenue: number;
  grand_total: number;
  cfg_version_id: string;
  cfg_version_label: string;
  payload: Record<string, unknown>;
  saved_at: string;
}

function rowToRecord(r: BillingRow): BillingRecord {
  // payload 가 전체 스냅샷(S + Calc) — 상단 컬럼으로 메타만 보정
  return {
    ...(r.payload as unknown as BillingRecord),
    id: r.id,
    savedAt: r.saved_at,
    cfgVersionId: r.cfg_version_id,
    cfgVersionLabel: r.cfg_version_label,
  };
}

/** 전체 청구기록 조회 (최근 저장순) */
export async function listBillingRecords(): Promise<BillingRecord[]> {
  const { data, error } = await supabase
    .from('billing_records')
    .select('*')
    .order('saved_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as BillingRow[]).map(rowToRecord);
}

/** 청구기록 저장 (원본 saveRec의 addHist) */
export async function createBillingRecord(rec: BillingRecord): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const row = {
    client_id: rec.selClientId,
    fiscal_year: rec.fiscalYear,
    biz_type: rec.bizType,
    company_name: rec.companyName,
    manager: rec.manager,
    revenue: rec.rev,
    grand_total: rec.grand,
    cfg_version_id: rec.cfgVersionId || 'v0',
    cfg_version_label: rec.cfgVersionLabel || '기본',
    payload: rec as unknown as Record<string, unknown>,
    created_by: u.user?.id ?? null,
    saved_at: rec.savedAt,
  };
  const { error } = await supabase.from('billing_records').insert(row);
  if (error) throw new Error(error.message);
}

/** 청구기록 삭제 */
export async function deleteBillingRecord(id: string): Promise<void> {
  const { error } = await supabase.from('billing_records').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
