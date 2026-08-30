// 청구기록 → 매출계약(세무조정) 금액 연동
//
// 세무조정은 담당회계사에 따라 관리 경로가 갈린다.
//  · 정우철 담당 → 세무조정수수료관리에서 청구서를 만든다. 계약금액은 사람이 적는 값이 아니라
//    그 청구 결과에서 따라온다(여기서 하는 일).
//  · 김준성·조현규 담당 → 청구서를 만들지 않고 매출계약에 금액을 직접 적는다(건드리지 않는다).
//
// 규칙(사용자 확정):
//  · 계약이 **이미 등록돼 있을 때 금액만** 가져간다. 여기서 계약을 새로 만들지 않는다
//    (등록은 매출계약등록에서 사람이 한다 — 기장계약 저장 시 동반 등록을 권하는 장치가 따로 있다).
//  · 담당CPA가 정우철인 계약만 대상. CPA 는 계약에 비어 있으면 사업장(biz_place.cpa)을 따른다.
//  · 계약금액 = 공급가액 = 청구총액 ÷ 1.1 (기존 84건 전부 이 관계로 들어와 있다).
import { supabase } from './supabase';
import { listSalesContracts, updateSalesContract } from './salesContractApi';

/** 세무조정수수료관리로 청구하는 담당회계사 */
export const TAX_ADJ_CPA = '정우철';

/** 청구총액(부가세 포함) → 계약금액(공급가액) */
export const supplyAmount = (grandTotal: number): number => Math.round((grandTotal / 1.1) * 100) / 100;

export interface TaxSyncResult {
  action: 'updated' | 'skipped';
  reason?: string;
  contractCode?: string;
  amount?: number;
}

/**
 * 확정된 청구기록 1건의 금액을 그 해 세무조정 매출계약에 반영한다.
 * 대상 계약이 없거나 담당CPA가 정우철이 아니면 아무것도 하지 않는다.
 */
export async function syncTaxContractFromBilling(rec: {
  clientId: string | null;
  fiscalYear: number;
  bizType: '법인' | '개인';
  grandTotal: number;
}): Promise<TaxSyncResult> {
  if (!rec.clientId) return { action: 'skipped', reason: '거래처가 선택되지 않은 직접입력 건' };

  const { data, error } = await supabase
    .from('clients')
    .select('entity_id')
    .eq('id', rec.clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const entityId = (data as { entity_id: string | null } | null)?.entity_id;
  if (!entityId) return { action: 'skipped', reason: '거래처관리에 연결되지 않은 거래처' };

  const categoryCode = rec.bizType === '법인' ? 'TAX.FILING.CORP' : 'TAX.FILING.INCOME';
  const amount = supplyAmount(rec.grandTotal);

  const all = await listSalesContracts();
  const hit = all.find(
    (c) => c.entityId === entityId && c.categoryCode === categoryCode && Number(c.fiscalYear) === Number(rec.fiscalYear),
  );
  if (!hit) {
    return { action: 'skipped', reason: `${rec.fiscalYear}년 귀속 세무조정 매출계약이 없음 — 매출계약등록에서 먼저 등록하세요` };
  }

  // 담당CPA 는 계약값 우선, 비면 거래처(사업장) 상속 — listSalesContracts 가 계산해 준다.
  const cpa = (hit.effectiveCpa || '').trim();
  if (cpa !== TAX_ADJ_CPA) {
    return { action: 'skipped', reason: `담당회계사가 ${cpa || '미지정'}이라 금액을 건드리지 않음` };
  }

  if (Number(hit.amount) === amount) {
    return { action: 'skipped', reason: '금액 동일', contractCode: hit.contractCode ?? undefined, amount };
  }
  await updateSalesContract(hit.id, { amount });
  return { action: 'updated', contractCode: hit.contractCode ?? undefined, amount };
}
