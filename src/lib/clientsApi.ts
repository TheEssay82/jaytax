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
