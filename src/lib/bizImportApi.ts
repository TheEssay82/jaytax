// 거래처 통합 레지스트리 — 기존자료 1회성 자동이관 (clients + doc_clients → biz_*)
// Phase A: 자동이관. 부족 필드는 비워두고 이후 Excel 라운드트립(Phase B)에서 보강한다.
// 최고관리자 전용 도구 — 이관 완료 후 패널은 숨긴다.
import { supabase } from './supabase';
import {
  createBizEntity, createBizPlace, createBizRepresentative, assignStaff, listInternalStaff,
  parseCorpForm,
  type BizKind, type BizNature, type CorpForm,
} from './bizRegistryApi';

/** 회사명 정규화 — 공백·법인격 표기 제거해 dedup 매칭에 사용. */
function norm(s: string): string {
  return (s || '')
    .replace(/\s+/g, '')
    .replace(/㈜|㈲|\(주\)|주식회사|\(유\)|유한회사|\(유책\)|유한책임회사|\(합자\)|\(합\)|합자회사|사모투자합자회사|\(합명\)|합명회사|pef/gi, '')
    .toLowerCase();
}

export interface ImportRow {
  key: string;            // 정규화 회사명(내부 식별)
  name: string;           // 법인격 뗀 순수 상호
  corpForm: CorpForm | null;
  corpFormPosition: '앞' | '뒤' | null;
  kind: BizKind;
  nature: BizNature;      // 매출(청구 소스) / 일반(발송 전용)
  taxId: string;          // 사업자번호(clients.tax_id)
  cpa: string;            // 담당CPA(doc_clients.accountant)
  repName: string;        // 대표이사(clients.rep_name)
  staffId: string | null; // 담당직원(clients.manager 이름 매칭 → profiles.id)
  staffName: string;      // 담당직원 표시명
  source: 'clients' | 'doc' | 'both';
  exists: boolean;        // 이미 biz_* 에 이관됨(중복 방지)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** 이관 미리보기 — 쓰기 없이 이관 대상 목록을 산출한다. */
export async function previewLegacyImport(): Promise<ImportRow[]> {
  const [cRes, dRes, entRes, plcRes, staff] = await Promise.all([
    supabase.from('clients').select('biz_type, company_name, tax_id, rep_name, manager'),
    supabase.from('doc_clients').select('company_name, accountant'),
    supabase.from('biz_entity').select('name'),
    supabase.from('biz_place').select('biz_reg_no'),
    listInternalStaff(),
  ]);
  for (const r of [cRes, dRes, entRes, plcRes]) if (r.error) throw new Error(r.error.message);

  // 이미 이관된 것 판별용 집합(회사명 정규화 + 사업자번호)
  const existNames = new Set((entRes.data as any[]).map((r) => norm(r.name)));
  const existTaxIds = new Set((plcRes.data as any[]).map((r) => (r.biz_reg_no || '').replace(/\D/g, '')).filter(Boolean));
  const staffByName = new Map(staff.map((s) => [s.name, s.id]));

  const map = new Map<string, ImportRow>();
  // 1) 청구 clients (매출)
  for (const c of cRes.data as any[]) {
    const kind: BizKind = (c.biz_type as BizKind) || '법인';
    const parsed = kind === '법인' ? parseCorpForm(c.company_name) : { name: (c.company_name || '').trim(), form: null, position: null };
    const key = norm(parsed.name);
    if (!key) continue;
    const staffId = c.manager && staffByName.has((c.manager || '').trim()) ? staffByName.get((c.manager || '').trim())! : null;
    map.set(key, {
      key, name: parsed.name, corpForm: parsed.form, corpFormPosition: parsed.position, kind, nature: '매출',
      taxId: c.tax_id || '', cpa: '', repName: c.rep_name || '',
      staffId, staffName: staffId ? (c.manager || '').trim() : '',
      source: 'clients', exists: false,
    });
  }
  // 2) 발송 doc_clients — 이름 일치하면 CPA 보강(both), 아니면 신규(일반)
  for (const d of dRes.data as any[]) {
    const parsed = parseCorpForm(d.company_name);
    const key = norm(parsed.name);
    if (!key) continue;
    const ex = map.get(key);
    if (ex) {
      ex.source = 'both';
      if (!ex.cpa && d.accountant) ex.cpa = d.accountant;
    } else {
      map.set(key, {
        key, name: parsed.name, corpForm: parsed.form, corpFormPosition: parsed.position, kind: '법인', nature: '일반',
        taxId: '', cpa: d.accountant || '', repName: '', staffId: null, staffName: '',
        source: 'doc', exists: false,
      });
    }
  }
  // 3) 이미 이관 여부 표시
  const rows = [...map.values()].map((r) => ({
    ...r,
    exists: existNames.has(r.key) || (!!r.taxId && existTaxIds.has(r.taxId.replace(/\D/g, ''))),
  }));
  rows.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return rows;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface ImportResult { created: number; skipped: number; failed: { name: string; error: string }[] }

/** 선택된 대상 이관 실행 — 각 거래처마다 entity+본사 사업장(+대표이사+담당직원) 생성. */
export async function runLegacyImport(rows: ImportRow[]): Promise<ImportResult> {
  const res: ImportResult = { created: 0, skipped: 0, failed: [] };
  for (const r of rows) {
    if (r.exists) { res.skipped++; continue; }
    try {
      const entityId = await createBizEntity({ kind: r.kind, name: r.name.trim(), corpForm: r.corpForm, corpFormPosition: r.corpFormPosition });
      const placeId = await createBizPlace({
        entityId, placeName: '본점', isHeadquarters: true, branchType: '본점',
        bizRegNo: r.taxId || undefined, nature: r.nature, cpa: r.cpa || undefined,
      });
      if (r.repName.trim()) await createBizRepresentative({ entityId, repName: r.repName.trim() });
      if (r.staffId) await assignStaff(placeId, r.staffId, r.staffName);
      res.created++;
    } catch (e) {
      res.failed.push({ name: r.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return res;
}
