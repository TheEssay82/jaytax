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
/** 사업장 상태 — '우리와의 거래 상태'다. 폐업=사업자등록 소멸, 이관=타 사무소로, 종료=우리 업무만 끝남. */
export type PlaceStatus = '정상' | '폐업' | '이관' | '종료';
export const PLACE_STATUSES: PlaceStatus[] = ['정상', '폐업', '이관', '종료'];
/** 담당직원 상태 — 실제 직원 배정과 별개(과거·임시거래처=N/A, 배정 전=배정예정). */
export type StaffStatus = '배정예정' | 'N/A';
export const STAFF_STATUSES: StaffStatus[] = ['배정예정', 'N/A'];
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
  /** 본점/지점 구분(사업자 분류). */
  branchType: '본점' | '지점' | null;
  /** 사업자단위과세 여부. */
  unitTaxation: boolean;
  /** 사업자단위과세 시 신고기준(본점) 사업장 id. */
  filingPlaceId: string | null;
  nature: BizNature;
  salesTeams: SalesTeam[];
  taxType: TaxType | null;
  withholding: Withholding | null;
  openedDate: string | null;
  status: PlaceStatus;
  /** 폐업/이관 귀속월 'YYYY-MM' (정상이면 빈값). */
  statusMonth: string;
  /** 이관업체명(이관일 때만). */
  transferTo: string;
  /** 이관업체 연락처. */
  transferContact: string;
  /** 이관업체 담당자명. */
  transferManager: string;
  cpa: string;
  hometaxId: string;
  /** 홈텍스 PW 존재 여부(값은 RPC 로만 열람). */
  hasHometaxPw: boolean;
  note: string;
  /** 담당직원 상태(실제 직원 없을 때 표시): 배정예정/N/A, 없으면 null. */
  staffStatus: StaffStatus | null;
  /** ERP(IBCENTER) 거래처코드 5자리 — 원장 대사(입금)의 유일한 키. 원장에는 사업자번호가 없다. */
  erpClientCode: string;
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

export type CorpForm = '주식회사' | '유한회사' | '유한책임회사' | '합자회사' | '합명회사';
export const CORP_FORMS: CorpForm[] = ['주식회사', '유한회사', '유한책임회사', '합자회사', '합명회사'];
export const CORP_FORM_SYMBOL: Record<CorpForm, string> = {
  주식회사: '㈜', 유한회사: '(유)', 유한책임회사: '(유책)', 합자회사: '(합자)', 합명회사: '(합명)',
};
export const RELATION_TYPES = ['부', '모', '자녀', '배우자', '형제자매', '동업', '기타'] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

/** 법인격 통일 표기로 회사명 재조립. */
export function corpDisplayName(name: string, form?: CorpForm | null, position?: '앞' | '뒤' | null): string {
  if (!form || !position) return name;
  const s = CORP_FORM_SYMBOL[form];
  return position === '앞' ? `${s}${name}` : `${name}${s}`;
}
/** 원문 회사명에서 법인격을 분리(앞/뒤). PEF·사모투자합자회사는 합자회사로 통일. */
export function parseCorpForm(raw: string): { name: string; form: CorpForm | null; position: '앞' | '뒤' | null } {
  const s = (raw || '').trim();
  // 구체적·긴 토큰 먼저(유한책임>유한, 사모투자합자>합자).
  const TOKENS: [string, CorpForm][] = [
    ['주식회사', '주식회사'], ['㈜', '주식회사'], ['(주)', '주식회사'],
    ['유한책임회사', '유한책임회사'], ['(유책)', '유한책임회사'],
    ['유한회사', '유한회사'], ['㈲', '유한회사'], ['(유)', '유한회사'],
    ['사모투자합자회사', '합자회사'], ['합자회사', '합자회사'], ['(합자)', '합자회사'], ['(합)', '합자회사'],
    ['합명회사', '합명회사'], ['(합명)', '합명회사'],
    ['PEF', '합자회사'], ['pef', '합자회사'],
  ];
  for (const [tok, form] of TOKENS) {
    if (s.startsWith(tok) && s.length > tok.length) return { name: s.slice(tok.length).trim(), form, position: '앞' };
    if (s.endsWith(tok) && s.length > tok.length) return { name: s.slice(0, s.length - tok.length).trim(), form, position: '뒤' };
  }
  return { name: s, form: null, position: null };
}

