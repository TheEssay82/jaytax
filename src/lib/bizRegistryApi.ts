// 거래처 통합 레지스트리(biz_*) 데이터 접근 레이어 — 거래처관리 2.0.0 Phase 0 스키마 대응.
// 2계층: biz_entity(귀속주체 법인/개인) → biz_place(사업장) + 위성(대표이사·공동사업자·담당직원).
// 민감정보(주민번호·홈텍스pw)는 평문 컬럼이 없고, 전용 RPC(biz_set_*/biz_reveal_*)로만 쓰고 읽는다.
import { supabase, assertWrote } from './supabase';

// ── 도메인 타입 ────────────────────────────────────────────
export type BizKind = '법인' | '개인';
export type BizNature = '매출' | '일반';
export type TaxType = '과세' | '겸영' | '면세';
export type Withholding = '월별' | '반기별' | 'N/A';
export type RepType = '단독' | '공동대표' | '각자대표';
export type PlaceStatus = '정상' | '폐업';
export const SALES_TEAMS = ['감사team', 'taxteam'] as const;
export type SalesTeam = (typeof SALES_TEAMS)[number];

export interface BizStaff {
  id: string;
  placeId: string;
  staffId: string;
  staffName: string;
  active: boolean;
  assignedAt?: string;
  unassignedAt?: string | null;
}

export interface BizPlace {
  id: string;
  entityId: string;
  placeNo: number;
  placeName: string;
  bizRegNo: string;
  noBiz: boolean;
  address: string;
  isHeadquarters: boolean;
  nature: BizNature;
  salesTeams: SalesTeam[];
  taxType: TaxType | null;
  withholding: Withholding | null;
  openedDate: string | null;
  status: PlaceStatus;
  cpa: string;
  hometaxId: string;
  /** 홈텍스 PW 존재 여부(값은 RPC 로만 열람). */
  hasHometaxPw: boolean;
  note: string;
  staff: BizStaff[];
  createdAt?: string;
  updatedAt?: string;
}

export interface BizRepresentative {
  id: string;
  entityId: string;
  repName: string;
  repType: RepType;
  /** 대표자 주민번호 존재 여부(값은 RPC 로만 열람). */
  hasResidentNo: boolean;
  /** 대표가 개인거래처면 연결된 개인 entity id. */
  linkedEntityId: string | null;
}

export interface BizPartner {
  id: string;
  placeId: string;
  partnerEntityId: string;
  sharePct: number | null;
}

export interface BizEntity {
  id: string;
  code: string;
  kind: BizKind;
  name: string;
  corpRegNo: string;
  /** 개인 주민번호 존재 여부(값은 RPC 로만 열람). */
  hasResidentNo: boolean;
  establishedDate: string | null;
  note: string;
  createdAt?: string;
  updatedAt?: string;
}

/** 화면용 조립 타입: 귀속주체 + 사업장(담당자 포함) + 대표이사 + 공동사업자. */
export interface BizEntityFull extends BizEntity {
  places: BizPlace[];
  representatives: BizRepresentative[];
  partners: BizPartner[];
}

