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
/** 발송완료 이후 후속 상태 — 사유·메모(status_note) 함께 기록
 *  흐름: 발송완료 → [처리자]반송 → [원 요청자]재발송요청 → [처리자]재발송완료 */
export const POST_SEND_STATUS = ['반송', '재발송요청', '재발송완료'] as const;
/** 처리 대기열(미완결) 상태 — 재발송요청은 처리자가 다시 처리해야 하는 건 */
export const isClosedStatus = (s: string) => s === '발송완료' || s === '재발송완료';
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
  statusNote: string;
  /** 원 요청자(작성 계정) — 반송 건 재발송요청 권한 판정용 */
  requesterId: string | null;
  createdBy: string | null;
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
  status_note: string | null;
  requester_id: string | null;
  created_by: string | null;
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
    statusNote: r.status_note || '',
    requesterId: r.requester_id,
    createdBy: r.created_by,
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

/** 발송요청 생성 — 공통 정보 + 수신자 N명(각 개별 건, 같은 batch_id). batchId 는 호출부에서 생성(첨부와 공유). */
export async function createSendRequests(common: SendCommon, recipients: SendRecipient[], batchId: string): Promise<number> {
  if (!recipients.length) throw new Error('수신자를 1명 이상 선택하세요.');
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

/** 발송요청 삭제 (미접수 건만 — 서버 트리거가 그 외 차단). 배치의 마지막 건이면 첨부도 정리. */
export async function deleteSendRequest(id: string): Promise<void> {
  const { data: row } = await supabase.from('doc_send_requests').select('batch_id').eq('id', id).maybeSingle();
  const { error } = await supabase.from('doc_send_requests').delete().eq('id', id);
  if (error) throw new Error(error.message);
  const batchId = (row as { batch_id: string | null } | null)?.batch_id;
  if (!batchId) return;
  const { count } = await supabase
    .from('doc_send_requests')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', batchId);
  if ((count ?? 0) > 0) return; // 아직 배치에 남은 요청 있음 → 첨부 유지
  const { data: atts } = await supabase.from('doc_send_attachments').select('id, storage_path').eq('batch_id', batchId);
  const list = (atts as { id: string; storage_path: string }[] | null) ?? [];
  if (list.length) {
    await supabase.storage.from('doc-send').remove(list.map((a) => a.storage_path));
    await supabase.from('doc_send_attachments').delete().eq('batch_id', batchId);
  }
}

// ── 발송요청 처리(상태·발송일·등기번호) ─────────────────────
/** 처리 필드 갱신 — 서버 트리거가 권한 없는 자를 차단한다. */
export async function setProcessing(
  id: string,
  patch: { status?: string; sentDate?: string | null; trackingNo?: string; statusNote?: string | null },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.sentDate !== undefined) row.sent_date = patch.sentDate || null;
  if (patch.trackingNo !== undefined) row.tracking_no = patch.trackingNo?.trim() ? patch.trackingNo.trim() : null;
  if (patch.statusNote !== undefined) row.status_note = patch.statusNote?.trim() ? patch.statusNote.trim() : null;
  const { data, error } = await supabase.from('doc_send_requests').update(row).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertChanged(data);
}

/** RLS가 막으면 예외 없이 "0행 변경"으로 끝나 성공처럼 보인다. 실제로 바뀐 행이 있는지 확인한다. */
function assertChanged(data: unknown[] | null): void {
  if (!data || data.length === 0) {
    throw new Error('변경되지 않았습니다 — 권한이 없거나(읽기전용 계정) 대상 건이 없습니다.');
  }
}

/** 반송 건의 재발송요청 — 원 요청자만 가능(서버 가드 0039). 발송일·등기번호는 1차 기록으로 보존한다.
 *  사유 칸은 하나뿐이므로 처리자가 맥락을 잃지 않도록 반송 사유를 앞에 남겨 함께 표시한다. */
