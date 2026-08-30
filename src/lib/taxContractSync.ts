// 청구기록 → 매출계약(세무조정) 금액 연동
//
// 세무조정은 담당회계사에 따라 관리 경로가 갈린다.
//  · 정우철 담당 → 세무조정수수료관리에서 청구서를 만든다. 계약금액은 사람이 적는 값이 아니라
//    그 청구 결과에서 따라와야 한다(여기서 하는 일).
//  · 김준성·조현규 담당 → 청구서를 만들지 않고 매출계약에 금액을 직접 적는다(건드리지 않는다).
// 어느 쪽이든 taxteam 매출은 거래처관리(매출계약)에서 집계돼야 하므로, 청구서를 확정하면
// 해당 연도 세무조정 계약을 만들어 두거나 금액을 맞춰 준다.
//
// 금액 규칙: 계약금액 = 공급가액 = 청구총액 ÷ 1.1 (기존 84건 전부 이 관계로 들어와 있다).
import { supabase } from './supabase';
import { createSalesContract, listSalesContracts, updateSalesContract } from './salesContractApi';

/** 청구총액(부가세 포함) → 계약금액(공급가액) */
export const supplyAmount = (grandTotal: number): number => Math.round((grandTotal / 1.1) * 100) / 100;

export interface TaxSyncResult {
  action: 'created' | 'updated' | 'skipped';
  reason?: string;
  contractCode?: string;
  amount?: number;
}

/**
 * 확정된 청구기록 1건을 그 해 세무조정 매출계약에 반영한다.
 * 계약이 있으면 금액만 맞추고, 없으면 만든다(법인=법인세·개인=종합소득세).
 * 실패해도 청구 저장 자체를 막지 않도록, 호출부에서 결과만 보고 넘어가도 된다.
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
    .select('entity_id, place_id')
    .eq('id', rec.clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const link = data as { entity_id: string | null; place_id: string | null } | null;
  if (!link?.entity_id) return { action: 'skipped', reason: '거래처관리에 연결되지 않은 거래처' };

  const categoryCode = rec.bizType === '법인' ? 'TAX.FILING.CORP' : 'TAX.FILING.INCOME';
  const amount = supplyAmount(rec.grandTotal);

  const all = await listSalesContracts();
  const hit = all.find(
    (c) => c.entityId === link.entity_id && c.categoryCode === categoryCode && Number(c.fiscalYear) === Number(rec.fiscalYear),
  );

  if (hit) {
    if (Number(hit.amount) === amount) return { action: 'skipped', reason: '금액 동일', contractCode: hit.contractCode ?? undefined, amount };
    await updateSalesContract(hit.id, { amount });
    return { action: 'updated', contractCode: hit.contractCode ?? undefined, amount };
  }

  // 0원 청구(미완성·면제 등)로는 계약을 새로 만들지 않는다 — 빈 계약이 집계를 어지럽힌다.
  if (amount <= 0) return { action: 'skipped', reason: '금액 0원이라 계약을 만들지 않음' };

  // 기존 세무조정 계약과 같은 규격으로 만든다: 정산기간 7/1~익년 6/30, 연 1회, 담당 정우철.
  const y = Number(rec.fiscalYear);
  await createSalesContract({
    entityId: link.entity_id,
    placeId: link.place_id,
    team: 'taxteam',
    categoryCode,
    occurrenceUnit: rec.bizType === '법인' ? '법인' : '개인',
    billingCycle: '연',
    amount,
    cpa: '정우철',
    fiscalYear: y,
    startDate: `${y}-07-01`,
    endDate: `${y + 1}-06-01`,
    note: '세무조정수수료관리 청구기록에서 자동 생성',
  });
  return { action: 'created', amount };
}
