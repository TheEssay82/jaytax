// 거래처(clients) Supabase 데이터 접근 레이어
// DB(snake_case) ↔ 도메인 타입(camelCase) 매핑을 담당한다.
import { supabase, assertWrote } from './supabase';
import type { Client } from '../types';

/** DB row 형태 (public.clients) */
interface ClientRow {
  id: string;
  biz_type: string;
  company_name: string;
  trade_name: string;
  tax_id: string;
  rep_name: string;
  manager: string;
  bank_account: string;
  is_model: boolean;
  revenues: Record<string, number> | null;
  managers: Record<string, string> | null;
  model_years: Record<string, boolean> | null;
  loss_years: number[] | null;
  entity_id: string | null;
  place_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToClient(r: ClientRow): Client {
  return {
    id: r.id,
    bizType: (r.biz_type as Client['bizType']) || '법인',
    companyName: r.company_name || '',
    tradeName: r.trade_name || '',
    taxId: r.tax_id || '',
    repName: r.rep_name || '',
    manager: r.manager || '',
    bankAccount: r.bank_account || '',
    isModel: !!r.is_model,
    revenues: r.revenues || {},
    managers: r.managers || {},
    modelYears: r.model_years || {},
    lossYears: r.loss_years || [],
    entityId: r.entity_id ?? null,
    placeId: r.place_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** camelCase 부분 객체 → snake_case row (제공된 키만 변환) */
function clientToRow(c: Partial<Client>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (c.bizType !== undefined) row.biz_type = c.bizType;
  if (c.companyName !== undefined) row.company_name = c.companyName;
  if (c.tradeName !== undefined) row.trade_name = c.tradeName;
  if (c.taxId !== undefined) row.tax_id = c.taxId;
  if (c.repName !== undefined) row.rep_name = c.repName;
  if (c.manager !== undefined) row.manager = c.manager;
  if (c.bankAccount !== undefined) row.bank_account = c.bankAccount;
  if (c.isModel !== undefined) row.is_model = c.isModel;
  if (c.revenues !== undefined) row.revenues = c.revenues;
  if (c.managers !== undefined) row.managers = c.managers;
  if (c.modelYears !== undefined) row.model_years = c.modelYears;
  if (c.lossYears !== undefined) row.loss_years = c.lossYears;
  return row;
}

/** 전체 거래처 조회 (회사명 오름차순) */
export async function listClients(): Promise<Client[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('company_name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as ClientRow[]).map(rowToClient);
}

/** 외부인 데모용 마스킹 거래처 조회 (서버 RPC demo_clients — 식별정보 서버에서 마스킹). */
export async function listClientsMasked(): Promise<Client[]> {
  const { data, error } = await supabase.rpc('demo_clients');
  if (error) throw new Error(error.message);
  return (data as ClientRow[]).map(rowToClient);
}

/** 신규 거래처 생성 */
export async function createClient(c: Partial<Client>): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const row = { ...clientToRow(c), created_by: u.user?.id ?? null };
  const { error } = await supabase.from('clients').insert(row);
  if (error) throw new Error(error.message);
}

/** 거래처 수정 (제공된 필드만) */
export async function updateClient(id: string, data: Partial<Client>): Promise<void> {
  const { data: wrote, error } = await supabase.from('clients').update(clientToRow(data)).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(wrote, '저장');
}

/** 거래처 삭제 */
export async function deleteClient(id: string): Promise<void> {
  const { data, error } = await supabase.from('clients').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '삭제');
}

/** 거래처 일괄 삭제 */
export async function deleteClients(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { data, error } = await supabase.from('clients').delete().in('id', ids).select('id');
  if (error) throw new Error(error.message);
  // 일부만 지워지는 경우(권한 없는 건이 섞임)를 성공으로 넘기지 않는다.
  const done = data?.length ?? 0;
  if (done < ids.length) {
    throw new Error(`${ids.length}건 중 ${done}건만 삭제되었습니다 — 나머지는 권한이 없거나 이미 삭제된 건입니다.`);
  }
}

// ── 거래처관리(biz_*) 연동 ────────────────────────────────
// 거래처 등록 창구는 거래처관리 하나뿐이고, 세무조정 청구대상은 여기서 '가져오기'로 편입한다.
// 가져올 때 값을 한 번 복사만 하고 이후 자동 동기화는 하지 않는다 — 회사명이 바뀌면
// 과거 청구서 표기까지 흔들리기 때문이다.

export interface ImportablePlace {
  placeId: string;
  entityId: string;
  code: string;          // 거래처코드-사업장번호 (예: L0001-01)
  bizType: '법인' | '개인';
  companyName: string;   // 거래처(법인격 포함) 표기
  placeName: string;
  taxId: string;
  repName: string;
  manager: string;       // 담당직원(활성 1인)
  status: string;
  already: boolean;      // 이미 청구 거래처로 편입됨
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** 거래처관리 사업장 목록 — 청구 거래처로 가져올 후보(이미 편입된 건은 already=true) */
export async function listImportablePlaces(): Promise<ImportablePlace[]> {
  const [places, taken, reps, staff] = await Promise.all([
    supabase
      .from('biz_place')
      .select('id, entity_id, place_no, place_name, biz_reg_no, status, biz_entity(code, kind, name, corp_form, corp_form_position)')
      .order('place_no'),
    supabase.from('clients').select('place_id').not('place_id', 'is', null),
    supabase.from('biz_representative').select('entity_id, rep_name'),
    supabase.from('biz_place_staff').select('place_id, staff_name, active'),
  ]);
  for (const r of [places, taken, reps, staff]) if (r.error) throw new Error(r.error.message);

  const takenIds = new Set((taken.data as any[]).map((r) => r.place_id as string));
  const repByEntity = new Map<string, string>();
  for (const r of reps.data as any[]) if (!repByEntity.has(r.entity_id)) repByEntity.set(r.entity_id, r.rep_name || '');
  const staffByPlace = new Map<string, string>();
  for (const r of staff.data as any[]) if (r.active !== false && !staffByPlace.has(r.place_id)) staffByPlace.set(r.place_id, r.staff_name || '');

  return (places.data as any[]).map((p) => {
    const e = p.biz_entity || {};
    const sym: Record<string, string> = { 주식회사: '㈜', 유한회사: '(유)', 유한책임회사: '(유책)', 합자회사: '(합자)', 합명회사: '(합명)' };
    const mark = e.corp_form ? sym[e.corp_form] ?? '' : '';
    const companyName = !mark || !e.corp_form_position ? (e.name || '')
      : e.corp_form_position === '앞' ? mark + (e.name || '') : (e.name || '') + mark;
    return {
      placeId: p.id as string,
      entityId: p.entity_id as string,
      code: `${e.code ?? ''}-${String(p.place_no ?? '').padStart(2, '0')}`,
      bizType: (e.kind === '개인' ? '개인' : '법인') as '법인' | '개인',
      companyName,
      placeName: p.place_name || '',
      taxId: p.biz_reg_no || '',
      repName: repByEntity.get(p.entity_id) || '',
      manager: staffByPlace.get(p.id) || '',
      status: p.status || '정상',
      already: takenIds.has(p.id as string),
    };
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 선택한 사업장을 청구 거래처(clients)로 편입 — 생성 건수 반환 */
export async function importPlacesAsClients(places: ImportablePlace[]): Promise<number> {
  const { data: u } = await supabase.auth.getUser();
  const rows = places
    .filter((p) => !p.already)
    .map((p) => ({
      biz_type: p.bizType,
      company_name: p.companyName,
      trade_name: p.placeName && p.placeName !== p.companyName ? p.placeName : '',
      tax_id: p.taxId,
      rep_name: p.repName,
      manager: p.manager,
      bank_account: '',
      is_model: false,
      revenues: {},
      managers: {},
      model_years: {},
      loss_years: [],
      entity_id: p.entityId,
      place_id: p.placeId,
      created_by: u.user?.id ?? null,
    }));
  if (!rows.length) return 0;
  const { data, error } = await supabase.from('clients').insert(rows).select('id');
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** 청구 이력이 있는지 확인 — 있으면 삭제(가져오기 취소)를 막는다. */
export async function clientBillingUsage(id: string): Promise<{ records: number; targets: number; consults: number }> {
  const [rec, tgt, con] = await Promise.all([
    supabase.from('billing_records').select('id', { count: 'exact', head: true }).eq('client_id', id),
    supabase.from('billing_targets').select('id', { count: 'exact', head: true }).eq('client_id', id),
    supabase.from('consultations').select('id', { count: 'exact', head: true }).eq('client_id', id),
  ]);
  for (const r of [rec, tgt, con]) if (r.error) throw new Error(r.error.message);
  return { records: rec.count ?? 0, targets: tgt.count ?? 0, consults: con.count ?? 0 };
}

/** 세무조정 매출계약(법인세·종합소득세) 기준 편입 후보 */
export interface ImportableTaxContract {
  contractId: string;
  contractCode: string;
  entityId: string;
  placeId: string | null;
  code: string;            // 거래처코드 (L0001 / I0001)
  bizType: '법인' | '개인';
  companyName: string;
  taxType: '법인세' | '종합소득세';
  amount: number;          // 계약금액(공급가액)
  cpa: string;             // 담당회계사 — 사업장 기준
  taxId: string;
  repName: string;
  manager: string;
  placeStatus: string;
  confirmed: boolean;      // 계약확정 여부(false=미계약)
  already: boolean;        // 이미 청구 거래처로 편입됨
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 그 해 세무조정 계약이 있는 거래처를 청구 편입 후보로 뽑는다.
 * 세무조정수수료관리는 정우철 담당분만 청구서를 만든다(김준성·조현규 담당분은 매출계약으로만
 * 매출을 잡는다) — 담당회계사는 사업장(biz_place.cpa)에 들어 있어 그 값을 그대로 싣는다.
 */
export async function listImportableTaxContracts(fiscalYear: number): Promise<ImportableTaxContract[]> {
  const [cons, taken, reps, staff] = await Promise.all([
    supabase
      .from('biz_sales_contract')
      .select('id, contract_code, entity_id, place_id, category_code, amount, cpa, confirmed, biz_entity(code, kind, name, corp_form, corp_form_position)')
      .in('category_code', ['TAX.FILING.CORP', 'TAX.FILING.INCOME'])
      .eq('fiscal_year', fiscalYear),
    supabase.from('clients').select('entity_id').not('entity_id', 'is', null),
    supabase.from('biz_representative').select('entity_id, rep_name'),
    supabase.from('biz_place').select('id, entity_id, cpa, biz_reg_no, status, is_headquarters'),
  ]);
  for (const r of [cons, taken, reps, staff]) if (r.error) throw new Error(r.error.message);

  const takenEntities = new Set((taken.data as any[]).map((r) => r.entity_id as string));
  const repByEntity = new Map<string, string>();
  for (const r of reps.data as any[]) if (!repByEntity.has(r.entity_id)) repByEntity.set(r.entity_id, r.rep_name || '');
  const places = staff.data as any[];

  return (cons.data as any[]).map((c) => {
    const e = c.biz_entity || {};
    const sym: Record<string, string> = { 주식회사: '㈜', 유한회사: '(유)', 유한책임회사: '(유책)', 합자회사: '(합자)', 합명회사: '(합명)' };
    const mark = e.corp_form ? sym[e.corp_form] ?? '' : '';
    const companyName = !mark || !e.corp_form_position ? (e.name || '')
      : e.corp_form_position === '앞' ? mark + (e.name || '') : (e.name || '') + mark;
    // 담당회계사·사업자번호는 계약에 달린 사업장 → 없으면 본사 → 없으면 아무 사업장 순으로 찾는다.
    const mine = places.filter((p) => p.entity_id === c.entity_id);
    const place = mine.find((p) => p.id === c.place_id) ?? mine.find((p) => p.is_headquarters) ?? mine[0];
    return {
      contractId: c.id as string,
      contractCode: c.contract_code || '',
      entityId: c.entity_id as string,
      placeId: (place?.id as string) ?? null,
      code: e.code ?? '',
      bizType: (e.kind === '개인' ? '개인' : '법인') as '법인' | '개인',
      companyName,
      taxType: (c.category_code === 'TAX.FILING.CORP' ? '법인세' : '종합소득세') as '법인세' | '종합소득세',
      amount: Number(c.amount) || 0,
      cpa: c.cpa || place?.cpa || '',
      taxId: place?.biz_reg_no || '',
      repName: repByEntity.get(c.entity_id) || '',
      manager: '',
      placeStatus: place?.status || '정상',
      confirmed: c.confirmed !== false,
      already: takenEntities.has(c.entity_id as string),
    };
  }).sort((a, b) => a.companyName.localeCompare(b.companyName, 'ko'));
}

/** 세무조정 계약 기준으로 청구 거래처(clients) 편입 — 생성 건수 반환 */
export async function importTaxContractsAsClients(rows: ImportableTaxContract[]): Promise<number> {
  const { data: u } = await supabase.auth.getUser();
  const seen = new Set<string>();
  const list = rows.filter((r) => !r.already && !seen.has(r.entityId) && (seen.add(r.entityId), true));
  if (!list.length) return 0;
  const { data, error } = await supabase.from('clients').insert(list.map((r) => ({
    biz_type: r.bizType,
    company_name: r.companyName,
    trade_name: '',
    tax_id: r.taxId,
    rep_name: r.repName,
    manager: r.manager,
    bank_account: '',
    is_model: false,
    revenues: {},
    managers: {},
    model_years: {},
    loss_years: [],
    entity_id: r.entityId,
    place_id: r.placeId,
    created_by: u.user?.id ?? null,
  }))).select('id');
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
