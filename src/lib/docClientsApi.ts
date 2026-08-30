// 문서발송·조회서용 거래처/담당자 '별칭(alias)' 읽기 레이어
// 마스터는 거래처관리(biz_entity/biz_contact)다. 0070 마이그레이션 이후 doc_clients/doc_contacts 는
// biz_* 에서 트리거로 자동 동기화되는 별칭이며, 등록·수정·삭제는 거래처관리에서만 한다.
// (기존 발송·조회서 이력이 이 테이블의 id 를 FK 로 물고 있어 테이블 자체는 남겨둔다.)
import { supabase } from './supabase';

export interface DocContact {
  id: string;
  clientId: string;
  /** 거래처관리 담당자(biz_contact) id — 별칭 연결 */
  bizContactId: string | null;
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
  /** 거래처관리 거래처(biz_entity) id — 별칭 연결 */
  entityId: string | null;
  accountant: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  contacts: DocContact[];
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
  /** 변경 전/후 스냅샷 — 상태 전이·사유를 화면에 풀어 보여주는 데 사용 */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/** 감사로그 1건에서 사람이 읽을 변경 내역을 뽑아낸다(상태 전이·사유·발송일·등기번호). */
export function auditChanges(a: DocAudit): string[] {
  const b = a.before ?? {};
  const f = a.after ?? {};
  const s = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
  const out: string[] = [];
  const label: Record<string, string> = {
    status: '상태',
    status_note: '사유·메모',
    sent_date: '발송일',
    tracking_no: '등기번호',
  };
  if (a.action === 'update') {
    for (const k of Object.keys(label)) {
      if (s(b[k]) !== s(f[k])) out.push(`${label[k]}: ${s(b[k])} → ${s(f[k])}`);
    }
  } else if (a.action === 'insert') {
    if (f.status) out.push(`상태: ${s(f.status)}`);
  }
  return out;
}

interface ContactRow {
  id: string;
  client_id: string;
  biz_contact_id: string | null;
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
  entity_id: string | null;
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
    bizContactId: r.biz_contact_id,
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
    entityId: r.entity_id,
    accountant: r.accountant || '',
    note: r.note || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    contacts,
  };
}

/**
 * 거래처 전체(담당자 포함) 조회 — 회사명 오름차순.
 * 거래처관리에 연결된 별칭만 돌려준다. 연결이 끊긴 레거시 행(과거 발송·조회서 이력용)은
 * 새 발송요청·조회서 후보로 뜨면 안 되므로 제외한다.
 */
export async function listDocClients(): Promise<DocClient[]> {
  const { data, error } = await supabase
    .from('doc_clients')
    .select('*, doc_contacts(*)')
    .not('entity_id', 'is', null)
    .order('company_name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as ClientRow[])
    .map(toClient)
    .map((c) => ({ ...c, contacts: c.contacts.filter((ct) => ct.bizContactId) }));
}

/** 변경 로그 (최근순) */
export async function listAuditLog(limit = 200): Promise<DocAudit[]> {
  const { data, error } = await supabase
    .from('doc_audit_log')
    .select('id, entity, action, entity_id, client_id, actor_name, summary, before, after, at')
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
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
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
    before: r.before,
    after: r.after,
    at: r.at,
  }));
}
