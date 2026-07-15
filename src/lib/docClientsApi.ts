// 문서발송 › 거래처 담당자 관리 데이터 레이어
// 계층형: 거래처(회사) → 담당자 N명. CRUD 는 트리거로 감사로그·회사명 변경이력이 자동 기록된다.
import { supabase } from './supabase';

/** 담당회계사 드롭다운 선택지 */
export const DOC_ACCOUNTANTS = ['정우철', '송현주', '조현규', '김준성'] as const;

export interface DocContact {
  id: string;
  clientId: string;
  contactName: string;
  honorific: string;
  phone: string;
  email: string;
  address: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocClient {
  id: string;
  companyName: string;
  accountant: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  contacts: DocContact[];
}

export interface DocNameHistory {
  id: string;
  clientId: string;
  oldName: string;
  newName: string;
  changedByName: string;
  changedAt: string;
}

export interface DocAudit {
  id: number;
  entity: 'client' | 'contact' | 'send_request';
  action: 'insert' | 'update' | 'delete';
  entityId: string | null;
  clientId: string | null;
  actorName: string;
  summary: string;
  at: string;
}

interface ContactRow {
  id: string;
  client_id: string;
  contact_name: string;
  honorific: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}
interface ClientRow {
  id: string;
  company_name: string;
  accountant: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  doc_contacts: ContactRow[] | null;
}

function toContact(r: ContactRow): DocContact {
  return {
    id: r.id,
    clientId: r.client_id,
    contactName: r.contact_name || '',
    honorific: r.honorific || '님',
    phone: r.phone || '',
    email: r.email || '',
    address: r.address || '',
    note: r.note || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function toClient(r: ClientRow): DocClient {
  const contacts = (r.doc_contacts || [])
    .map(toContact)
    .sort((a, b) => a.contactName.localeCompare(b.contactName, 'ko'));
  return {
    id: r.id,
    companyName: r.company_name || '',
    accountant: r.accountant || '',
    note: r.note || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    contacts,
  };
}

/** 거래처 전체(담당자 포함) 조회 — 회사명 오름차순 */
export async function listDocClients(): Promise<DocClient[]> {
  const { data, error } = await supabase
    .from('doc_clients')
    .select('*, doc_contacts(*)')
    .order('company_name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as ClientRow[]).map(toClient);
}

/** 신규 거래처 생성 → id 반환 */
export async function createDocClient(input: {
  companyName: string;
  accountant: string;
  note?: string;
}): Promise<string> {
  const { data, error } = await supabase
    .from('doc_clients')
    .insert({ company_name: input.companyName, accountant: input.accountant, note: input.note || null })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

/** 거래처 수정 (회사명 변경 시 트리거가 이력 적재) */
export async function updateDocClient(
  id: string,
  patch: { companyName?: string; accountant?: string; note?: string },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.companyName !== undefined) row.company_name = patch.companyName;
  if (patch.accountant !== undefined) row.accountant = patch.accountant;
  if (patch.note !== undefined) row.note = patch.note || null;
  const { error } = await supabase.from('doc_clients').update(row).eq('id', id);
  if (error) throw new Error(error.message);
}

/** 거래처 삭제 (담당자 cascade 삭제, 각각 로그 기록) */
export async function deleteDocClient(id: string): Promise<void> {
  const { error } = await supabase.from('doc_clients').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** 담당자 생성 (호칭 미기재 시 '님') */
export async function createDocContact(input: {
  clientId: string;
  contactName: string;
  honorific?: string;
  phone?: string;
  email?: string;
  address?: string;
  note?: string;
}): Promise<void> {
  const { error } = await supabase.from('doc_contacts').insert({
    client_id: input.clientId,
    contact_name: input.contactName,
    honorific: (input.honorific || '').trim() || '님',
    phone: input.phone || null,
    email: input.email || null,
    address: input.address || null,
    note: input.note || null,
  });
  if (error) throw new Error(error.message);
}

/** 담당자 수정 */
export async function updateDocContact(
  id: string,
  patch: {
    contactName?: string;
    honorific?: string;
    phone?: string;
    email?: string;
    address?: string;
    note?: string;
  },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.contactName !== undefined) row.contact_name = patch.contactName;
  if (patch.honorific !== undefined) row.honorific = (patch.honorific || '').trim() || '님';
  if (patch.phone !== undefined) row.phone = patch.phone || null;
  if (patch.email !== undefined) row.email = patch.email || null;
  if (patch.address !== undefined) row.address = patch.address || null;
  if (patch.note !== undefined) row.note = patch.note || null;
  const { error } = await supabase.from('doc_contacts').update(row).eq('id', id);
  if (error) throw new Error(error.message);
}

/** 담당자 삭제 */
export async function deleteDocContact(id: string): Promise<void> {
  const { error } = await supabase.from('doc_contacts').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** 특정 거래처의 회사명 변경이력 (최신순) */
export async function listNameHistory(clientId: string): Promise<DocNameHistory[]> {
  const { data, error } = await supabase
    .from('doc_client_name_history')
    .select('*')
    .eq('client_id', clientId)
    .order('changed_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (
    data as {
      id: string;
      client_id: string;
      old_name: string;
      new_name: string;
      changed_by_name: string | null;
      changed_at: string;
    }[]
  ).map((r) => ({
    id: r.id,
    clientId: r.client_id,
    oldName: r.old_name,
    newName: r.new_name,
    changedByName: r.changed_by_name || '',
    changedAt: r.changed_at,
  }));
}

/** 변경 로그 (최근순) */
export async function listAuditLog(limit = 200): Promise<DocAudit[]> {
  const { data, error } = await supabase
    .from('doc_audit_log')
    .select('id, entity, action, entity_id, client_id, actor_name, summary, at')
    .order('at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (
    data as {
      id: number;
      entity: 'client' | 'contact' | 'send_request';
      action: 'insert' | 'update' | 'delete';
      entity_id: string | null;
      client_id: string | null;
      actor_name: string | null;
      summary: string | null;
      at: string;
    }[]
  ).map((r) => ({
    id: r.id,
    entity: r.entity,
    action: r.action,
    entityId: r.entity_id,
    clientId: r.client_id,
    actorName: r.actor_name || '',
    summary: r.summary || '',
    at: r.at,
  }));
}