// ── row → 도메인 매핑 ──────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
const toEntity = (r: any): BizEntity => ({
  id: r.id,
  code: r.code || '',
  kind: r.kind,
  name: r.name || '',
  corpRegNo: r.corp_reg_no || '',
  hasResidentNo: r.resident_no_enc != null,
  establishedDate: r.established_date,
  note: r.note || '',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const toStaff = (r: any): BizStaff => ({
  id: r.id,
  placeId: r.place_id,
  staffId: r.staff_id,
  staffName: r.staff_name || '',
  active: !!r.active,
  assignedAt: r.assigned_at,
  unassignedAt: r.unassigned_at,
});
const toPlace = (r: any): BizPlace => ({
  id: r.id,
  entityId: r.entity_id,
  placeNo: r.place_no ?? 0,
  placeName: r.place_name || '',
  bizRegNo: r.biz_reg_no || '',
  noBiz: !!r.no_biz,
  address: r.address || '',
  isHeadquarters: !!r.is_headquarters,
  nature: r.nature,
  salesTeams: (r.sales_teams || []) as SalesTeam[],
  taxType: r.tax_type,
  withholding: r.withholding,
  openedDate: r.opened_date,
  status: r.status,
  cpa: r.cpa || '',
  hometaxId: r.hometax_id || '',
  hasHometaxPw: r.hometax_pw_enc != null,
  note: r.note || '',
  staff: [],
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const toRep = (r: any): BizRepresentative => ({
  id: r.id,
  entityId: r.entity_id,
  repName: r.rep_name || '',
  repType: r.rep_type,
  hasResidentNo: r.resident_no_enc != null,
  linkedEntityId: r.linked_entity_id,
});
const toPartner = (r: any): BizPartner => ({
  id: r.id,
  placeId: r.place_id,
  partnerEntityId: r.partner_entity_id,
  sharePct: r.share_pct != null ? Number(r.share_pct) : null,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── 조회: 전체를 조립해서 반환 ─────────────────────────────
export async function listBizEntities(): Promise<BizEntityFull[]> {
  const [ent, plc, stf, rep, prt] = await Promise.all([
    supabase.from('biz_entity').select('*').order('code', { ascending: true }),
    supabase.from('biz_place').select('*').order('place_no', { ascending: true }),
    supabase.from('biz_place_staff').select('*').eq('active', true),
    supabase.from('biz_representative').select('*'),
    supabase.from('biz_place_partner').select('*'),
  ]);
  for (const r of [ent, plc, stf, rep, prt]) {
    if (r.error) throw new Error(r.error.message);
  }
  const staffByPlace = new Map<string, BizStaff[]>();
  for (const s of (stf.data as any[]).map(toStaff)) {
    (staffByPlace.get(s.placeId) ?? staffByPlace.set(s.placeId, []).get(s.placeId)!).push(s);
  }
  const placesByEntity = new Map<string, BizPlace[]>();
  for (const p of (plc.data as any[]).map(toPlace)) {
    p.staff = staffByPlace.get(p.id) ?? [];
    (placesByEntity.get(p.entityId) ?? placesByEntity.set(p.entityId, []).get(p.entityId)!).push(p);
  }
  const repsByEntity = new Map<string, BizRepresentative[]>();
  for (const r of (rep.data as any[]).map(toRep)) {
    (repsByEntity.get(r.entityId) ?? repsByEntity.set(r.entityId, []).get(r.entityId)!).push(r);
  }
  const partnersByPlace = new Map<string, BizPartner[]>();
  for (const p of (prt.data as any[]).map(toPartner)) {
    (partnersByPlace.get(p.placeId) ?? partnersByPlace.set(p.placeId, []).get(p.placeId)!).push(p);
  }
  return (ent.data as any[]).map(toEntity).map((e) => {
    const places = placesByEntity.get(e.id) ?? [];
    const partners = places.flatMap((pl) => partnersByPlace.get(pl.id) ?? []);
    return { ...e, places, representatives: repsByEntity.get(e.id) ?? [], partners };
  });
}

// ── 귀속주체(entity) ───────────────────────────────────────
export interface EntityInput {
  kind: BizKind;
  name: string;
  corpRegNo?: string;
  establishedDate?: string | null;
  note?: string;
  /** 주민번호(개인) — 제공 시 생성 직후 암호화 RPC 로 저장. */
  residentNo?: string;
}
export async function createBizEntity(input: EntityInput): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('biz_entity')
    .insert({
      kind: input.kind,
      name: input.name,
      corp_reg_no: input.corpRegNo ?? null,
      established_date: input.establishedDate || null,
      note: input.note ?? null,
      created_by: u.user?.id ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const id = (data as { id: string }).id;
  if (input.residentNo && input.residentNo.trim()) await setEntityResident(id, input.residentNo.trim());
  return id;
}
export async function updateBizEntity(
  id: string,
  patch: Partial<Pick<EntityInput, 'name' | 'corpRegNo' | 'establishedDate' | 'note'>>,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.corpRegNo !== undefined) row.corp_reg_no = patch.corpRegNo || null;
  if (patch.establishedDate !== undefined) row.established_date = patch.establishedDate || null;
  if (patch.note !== undefined) row.note = patch.note || null;
  const { data, error } = await supabase.from('biz_entity').update(row).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '저장');
}
export async function deleteBizEntity(id: string): Promise<void> {
  const { data, error } = await supabase.from('biz_entity').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '삭제');
}

// ── 사업장(place) ──────────────────────────────────────────
export interface PlaceInput {
  entityId: string;
  placeName: string;
  bizRegNo?: string;
  noBiz?: boolean;
  address?: string;
  isHeadquarters?: boolean;
  nature?: BizNature;
  salesTeams?: SalesTeam[];
  taxType?: TaxType | null;
  withholding?: Withholding | null;
  openedDate?: string | null;
  status?: PlaceStatus;
  cpa?: string;
  hometaxId?: string;
  note?: string;
  /** 홈텍스 PW — 제공 시 생성 직후 암호화 RPC 로 저장. */
  hometaxPw?: string;
}
function placeToRow(p: Partial<PlaceInput>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (p.entityId !== undefined) row.entity_id = p.entityId;
  if (p.placeName !== undefined) row.place_name = p.placeName;
  if (p.bizRegNo !== undefined) row.biz_reg_no = p.bizRegNo || null;
  if (p.noBiz !== undefined) row.no_biz = p.noBiz;
  if (p.address !== undefined) row.address = p.address || null;
  if (p.isHeadquarters !== undefined) row.is_headquarters = p.isHeadquarters;
  if (p.nature !== undefined) row.nature = p.nature;
  if (p.salesTeams !== undefined) row.sales_teams = p.salesTeams;
  if (p.taxType !== undefined) row.tax_type = p.taxType || null;
  if (p.withholding !== undefined) row.withholding = p.withholding || null;
  if (p.openedDate !== undefined) row.opened_date = p.openedDate || null;
  if (p.status !== undefined) row.status = p.status;
  if (p.cpa !== undefined) row.cpa = p.cpa || null;
  if (p.hometaxId !== undefined) row.hometax_id = p.hometaxId || null;
  if (p.note !== undefined) row.note = p.note || null;
  return row;
}
export async function createBizPlace(input: PlaceInput): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('biz_place')
    .insert({ ...placeToRow(input), created_by: u.user?.id ?? null })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const id = (data as { id: string }).id;
  if (input.hometaxPw && input.hometaxPw.trim()) await setPlaceHometaxPw(id, input.hometaxPw.trim());
  return id;
}
export async function updateBizPlace(id: string, patch: Partial<PlaceInput>): Promise<void> {
  const { data, error } = await supabase.from('biz_place').update(placeToRow(patch)).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '저장');
}
export async function deleteBizPlace(id: string): Promise<void> {
  const { data, error } = await supabase.from('biz_place').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '삭제');
}

// ── 대표이사(representative) ───────────────────────────────
export interface RepInput {
  entityId: string;
  repName: string;
  repType?: RepType;
  linkedEntityId?: string | null;
  residentNo?: string;
}
export async function createBizRepresentative(input: RepInput): Promise<string> {
  const { data, error } = await supabase
    .from('biz_representative')
    .insert({
      entity_id: input.entityId,
      rep_name: input.repName,
      rep_type: input.repType ?? '단독',
      linked_entity_id: input.linkedEntityId ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const id = (data as { id: string }).id;
  if (input.residentNo && input.residentNo.trim()) await setRepResident(id, input.residentNo.trim());
  return id;
}
export async function deleteBizRepresentative(id: string): Promise<void> {
  const { data, error } = await supabase.from('biz_representative').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '삭제');
}

// ── 공동사업자(partner) ────────────────────────────────────
export async function createBizPartner(placeId: string, partnerEntityId: string, sharePct?: number | null): Promise<void> {
  const { error } = await supabase.from('biz_place_partner').insert({
    place_id: placeId,
    partner_entity_id: partnerEntityId,
    share_pct: sharePct ?? null,
  });
  if (error) throw new Error(error.message);
}
export async function deleteBizPartner(id: string): Promise<void> {
  const { data, error } = await supabase.from('biz_place_partner').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '삭제');
}

// ── 담당직원(staff) 배정/해제 ──────────────────────────────
export async function assignStaff(placeId: string, staffId: string, staffName: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from('biz_place_staff').insert({
    place_id: placeId,
    staff_id: staffId,
    staff_name: staffName,
    active: true,
    assigned_by: u.user?.id ?? null,
  });
  if (error) throw new Error(error.message);
}
/** 배정 해제 — 이력 보존 위해 삭제 대신 active=false 로 내린다. */
export async function unassignStaff(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('biz_place_staff')
    .update({ active: false, unassigned_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '해제');
}

// ── 민감정보 RPC 래퍼 (쓰기=암호화 / 읽기=권한자 복호) ─────
export async function setEntityResident(id: string, val: string): Promise<void> {
  const { error } = await supabase.rpc('biz_set_entity_resident', { p_id: id, p_val: val });
  if (error) throw new Error(error.message);
}
export async function setRepResident(id: string, val: string): Promise<void> {
  const { error } = await supabase.rpc('biz_set_rep_resident', { p_id: id, p_val: val });
  if (error) throw new Error(error.message);
}
export async function setPlaceHometaxPw(id: string, val: string): Promise<void> {
  const { error } = await supabase.rpc('biz_set_place_hometax_pw', { p_id: id, p_val: val });
  if (error) throw new Error(error.message);
}
export async function revealEntityResident(id: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('biz_reveal_entity_resident', { p_id: id });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}
export async function revealRepResident(id: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('biz_reveal_rep_resident', { p_id: id });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}
export async function revealPlaceHometaxPw(id: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('biz_reveal_place_hometax_pw', { p_id: id });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

// ── 내부 담당직원 후보(profiles) ───────────────────────────
export interface StaffProfile {
  id: string;
  name: string;
  role: string;
}
const INTERNAL_ROLES = new Set(['superuser', 'accountant', 'team_lead', 'team_member']);
export async function listInternalStaff(): Promise<StaffProfile[]> {
  const { data, error } = await supabase.from('profiles').select('id, name, email, role').order('name');
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data as any[])
    .filter((r) => INTERNAL_ROLES.has(r.role))
    .map((r) => ({ id: r.id, name: r.name || r.email || '(이름없음)', role: r.role }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