export async function requestResend(id: string, memo: string, bounceNote?: string): Promise<void> {
  const m = memo.trim();
  const b = (bounceNote || '').trim();
  const note = b ? `반송: ${b} / 재발송요청: ${m}` : m;
  const { data, error } = await supabase
    .from('doc_send_requests')
    .update({ status: '재발송요청', status_note: note || null })
    .eq('id', id)
    .select('id');
  if (error) throw new Error(error.message);
  assertChanged(data);
}

/** 등기번호 → 우체국(epost) 국내등기 배달조회 딥링크(GET, 새 창에서 결과 바로 표시) */
export function epostTrackingUrl(trackingNo: string): string {
  const digits = (trackingNo || '').replace(/\D/g, '');
  return `https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=${digits}&displayHeader=N`;
}

// ── 첨부파일(인쇄·발송용) ───────────────────────────────────
export const ATTACH_ACCEPT = '.hwp,.hwpx,.doc,.docx,.pdf,.xls,.xlsx';
export const ATTACH_MAX_BYTES = 20 * 1024 * 1024; // 20MB

export interface SendAttachment {
  id: string;
  batchId: string;
  fileName: string;
  storagePath: string;
  mime: string;
  sizeBytes: number;
  uploadedAt: string;
}

/** 파일을 doc-send 버킷에 업로드 → 메타 반환(아직 DB 미기록) */
export async function uploadSendFile(
  batchId: string,
  file: File,
): Promise<{ fileName: string; storagePath: string; mime: string; sizeBytes: number }> {
  if (file.size > ATTACH_MAX_BYTES) throw new Error(`"${file.name}" — 20MB 이하만 첨부할 수 있습니다.`);
  // 스토리지 키는 ASCII만 허용(한글 파일명은 'Invalid key' 오류). uuid+확장자로 저장하고,
  // 원본 파일명(한글 포함)은 DB file_name 에 보관 → 다운로드 시 원본명으로 내려준다.
  const ext = (file.name.match(/\.([A-Za-z0-9]+)$/)?.[1] || 'bin').toLowerCase();
  const path = `${batchId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('doc-send').upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw new Error(error.message);
  return { fileName: file.name, storagePath: path, mime: file.type || '', sizeBytes: file.size };
}

/** 업로드한 파일들의 메타를 DB에 기록 */
export async function addAttachmentRecords(
  batchId: string,
  metas: { fileName: string; storagePath: string; mime: string; sizeBytes: number }[],
): Promise<void> {
  if (!metas.length) return;
  const rows = metas.map((m) => ({
    batch_id: batchId,
    file_name: m.fileName,
    storage_path: m.storagePath,
    mime: m.mime || null,
    size_bytes: m.sizeBytes,
  }));
  const { error } = await supabase.from('doc_send_attachments').insert(rows);
  if (error) throw new Error(error.message);
}

/** 전체 첨부 조회 (컴포넌트에서 batchId 로 매핑) */
export async function listAttachments(): Promise<SendAttachment[]> {
  const { data, error } = await supabase
    .from('doc_send_attachments')
    .select('id, batch_id, file_name, storage_path, mime, size_bytes, uploaded_at')
    .order('uploaded_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as {
    id: string; batch_id: string; file_name: string; storage_path: string; mime: string | null; size_bytes: number | null; uploaded_at: string;
  }[]).map((r) => ({
    id: r.id,
    batchId: r.batch_id,
    fileName: r.file_name,
    storagePath: r.storage_path,
    mime: r.mime || '',
    sizeBytes: r.size_bytes ?? 0,
    uploadedAt: r.uploaded_at,
  }));
}

/** 다운로드용 서명 URL (2분). downloadName 지정 시 원본 파일명으로 내려받게 한다. */
export async function signedAttachmentUrl(storagePath: string, downloadName?: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('doc-send')
    .createSignedUrl(storagePath, 120, downloadName ? { download: downloadName } : undefined);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/** 첨부 삭제 (스토리지 + 메타) */
export async function deleteAttachment(att: SendAttachment): Promise<void> {
  await supabase.storage.from('doc-send').remove([att.storagePath]);
  const { error } = await supabase.from('doc_send_attachments').delete().eq('id', att.id);
  if (error) throw new Error(error.message);
}