export interface BizRelation {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relationType: string;
  note: string;
}

export interface BizEntity {
  id: string;
  code: string;
  kind: BizKind;
  name: string;
  corpForm: CorpForm | null;
  corpFormPosition: '앞' | '뒤' | null;
  corpRegNo: string;
  /** 개인 주민번호 존재 여부(값은 RPC 로만 열람). */
  hasResidentNo: boolean;
  establishedDate: string | null;
  note: string;
  createdAt?: string;
  updatedAt?: string;
}

/** 화면용 조립 타입: 귀속주체 + 사업장(담당자 포함) + 대표이사 + 공동사업자 + 개인관계. */
export interface BizEntityFull extends BizEntity {
  places: BizPlace[];
  representatives: BizRepresentative[];
  partners: BizPartner[];
  relations: BizRelation[];
}

// ── row → 도메인 매핑 ──────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
const toEntity = (r: any): BizEntity => ({
  id: r.id,
  code: r.code || '',
  kind: r.kind,
  name: r.name || '',
  corpForm: r.corp_form ?? null,
  corpFormPosition: r.corp_form_position ?? null,
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
  branchType: r.branch_type ?? null,
  unitTaxation: !!r.unit_taxation,
  filingPlaceId: r.filing_place_id ?? null,
  nature: r.nature,
  salesTeams: (r.sales_teams || []) as SalesTeam[],
  taxType: r.tax_type,
  withholding: r.withholding,
  openedDate: r.opened_date,
  status: r.status,
  statusMonth: r.status_month || '',
  transferTo: r.transfer_to || '',
  transferContact: r.transfer_contact || '',
  transferManager: r.transfer_manager || '',
  cpa: r.cpa || '',
  hometaxId: r.hometax_id || '',
  hasHometaxPw: r.hometax_pw_enc != null,
  note: r.note || '',
  staffStatus: r.staff_status ?? null,
  erpClientCode: r.erp_client_code || '',
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
const toRelation = (r: any): BizRelation => ({
  id: r.id,
  fromEntityId: r.from_entity_id,
  toEntityId: r.to_entity_id,
  relationType: r.relation_type,
  note: r.note || '',
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Ctrl+K 용 가벼운 색인 — 이름·코드·사업자번호만. 전체 조립(listBizEntities)은 여섯 테이블을 읽어 무겁다. */
export interface EntityIndexRow { id: string; code: string; name: string; kind: string; places: { name: string; bizRegNo: string }[] }

export async function listEntityIndex(): Promise<EntityIndexRow[]> {
  const [ent, plc] = await Promise.all([
    supabase.from('biz_entity').select('id, code, name, kind').order('code'),
    supabase.from('biz_place').select('entity_id, place_name, biz_reg_no'),
  ]);
  for (const r of [ent, plc]) if (r.error) throw new Error(r.error.message);
  const byEnt = new Map<string, { name: string; bizRegNo: string }[]>();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  for (const p of (plc.data as any[]) ?? []) {
    const l = byEnt.get(p.entity_id) ?? [];
    l.push({ name: p.place_name || '', bizRegNo: p.biz_reg_no || '' });
    byEnt.set(p.entity_id, l);
  }
  return ((ent.data as any[]) ?? []).map((e) => ({
    id: e.id, code: e.code || '', name: e.name || '', kind: e.kind || '',
    places: byEnt.get(e.id) ?? [],
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

// ── 조회: 전체를 조립해서 반환 ─────────────────────────────
export async function listBizEntities(): Promise<BizEntityFull[]> {
  const [ent, plc, stf, rep, prt, rel] = await Promise.all([
    supabase.from('biz_entity').select('*').order('code', { ascending: true }),
    supabase.from('biz_place').select('*').order('place_no', { ascending: true }),
    supabase.from('biz_place_staff').select('*').eq('active', true),
    supabase.from('biz_representative').select('*'),
    supabase.from('biz_place_partner').select('*'),
    supabase.from('biz_entity_relation').select('*'),
  ]);
  for (const r of [ent, plc, stf, rep, prt, rel]) {
    if (r.error) throw new Error(r.error.message);
  }
  const relByEntity = new Map<string, BizRelation[]>();
  for (const rl of (rel.data as any[]).map(toRelation)) {
    (relByEntity.get(rl.fromEntityId) ?? relByEntity.set(rl.fromEntityId, []).get(rl.fromEntityId)!).push(rl);
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
    return { ...e, places, representatives: repsByEntity.get(e.id) ?? [], partners, relations: relByEntity.get(e.id) ?? [] };
  });
}

// ── 귀속주체(entity) ───────────────────────────────────────
export interface EntityInput {
  kind: BizKind;
  name: string;
  corpForm?: CorpForm | null;
  corpFormPosition?: '앞' | '뒤' | null;
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
      corp_form: input.kind === '법인' ? (input.corpForm ?? null) : null,
      corp_form_position: input.kind === '법인' ? (input.corpFormPosition ?? null) : null,
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
  patch: Partial<Pick<EntityInput, 'name' | 'corpForm' | 'corpFormPosition' | 'corpRegNo' | 'establishedDate' | 'note'>>,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.corpForm !== undefined) row.corp_form = patch.corpForm || null;
  if (patch.corpFormPosition !== undefined) row.corp_form_position = patch.corpFormPosition || null;
  if (patch.corpRegNo !== undefined) row.corp_reg_no = patch.corpRegNo || null;
  if (patch.establishedDate !== undefined) row.established_date = patch.establishedDate || null;
  if (patch.note !== undefined) row.note = patch.note || null;
  const { data, error } = await supabase.from('biz_entity').update(row).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '저장');
}

// ── 개인 관계(biz_entity_relation) ─────────────────────────
export async function createBizRelation(fromEntityId: string, toEntityId: string, relationType: string, note?: string): Promise<void> {
  const { error } = await supabase.from('biz_entity_relation').insert({
    from_entity_id: fromEntityId, to_entity_id: toEntityId, relation_type: relationType, note: note ?? null,
  });
  if (error) throw new Error(error.message);
}
export async function deleteBizRelation(id: string): Promise<void> {
  const { data, error } = await supabase.from('biz_entity_relation').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '삭제');
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
  branchType?: '본점' | '지점' | null;
  unitTaxation?: boolean;
  filingPlaceId?: string | null;
  nature?: BizNature;
  salesTeams?: SalesTeam[];
  taxType?: TaxType | null;
  withholding?: Withholding | null;
  openedDate?: string | null;
  status?: PlaceStatus;
  statusMonth?: string | null;
  transferTo?: string | null;
  transferContact?: string | null;
  transferManager?: string | null;
  cpa?: string;
  hometaxId?: string;
  note?: string;
  staffStatus?: StaffStatus | null;
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
  if (p.branchType !== undefined) row.branch_type = p.branchType || null;
  if (p.unitTaxation !== undefined) row.unit_taxation = p.unitTaxation;
  if (p.filingPlaceId !== undefined) row.filing_place_id = p.filingPlaceId || null;
  if (p.nature !== undefined) row.nature = p.nature;
  if (p.salesTeams !== undefined) row.sales_teams = p.salesTeams;
  if (p.taxType !== undefined) row.tax_type = p.taxType || null;
  if (p.withholding !== undefined) row.withholding = p.withholding || null;
  if (p.openedDate !== undefined) row.opened_date = p.openedDate || null;
  if (p.status !== undefined) row.status = p.status;
  if (p.statusMonth !== undefined) row.status_month = p.statusMonth || null;
  if (p.transferTo !== undefined) row.transfer_to = p.transferTo || null;
  if (p.transferContact !== undefined) row.transfer_contact = p.transferContact || null;
  if (p.transferManager !== undefined) row.transfer_manager = p.transferManager || null;
  if (p.cpa !== undefined) row.cpa = p.cpa || null;
  if (p.hometaxId !== undefined) row.hometax_id = p.hometaxId || null;
  if (p.note !== undefined) row.note = p.note || null;
  if (p.staffStatus !== undefined) row.staff_status = p.staffStatus || null;
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
/** 대표이사 수정. 주민번호는 값이 있을 때만 덮어쓴다(빈칸 = 그대로 둠). */
export async function updateBizRepresentative(
  id: string,
  patch: { repName: string; repType: RepType; linkedEntityId?: string | null; residentNo?: string },
): Promise<void> {
  const { data, error } = await supabase
    .from('biz_representative')
    .update({
      rep_name: patch.repName,
      rep_type: patch.repType,
      linked_entity_id: patch.linkedEntityId ?? null,
    })
    .eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '수정');
  if (patch.residentNo && patch.residentNo.trim()) await setRepResident(id, patch.residentNo.trim());
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
// 아래 열람 함수들은 **서버가 접속기록에 남긴다**(고시 제8조). 사유(reason)는 화면이 받아 넘긴다.
export async function revealEntityResident(id: string, reason?: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('biz_reveal_entity_resident', { p_id: id, p_reason: reason ?? null });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}
export async function revealRepResident(id: string, reason?: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('biz_reveal_rep_resident', { p_id: id, p_reason: reason ?? null });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}
export async function revealPlaceHometaxPw(id: string, reason?: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('biz_reveal_place_hometax_pw', { p_id: id, p_reason: reason ?? null });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

// ── 내부 담당직원 후보(profiles) ───────────────────────────
export interface StaffProfile {
  id: string;
  name: string;
  role: string;
}
/** 담당 CPA 후보(영업·감사 회계사). 입사·변경 시 여기만 고치면 된다. */
export const CPA_OPTIONS = ['정우철', '조현규', '김준성'] as const;
/** 담당직원(기장 실무) 후보 화이트리스트. 입사·변경 시 여기만 고치면 된다. */
export const STAFF_WHITELIST = ['정남지', '김민섭', '김동주', '송현주'] as const;
export async function listInternalStaff(): Promise<StaffProfile[]> {
  const { data, error } = await supabase.from('profiles').select('id, name, email, role').order('name');
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const wl = new Set<string>(STAFF_WHITELIST);
  return (data as any[])
    .map((r) => ({ id: r.id, name: (r.name || '').trim(), role: r.role }))
    .filter((r) => wl.has(r.name))
    // 화이트리스트 순서대로 정렬
    .sort((a, b) => STAFF_WHITELIST.indexOf(a.name as never) - STAFF_WHITELIST.indexOf(b.name as never));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** 거래처등록 표뷰용 — 개인 본인/법인 대표자 주민번호를 한 번에 열람(권한자만). */
export interface ResidentRow { entityId: string; kind: string; holder: string; residentNo: string }
/** 홈택스PW 일괄 열람 — 표뷰에서 한 번에 펼치기 위한 것. 반환은 사업장id → 비밀번호. */
// 일괄 열람은 사실상 다운로드다 — **사유 없이는 서버가 거부한다**(고시 제8조제2항).
export async function revealAllHometaxPws(reason: string): Promise<Map<string, string>> {
  const { data, error } = await supabase.rpc('biz_reveal_hometax_pws', { p_reason: reason });
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return new Map((data as any[]).map((r) => [r.place_id as string, (r.hometax_pw || '') as string]));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export async function revealAllResidents(reason: string): Promise<ResidentRow[]> {
  const { data, error } = await supabase.rpc('biz_reveal_residents', { p_reason: reason });
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data as any[]).map((r) => ({
    entityId: r.entity_id, kind: r.kind, holder: r.holder || '', residentNo: r.resident_no || '',
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
