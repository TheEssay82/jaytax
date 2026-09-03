// 조회서발송관리 데이터 레이어.
// 구조: confirmations(거래처 × 회계연도) → confirmation_items(조회처 명세)
// 권한: 조회·쓰기 모두 내부 구성원(외부인 제외). 읽기전용 계정은 서버에서 차단(0041).
import { supabase, assertWrote } from './supabase';
import { todayYmd as localToday } from './format';

/** 조회처 구분 — 2025년 실데이터 기준 6종 */
export const ITEM_KINDS = ['은행', '보험', '보증기관', '증권', '여신전문', '비은행금융'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** 거래처담당자 기본값 — 대부분의 조회서가 수신자를 특정하지 않는다 */
export const DEFAULT_CONTACT = '금융기관조회서담당자';

export interface Confirmation {
  id: string;
  fiscalYear: number;
  clientId: string;
  companyName: string;
  baseDate: string;
  accountantId: string | null;
  accountantName: string;
  status: '작성중' | '등록완료';
  itemCount: number; // 조회처 건수(조인 집계)
  createdAt: string;
  updatedAt: string;
}

export interface ConfirmItem {
  id: string;
  confirmationId: string;
  seq: number;
  kind: ItemKind;
  institution: string;
  isElectronic: boolean;
  address: string;
  postalCode: string;
  phone: string;
  dept: string;
  contactName: string;
  contactTitle: string;
  note: string;
  // 발송·회수 진행
  sent: boolean;
  sentDate: string | null;
  trackingNo: string;
  collectStatus: CollectStatus;
  collectDate: string | null;
  returnReason: string;
}

/** 회수 상태 — null 은 아직 처리 전 */
export type CollectStatus = '회수완료' | '반송' | null;

/** 회계연도 기본값 — 등록 시점의 직전 연도(2026년에 등록하면 2025 회계연도) */
export const defaultFiscalYear = (): number => new Date().getFullYear() - 1;

/** 회계연도 선택지 — 기본값 기준 앞뒤로 넉넉히 */
export function fiscalYearOptions(): number[] {
  const base = defaultFiscalYear();
  const out: number[] = [];
  for (let y = base + 1; y >= base - 5; y--) out.push(y);
  return out;
}

/** 조회발송기준일 기본값 — 해당 회계연도의 12월 31일 */
export const defaultBaseDate = (year: number): string => `${year}-12-31`;

interface Row {
  id: string;
  fiscal_year: number;
  client_id: string;
  company_name: string;
  base_date: string;
  accountant_id: string | null;
  accountant_name: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  confirmation_items?: { count: number }[];
}

const toConfirmation = (r: Row): Confirmation => ({
  id: r.id,
  fiscalYear: r.fiscal_year,
  clientId: r.client_id,
  companyName: r.company_name || '',
  baseDate: r.base_date,
  accountantId: r.accountant_id,
  accountantName: r.accountant_name || '',
  status: (r.status as Confirmation['status']) ?? '작성중',
  itemCount: r.confirmation_items?.[0]?.count ?? 0,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** 조회서 세트 목록. year 를 주면 해당 회계연도만. */
export async function listConfirmations(year?: number): Promise<Confirmation[]> {
  let q = supabase.from('confirmations').select('*, confirmation_items(count)');
  if (year !== undefined) q = q.eq('fiscal_year', year);
  const { data, error } = await q
    .order('fiscal_year', { ascending: false })
    .order('company_name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as Row[]).map(toConfirmation);
}

/** 등록된 회계연도 목록(최신순) — 연도 필터·가져오기 원본 선택에 쓴다. */
export async function listFiscalYears(): Promise<number[]> {
  const { data, error } = await supabase
    .from('confirmations')
    .select('fiscal_year')
    .order('fiscal_year', { ascending: false });
  if (error) throw new Error(error.message);
  return [...new Set((data as { fiscal_year: number }[]).map((r) => r.fiscal_year))];
}

export async function createConfirmation(input: {
  fiscalYear: number;
  clientId: string;
  companyName: string;
  baseDate: string;
  accountantId: string | null;
  accountantName: string;
}): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('confirmations')
    .insert({
      fiscal_year: input.fiscalYear,
      client_id: input.clientId,
      company_name: input.companyName,
      base_date: input.baseDate,
      accountant_id: input.accountantId,
      accountant_name: input.accountantName,
      created_by: u.user?.id ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(friendly(error));
  return (data as { id: string }).id;
}

export async function updateConfirmation(
  id: string,
  patch: Partial<{
    fiscalYear: number;
    clientId: string;
    companyName: string;
    baseDate: string;
    accountantId: string | null;
    accountantName: string;
    status: string;
  }>,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.fiscalYear !== undefined) row.fiscal_year = patch.fiscalYear;
  if (patch.clientId !== undefined) row.client_id = patch.clientId;
  if (patch.companyName !== undefined) row.company_name = patch.companyName;
  if (patch.baseDate !== undefined) row.base_date = patch.baseDate;
  if (patch.accountantId !== undefined) row.accountant_id = patch.accountantId;
  if (patch.accountantName !== undefined) row.accountant_name = patch.accountantName;
  if (patch.status !== undefined) row.status = patch.status;
  const { data, error } = await supabase.from('confirmations').update(row).eq('id', id).select('id');
  if (error) throw new Error(friendly(error));
  assertWrote(data, '저장');
}

/** 조회서 세트 삭제 — 조회처 명세도 함께 지워진다(cascade). */
export async function deleteConfirmation(id: string): Promise<void> {
  const { data, error } = await supabase.from('confirmations').delete().eq('id', id).select('id');
  if (error) throw new Error(friendly(error));
  assertWrote(data, '삭제');
}

/** 같은 회계연도에 이미 등록된 거래처인지 확인(중복 등록 방지 안내용) */
export async function findConfirmation(fiscalYear: number, clientId: string): Promise<Confirmation | null> {
  const { data, error } = await supabase
    .from('confirmations')
    .select('*, confirmation_items(count)')
    .eq('fiscal_year', fiscalYear)
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toConfirmation(data as Row) : null;
}

// ── 조회처 명세 ─────────────────────────────────────────────
interface ItemRow {
  id: string;
  confirmation_id: string;
  seq: number;
  kind: string;
  institution: string;
  is_electronic: boolean;
  address: string | null;
  postal_code: string | null;
  phone: string | null;
  dept: string | null;
  contact_name: string | null;
  contact_title: string | null;
  note: string | null;
  sent: boolean | null;
  sent_date: string | null;
  tracking_no: string | null;
  collect_status: string | null;
  collect_date: string | null;
  return_reason: string | null;
}

const toItem = (r: ItemRow): ConfirmItem => ({
  id: r.id,
  confirmationId: r.confirmation_id,
  seq: r.seq,
  kind: r.kind as ItemKind,
  institution: r.institution || '',
  isElectronic: !!r.is_electronic,
  address: r.address || '',
  postalCode: r.postal_code || '',
  phone: r.phone || '',
  dept: r.dept || '',
  contactName: r.contact_name || '',
  contactTitle: r.contact_title || '',
  note: r.note || '',
  sent: !!r.sent,
  sentDate: r.sent_date,
  trackingNo: r.tracking_no || '',
  collectStatus: (r.collect_status as CollectStatus) ?? null,
  collectDate: r.collect_date,
  returnReason: r.return_reason || '',
});

export async function listItems(confirmationId: string): Promise<ConfirmItem[]> {
  const { data, error } = await supabase
    .from('confirmation_items')
    .select('*')
    .eq('confirmation_id', confirmationId)
    .order('seq', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as ItemRow[]).map(toItem);
}

/** 등록(조회처 명세) 입력 — 발송·회수 진행상태는 포함하지 않는다 */
export type ItemInput = Omit<
  ConfirmItem,
  'id' | 'confirmationId' | 'sent' | 'sentDate' | 'trackingNo' | 'collectStatus' | 'collectDate' | 'returnReason'
>;

const toItemRow = (confirmationId: string, it: ItemInput) => ({
  confirmation_id: confirmationId,
  seq: it.seq,
  kind: it.kind,
  institution: it.institution.trim(),
  is_electronic: it.isElectronic,
  // 전자조회면 주소는 저장하지 않는다(출력 시 '전자조회'로 표기).
  address: it.isElectronic ? null : it.address.trim() || null,
  postal_code: it.isElectronic ? null : it.postalCode.trim() || null,
  phone: it.phone.trim() || null,
  dept: it.dept.trim() || null,
  contact_name: it.contactName.trim() || null,
  contact_title: it.contactTitle.trim() || null,
  note: it.note.trim() || null,
});

export async function addItems(confirmationId: string, items: ItemInput[]): Promise<number> {
  if (!items.length) return 0;
  const { error } = await supabase
    .from('confirmation_items')
    .insert(items.map((it) => toItemRow(confirmationId, it)));
  if (error) throw new Error(friendly(error));
  return items.length;
}

/** 현재 조회처의 최대 seq. 중간 행을 지운 뒤 추가해도 번호가 겹치지 않게 한다. */
export async function nextSeq(confirmationId: string): Promise<number> {
  const { data, error } = await supabase
    .from('confirmation_items')
    .select('seq')
    .eq('confirmation_id', confirmationId)
    .order('seq', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const rows = data as { seq: number }[] | null;
  return (rows?.[0]?.seq ?? 0) + 1;
}

/** 조회처 번호를 1..N 으로 다시 매긴다(삭제로 생긴 빈 번호 정리). */
export async function renumberItems(confirmationId: string): Promise<void> {
  const items = await listItems(confirmationId);
  const wrong = items.filter((it, i) => it.seq !== i + 1);
  if (!wrong.length) return;
  for (let i = 0; i < items.length; i++) {
    if (items[i].seq === i + 1) continue;
    const { error } = await supabase
      .from('confirmation_items')
      .update({ seq: i + 1 })
      .eq('id', items[i].id);
    if (error) throw new Error(friendly(error));
  }
}

export async function updateItem(id: string, it: ItemInput): Promise<void> {
  const row = toItemRow('', it) as Record<string, unknown>;
  delete row.confirmation_id; // 소속은 바꾸지 않는다
  const { data, error } = await supabase.from('confirmation_items').update(row).eq('id', id).select('id');
  if (error) throw new Error(friendly(error));
  assertWrote(data, '저장');
}

export async function deleteItem(id: string): Promise<void> {
  const { data, error } = await supabase.from('confirmation_items').delete().eq('id', id).select('id');
  if (error) throw new Error(friendly(error));
  assertWrote(data, '삭제');
}

/**
 * 조회처 전체 교체(엑셀 업로드 시).
 * 새 명세를 **먼저 넣고** 성공한 뒤에 옛 행을 지운다.
 * (지우고 넣으면 중간에 실패했을 때 기존 명세가 복구 불가로 사라진다)
 */
export async function replaceItems(confirmationId: string, items: ItemInput[]): Promise<number> {
  if (!items.length) throw new Error('교체할 조회처가 없습니다.');
  const before = await listItems(confirmationId);
  const oldIds = before.map((i) => i.id);
  // 새 행은 기존 번호와 겹치지 않게 뒤에 붙였다가, 옛 행을 지운 뒤 1..N 으로 정리한다.
  const offset = before.reduce((m, i) => Math.max(m, i.seq), 0);
  await addItems(confirmationId, items.map((it, i) => ({ ...it, seq: offset + i + 1 })));
  if (oldIds.length) {
    const { error } = await supabase.from('confirmation_items').delete().in('id', oldIds);
    if (error) throw new Error(friendly(error));
  }
  await renumberItems(confirmationId);
  return items.length;
}

// ── 전기 조회서 가져오기 ────────────────────────────────────
/**
 * 선택한 전기 거래처의 조회서를 당기로 복제한다.
 * 조회처 명세는 그대로 복사하고, 발송·회수 관련 정보는 애초에 세트 밖이라 따라오지 않는다.
 * 이미 당기에 등록된 거래처는 건너뛴다(덮어쓰지 않는다).
 */
export async function copyFromYear(
  fromYear: number,
  toYear: number,
  confirmationIds: string[],
): Promise<{ copied: number; skipped: string[] }> {
  if (!confirmationIds.length) return { copied: 0, skipped: [] };
  const { data: u } = await supabase.auth.getUser();
  const sources = (await listConfirmations(fromYear)).filter((c) => confirmationIds.includes(c.id));
  const existing = await listConfirmations(toYear);
  const taken = new Set(existing.map((c) => c.clientId));

  let copied = 0;
  const skipped: string[] = [];
  for (const src of sources) {
    if (taken.has(src.clientId)) {
      skipped.push(src.companyName);
      continue;
    }
    const { data, error } = await supabase
      .from('confirmations')
      .insert({
        fiscal_year: toYear,
        client_id: src.clientId,
        company_name: src.companyName,
        base_date: defaultBaseDate(toYear), // 기준일은 당기 연도로 바꿔 넣는다
        accountant_id: src.accountantId,
        accountant_name: src.accountantName,
        created_by: u.user?.id ?? null,
      })
      .select('id')
      .single();
    if (error) throw new Error(friendly(error));
    const newId = (data as { id: string }).id;
    const items = await listItems(src.id);
    if (items.length) {
      await addItems(
        newId,
        items.map(({ id: _id, confirmationId: _cid, ...rest }) => rest),
      );
    }
    copied++;
  }
  return { copied, skipped };
}

/** RLS·중복 등 서버 오류를 사람이 읽을 문장으로 */
function friendly(e: { code?: string; message: string }): string {
  if (e.code === '42501') return '조회서를 등록·수정할 권한이 없습니다. 읽기전용 계정이거나 권한이 부족합니다.';
  if (e.code === '23505') return '같은 회계연도에 이미 등록된 거래처입니다. 기존 등록건을 수정해 주세요.';
  return e.message;
}

// ── 발송 / 회수 진행 ────────────────────────────────────────
/** 발송 처리 — 전자조회는 클릭 토글, 실물발송은 등기번호와 함께. */
export async function setSent(
  itemId: string,
  patch: { sent?: boolean; sentDate?: string | null; trackingNo?: string },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.sent !== undefined) {
    row.sent = patch.sent;
    // 발송을 해제하면 그에 딸린 기록도 함께 지운다.
    // (회수 상태를 남겨두면 '회수 > 발송' 이 되어 회수율이 100%를 넘는다)
    if (!patch.sent) {
      row.sent_date = null;
      row.collect_status = null;
      row.collect_date = null;
      row.return_reason = null;
    }
  }
  if (patch.sentDate !== undefined) row.sent_date = patch.sentDate || null;
  if (patch.trackingNo !== undefined) row.tracking_no = patch.trackingNo.trim() || null;
  const { data, error } = await supabase.from('confirmation_items').update(row).eq('id', itemId).select('id');
  if (error) throw new Error(friendly(error));
  assertWrote(data, '저장');
}

/** 회수 처리 — '회수완료' / '반송'(사유 필수) / null(되돌리기) */
export async function setCollect(
  itemId: string,
  status: CollectStatus,
  opts?: { date?: string; reason?: string },
): Promise<void> {
  if (status === '반송' && !opts?.reason?.trim()) throw new Error('반송 사유를 입력하세요.');
  const { data, error } = await supabase
    .from('confirmation_items')
    .update({
      collect_status: status,
      collect_date: status ? opts?.date || localToday() : null,
      // 회수완료로 바꾸면 이전 반송사유는 지운다(재발송 후 회수된 경우).
      return_reason: status === '반송' ? opts?.reason?.trim() : null,
    })
    .eq('id', itemId)
    .select('id');
  if (error) throw new Error(friendly(error));
  assertWrote(data, '저장');
}

/** 여러 건 일괄 처리 — 일부 실패해도 나머지를 진행하고 결과를 요약한다. */
export async function bulkApply(
  ids: string[],
  job: (id: string) => Promise<void>,
): Promise<{ ok: number; fails: string[] }> {
  let ok = 0;
  const fails: string[] = [];
  for (const id of ids) {
    try {
      await job(id);
      ok++;
    } catch (e) {
      fails.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { ok, fails };
}

// ── 현황 집계 ───────────────────────────────────────────────
// 발송·회수 집계 셈법은 confirmProgress.ts 에 있다(supabase 를 물지 않아 테스트가 돈다).
// 화면들이 여기 한 곳에서 가져다 쓰도록 그대로 내보낸다.
export {
  emptyProgress, summarize, pct, sumProgress,
  daysSince, findOverdue, countPending,
  OVERDUE_THRESHOLDS, DEFAULT_OVERDUE_DAYS,
} from './confirmProgress';
export type { Progress } from './confirmProgress';
/** 독촉 대상 한 줄 — 이 파일의 구체 타입으로 굳혀 둔다(화면이 그대로 쓰던 이름). */
export type OverdueRow = { conf: Confirmation; item: ConfirmItem; days: number };

/** 연도 전체의 조회처를 거래처별로 묶어 한 번에 가져온다(현황 화면용). */
export async function listItemsByYear(year: number): Promise<Record<string, ConfirmItem[]>> {
  const { data, error } = await supabase
    .from('confirmation_items')
    .select('*, confirmations!inner(fiscal_year)')
    .eq('confirmations.fiscal_year', year)
    .order('seq', { ascending: true });
  if (error) throw new Error(error.message);
  const out: Record<string, ConfirmItem[]> = {};
  for (const r of data as ItemRow[]) (out[r.confirmation_id] ||= []).push(toItem(r));
  return out;
}

// ── 변경이력(감사증빙) ──────────────────────────────────────
export interface ConfirmAudit {
  id: number;
  confirmationId: string | null;
  itemId: string | null;
  entity: 'confirmation' | 'item';
  action: 'insert' | 'update' | 'delete';
  actorName: string;
  summary: string;
  at: string;
}

interface AuditRow {
  id: number;
  confirmation_id: string | null;
  item_id: string | null;
  entity: string;
  action: string;
  actor_name: string | null;
  summary: string | null;
  at: string;
}

/**
 * 변경이력 조회. confirmationId 를 주면 그 거래처 건만.
 * 트리거가 기록하므로 앱에서 쓰거나 지울 수 없다(조회 전용).
 */
export async function listAudit(confirmationId?: string, limit = 300): Promise<ConfirmAudit[]> {
  let q = supabase
    .from('confirmation_audit_log')
    .select('id, confirmation_id, item_id, entity, action, actor_name, summary, at');
  if (confirmationId) q = q.eq('confirmation_id', confirmationId);
  const { data, error } = await q.order('at', { ascending: false }).order('id', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data as AuditRow[]).map((r) => ({
    id: r.id,
    confirmationId: r.confirmation_id,
    itemId: r.item_id,
    entity: r.entity as ConfirmAudit['entity'],
    action: r.action as ConfirmAudit['action'],
    actorName: r.actor_name || '',
    summary: r.summary || '',
    at: r.at,
  }));
}

/**
 * 회계감사 계약(AUD.AUDIT)이 등록된 거래처(biz_entity) id 집합.
 * 조회서는 감사 절차라, 등록 후보를 감사계약이 있는 거래처로 좁히는 데 쓴다.
 */
export async function listAuditEntityIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('biz_sales_contract')
    .select('entity_id')
    .eq('category_code', 'AUD.AUDIT');
  if (error) throw new Error(error.message);
  return new Set((data as { entity_id: string }[]).map((r) => r.entity_id));
}
