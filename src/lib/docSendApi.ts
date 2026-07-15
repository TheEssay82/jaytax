// 문서발송 › 발송요청 데이터 레이어
import { supabase } from './supabase';

// ── 선택지(변수정리 시트 기준) ──────────────────────────────
export const WORK_TYPES = ['우체국', '퀵서비스', '회계사책상'] as const;
export const SEND_KINDS = [
  '계약서', '세무조정계산서', '일반감사보고서', '연결감사보고서', '주식가치평가보고서',
  '동업기업 소득계산 및 배분명세서', '상증세평가보고서', '조회서', '실사보고서',
  '기타보고서', '기타증명서', '기타',
] as const;
export const DEADLINES = ['긴급', '보통', '지연가능'] as const;
export const SEND_STATUS = ['미접수', '진행중', '발송완료'] as const;
/** 의뢰인 후보(변수정리) — 대리 지정용 */
export const DOC_REQUESTERS = ['조현규', '김준성', '정우철', '송현주', '정남지', '김민섭', '김동주', '안지연'] as const;

export interface SendRequest {
  id: string;
  batchId: string | null;
  requestDate: string;
  requester: string;
  workType: string;
  sendKind: string;
  docName: string;
  copies: number;
  sealRequired: boolean;
  deadline: string;
  etcRequest: string;
  clientId: string | null;
  contactId: string | null;
  companyName: string;
  recipientName: string;
  recipientTitle: string;
  address: string;
  phone: string;
  status: string;
  sentDate: string | null;
  trackingNo: string;
  createdAt: string;
  updatedAt: string;
}

/** 발송요청 공통(문서) 정보 */
export interface SendCommon {
  requestDate: string;
  requester: string;
  workType: string;
  sendKind: string;
  docName: string;
  copies: number;
  sealRequired: boolean;
  deadline: string;
  etcRequest: string;
}
/** 수신자(거래처 담당자) 스냅샷 */
export interface SendRecipient {
  clientId: string;
  contactId: string | null;
  companyName: string;
  recipientName: string;
  recipientTitle: string;
  address: string;
  phone: string;
}

interface Row {
  id: string;
  batch_id: string | null;
  request_date: string;
  requester: string;
  work_type: string;
  send_kind: string;
  doc_name: string | null;
  copies: number;
  seal_required: boolean;
  deadline: string;
  etc_request: string | null;
  client_id: string | null;
  contact_id: string | null;
  company_name: string;
  recipient_name: string | null;
  recipient_title: string | null;
  address: string | null;
  phone: string | null;
  status: string;
  sent_date: string | null;
  tracking_no: string | null;
  created_at: string;
  updated_at: string;
}

function toReq(r: Row): SendRequest {
  return {
    id: r.id,
    batchId: r.batch_id,
    requestDate: r.request_date,
    requester: r.requester || '',
    workType: r.work_type || '',
    sendKind: r.send_kind || '',
    docName: r.doc_name || '',
    copies: r.copies ?? 1,
    sealRequired: !!r.seal_required,
    deadline: r.deadline || '보통',
    etcRequest: r.etc_request || '',
    clientId: r.client_id,
    contactId: r.contact_id,
    companyName: r.company_name || '',
    recipientName: r.recipient_name || '',
    recipientTitle: r.recipient_title || '',
    address: r.address || '',
    phone: r.phone || '',
    status: r.status || '미접수',
    sentDate: r.sent_date,
    trackingNo: r.tracking_no || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** 전체 발송요청 조회 (의뢰일자·생성 최신순) */
export async function listSendRequests(): Promise<SendRequest[]> {
  const { data, error } = await supabase
    .from('doc_send_requests')
    .select('*')
    .order('request_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as Row[]).map(toReq);
}

/** 발송요청 생성 — 공통 정보 + 수신자 N명(각 개별 건, 같은 batch_id) */
export async function createSendRequests(common: SendCommon, recipients: SendRecipient[]): Promise<number> {
  if (!recipients.length) throw new Error('수신자를 1명 이상 선택하세요.');
  const batchId = recipients.length > 1 ? crypto.randomUUID() : null;
  const rows = recipients.map((rc) => ({
    batch_id: batchId,
    request_date: common.requestDate,
    requester: common.requester,
    work_type: common.workType,
    send_kind: common.sendKind,
    doc_name: common.docName || null,
    copies: common.copies || 1,
    seal_required: common.sealRequired,
    deadline: common.deadline,
    etc_request: common.etcRequest || null,
    client_id: rc.clientId,
    contact_id: rc.contactId,
    company_name: rc.companyName,
    recipient_name: rc.recipientName || null,
    recipient_title: rc.recipientTitle || null,
    address: rc.address || null,
    phone: rc.phone || null,
  }));
  const { error } = await supabase.from('doc_send_requests').insert(rows);
  if (error) throw new Error(error.message);
  return rows.length;
}

/** 발송요청 수정 (미접수 건 대상) */
export async function updateSendRequest(
  id: string,
  patch: Partial<SendCommon> & Partial<SendRecipient>,
): Promise<void> {
  const row: Record<string, unknown> = {};
  const map: Record<string, string> = {
    requestDate: 'request_date', requester: 'requester', workType: 'work_type', sendKind: 'send_kind',
    docName: 'doc_name', copies: 'copies', sealRequired: 'seal_required', deadline: 'deadline',
    etcRequest: 'etc_request', clientId: 'client_id', contactId: 'contact_id', companyName: 'company_name',
    recipientName: 'recipient_name', recipientTitle: 'recipient_title', address: 'address', phone: 'phone',
  };
  for (const [k, v] of Object.entries(patch)) {
    const col = map[k];
    if (!col) continue;
    row[col] = v === '' && ['doc_name', 'etc_request', 'recipient_name', 'recipient_title', 'address', 'phone'].includes(col) ? null : v;
  }
  const { error } = await supabase.from('doc_send_requests').update(row).eq('id', id);
  if (error) throw new Error(error.message);
}

/** 발송요청 삭제 (미접수 건만 — 서버 트리거가 그 외 차단) */
export async function deleteSendRequest(id: string): Promise<void> {
  const { error } = await supabase.from('doc_send_requests').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
