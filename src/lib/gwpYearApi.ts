// 일반조서 당기 세팅(gwp_year) — 조서 양식 기준 · 검토자(파트너) · 작성자 기본값 · 진행 단계.
// 규칙은 순수 모듈 gwpSetup.ts 에 있다. 여기는 읽고 쓰기만 한다.
import { supabase } from './supabase';
import type { AuditBasis } from './gwpSetup';

export type GwpStage = '계획' | '중간' | '기말' | '완료';

export interface GwpYear {
  id: string;
  engagementId: string;
  auditBasis: AuditBasis;
  /** 감사계약에서 정한 값으로 확인한 때. 없으면 아직 세팅이 끝나지 않은 것. */
  basisConfirmedAt: string | null;
  partner: string;
  authorDefault: string | null;
  stage: GwpStage;
  note: string | null;
  updatedAt: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const toYear = (r: any): GwpYear => ({
  id: r.id, engagementId: r.engagement_id, auditBasis: r.audit_basis,
  basisConfirmedAt: r.basis_confirmed_at ?? null, partner: r.partner ?? '',
  authorDefault: r.author_default ?? null, stage: r.stage, note: r.note ?? null, updatedAt: r.updated_at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 모든 세팅 — 작업 건 id → 세팅. 건 목록에 조서 기준을 함께 보여 주려고 한 번에 읽는다. */
export async function listYears(): Promise<Map<string, GwpYear>> {
  const { data, error } = await supabase.from('gwp_year').select('*');
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r) => { const y = toYear(r); return [y.engagementId, y]; }));
}

/** 세팅 저장 — 작업 건마다 하나라 있으면 고치고 없으면 만든다. 저장하는 순간이 「감사계약 값으로 확인」한 때다. */
export async function saveYear(engagementId: string, v: { auditBasis: AuditBasis; partner: string; authorDefault: string | null }): Promise<GwpYear> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id ?? null;
  const { data, error } = await supabase.from('gwp_year').upsert({
    engagement_id: engagementId,
    audit_basis: v.auditBasis,
    partner: v.partner.trim(),
    author_default: v.authorDefault?.trim() || null,
    basis_confirmed_at: new Date().toISOString(),
    basis_confirmed_by: uid,
    updated_by: uid,
  }, { onConflict: 'engagement_id' }).select('*').single();
  if (error) throw new Error(error.message);
  return toYear(data);
}

/**
 * 그 회사 감사 매출계약의 담당회계사 — 작성자 기본값의 원천(사용자 2026-09-25).
 * 같은 귀속연도 계약이 있으면 그것, 없으면 가장 최근 계약.
 */
export async function auditContractCpa(entityId: string, fy: number): Promise<string | null> {
  const { data, error } = await supabase.from('biz_sales_contract')
    .select('cpa, fiscal_year, category_code')
    .eq('entity_id', entityId).eq('team', '감사team').like('category_code', 'AUD.AUDIT%')
    .order('fiscal_year', { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { cpa: string | null; fiscal_year: number | null }[];
  return (rows.find((r) => r.fiscal_year === fy) ?? rows[0])?.cpa ?? null;
}
