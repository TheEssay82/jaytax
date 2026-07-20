// 조회서발송관리 데이터 레이어.
// 구조: confirmations(거래처 × 회계연도) → confirmation_items(조회처 명세)
// 권한: 조회·쓰기 모두 내부 구성원(외부인 제외). 읽기전용 계정은 서버에서 차단(0041).
import { supabase, assertWrote } from './supabase';

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
}

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

export type ItemInput = Omit<ConfirmItem, 'id' | 'confirmationId'>;

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

/** 조회처 전체 교체(엑셀 업로드 시). 기존 행을 지우고 새로 넣는다. */
export async function replaceItems(confirmationId: string, items: ItemInput[]): Promise<number> {
  const { error: delErr } = await supabase
    .from('confirmation_items')
    .delete()
    .eq('confirmation_id', confirmationId);
  if (delErr) throw new Error(friendly(delErr));
  return addItems(confirmationId, items);
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
