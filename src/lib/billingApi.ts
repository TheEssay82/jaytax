// 청구기록(billing_records) Supabase 데이터 레이어
// payload(jsonb)에 WizardState+CalcResult 전체 스냅샷을 저장하고, 조회용 핵심 컬럼을 별도 보관한다.
import { supabase } from './supabase';
import { todayYmd } from './format';
import { syncTaxFilingContractAmount, type TaxFilingSync } from './salesContractApi';
import type { BillingRecord } from '../types';

interface BillingRow {
  id: string;
  client_id: string | null;
  fiscal_year: number;
  biz_type: string;
  company_name: string;
  manager: string;
  manager_id: string | null;
  revenue: number;
  grand_total: number;
  cfg_version_id: string;
  cfg_version_label: string;
  payload: Record<string, unknown>;
  status: string | null;
  saved_at: string;
}

function rowToRecord(r: BillingRow): BillingRecord {
  // payload 가 전체 스냅샷(S + Calc) — 상단 컬럼으로 메타만 보정
  const payload = r.payload as unknown as BillingRecord;
  return {
    ...payload,
    id: r.id,
    savedAt: r.saved_at,
    cfgVersionId: r.cfg_version_id,
    cfgVersionLabel: r.cfg_version_label,
    managerId: r.manager_id ?? payload.managerId ?? null,
    status: (r.status as 'draft' | 'final') ?? 'final',
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
    manager_id: rec.managerId ?? null,
    revenue: rec.rev,
    grand_total: rec.grand,
    cfg_version_id: rec.cfgVersionId || 'v0',
    cfg_version_label: rec.cfgVersionLabel || '기본',
    payload: rec as unknown as Record<string, unknown>,
    status: rec.status || 'final',
    created_by: u.user?.id ?? null,
    saved_at: rec.savedAt,
  };
  const { error } = await supabase.from('billing_records').insert(row);
  if (error) {
    throw new Error(
      error.code === RLS_VIOLATION
        ? '청구건을 저장할 권한이 없습니다. 읽기전용 계정이거나 권한이 부족합니다.'
        : error.message,
    );
  }
}

/** 청구기록 수정(덮어쓰기). created_by 는 보존. RLS: 팀장+ 전체 / 팀원은 본인 작성중 건만. */
export async function updateBillingRecord(id: string, rec: BillingRecord): Promise<void> {
  const row = {
    client_id: rec.selClientId,
    fiscal_year: rec.fiscalYear,
    biz_type: rec.bizType,
    company_name: rec.companyName,
    manager: rec.manager,
    manager_id: rec.managerId ?? null,
    revenue: rec.rev,
    grand_total: rec.grand,
    cfg_version_id: rec.cfgVersionId || 'v0',
    cfg_version_label: rec.cfgVersionLabel || '기본',
    payload: rec as unknown as Record<string, unknown>,
    status: rec.status || 'final',
    saved_at: rec.savedAt,
  };
  const { data, error } = await supabase.from('billing_records').update(row).eq('id', id).select('id');
  if (error) throw await explainBlocked(id, '수정', error);
  if (!data?.length) throw await explainBlocked(id, '수정');
}

/** RLS 위반(WITH CHECK) 오류코드 — 메시지가 영문 원문이라 그대로 보여주면 안 된다. */
const RLS_VIOLATION = '42501';

/**
 * 청구건 쓰기가 막혔을 때 실제 이유를 조회해 사람이 이해할 문장으로 돌려준다.
 * 두 가지 경로를 모두 덮는다.
 *  - USING 에 걸림   → 오류 없이 0행 (조용한 실패)
 *  - WITH CHECK 에 걸림 → 42501 예외 (영문 원문 노출)
 * 권한 정책: 최고관리자·회계사·기장팀장은 전건, 그 외는 본인이 작성한 '작성중' 건만.
 */
async function explainBlocked(
  id: string,
  action: '수정' | '확정' | '삭제',
  cause?: { code?: string; message: string },
): Promise<Error> {
  // RLS 외의 진짜 오류(네트워크·제약조건 등)는 원문을 살려 보낸다.
  if (cause && cause.code !== RLS_VIOLATION) return new Error(cause.message);

  const { data } = await supabase
    .from('billing_records')
    .select('status, created_by, company_name')
    .eq('id', id)
    .maybeSingle();
  const rec = data as { status: string | null; created_by: string | null; company_name: string | null } | null;
  if (!rec) return new Error('대상 청구건을 찾을 수 없습니다 — 이미 삭제되었을 수 있습니다. 새로고침 후 다시 확인해 주세요.');

  const { data: u } = await supabase.auth.getUser();
  const me = u.user?.id ?? null;
  const isDraft = (rec.status ?? 'final') === 'draft';
  const label = rec.company_name ? `‘${rec.company_name}’ 청구건` : '이 청구건';

  // 확정 시도인데 본인 작성중 건이면 = 확정 권한 자체가 없는 경우(WITH CHECK 위반)
  if (action === '확정' && isDraft) {
    return new Error(`확정 권한이 없습니다. ${label}을 확정하려면 최고관리자·회계사·기장팀장에게 요청하세요. (작성중 상태로 저장은 가능합니다)`);
  }
  if (!isDraft) {
    return new Error(`확정된 청구서는 ${action}할 수 없습니다. ${label}은 이미 확정 상태입니다 — ${action}이 필요하면 최고관리자·회계사·기장팀장에게 요청하세요.`);
  }
  if (rec.created_by && me && rec.created_by !== me) {
    return new Error(`다른 담당자가 작성한 청구건은 ${action}할 수 없습니다. 본인이 작성한 ‘작성중’ 건만 ${action} 가능합니다.`);
  }
  return new Error(`${action} 권한이 없습니다. 읽기전용 계정이거나 권한이 부족합니다.`);
}

/**
 * 청구기록 확정 (작성중 → 확정). RLS상 팀장+ 만 가능.
 *
 * 확정된 금액은 그 거래처의 **세무조정 매출계약에도 밀어 넣는다** — 기장계약과 함께
 * 금액 0 으로 만들어 둔 자리를 여기서 채운다. 계약 반영이 실패해도 확정 자체는 살린다
 * (돌려주는 값으로 화면이 알린다).
 */
export async function finalizeBillingRecord(id: string): Promise<TaxFilingSync> {
  const { data, error } = await supabase.from('billing_records')
    .update({ status: 'final' }).eq('id', id)
    .select('id, client_id, company_name, payload, grand_total');
  if (error) throw await explainBlocked(id, '확정', error);
  if (!data?.length) throw await explainBlocked(id, '확정');

  const row = data[0] as { client_id: string | null; company_name: string; payload: Record<string, unknown> };
  // 계약에 적는 것은 공급가액(D)이다. grand 는 부가세가 붙은 값이라 쓰면 안 된다.
  const supply = Number((row.payload as { D?: number } | null)?.D ?? 0);
  return syncTaxFilingContractAmount({
    clientId: row.client_id,
    companyName: row.company_name ?? '',
    supplyAmount: supply,
    onDate: todayYmd(),   // UTC 로 찍으면 오전 9시 이전 확정이 어제 정산연도로 갈 수 있다
  });
}

/** 청구기록 삭제 */
export async function deleteBillingRecord(id: string): Promise<void> {
  const { data, error } = await supabase.from('billing_records').delete().eq('id', id).select('id');
  if (error) throw await explainBlocked(id, '삭제', error);
  if (!data?.length) throw await explainBlocked(id, '삭제');
}
