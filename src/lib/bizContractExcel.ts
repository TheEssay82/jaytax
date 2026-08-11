// 매출계약 일괄등록 Excel — 빈 양식(사업장 목록 프리필) 내보내기 + 업로드 적용.
// 매칭키 = 거래처코드 + 사업장명(비우면 본사). 전부 신규 생성하되, 동일 사업장+매출유형(+귀속연도) 활성 계약이
// 이미 있으면 스킵(재실행 안전). 매출유형은 팀+경로 라벨 드롭다운 → 내부 코드로 변환.
import { supabase } from './supabase';
import {
  createSalesContract, updateSalesContract, saveContractStaff, listContractStaffProfiles,
  BILLING_CYCLES, CPA_LIST,
  type ContractInput, type OccurrenceUnit, type BillingUnit, type BillingCycle, type SalesContract,
} from './salesContractApi';
import { contractTypeOptions, findNode, leafOf } from './salesContractTaxonomy';
import type { BizEntityFull } from './bizRegistryApi';
import { FONT, FILL_HEADER, frame, setWidths, saveWorkbook } from './confirmExcelStyle';

async function loadExcelJS() {
  const mod = await import('exceljs');
  const ns = (mod as unknown as { default?: unknown }).default ?? mod;
  return ns as typeof import('exceljs');
}

const TYPE_OPTS = contractTypeOptions();
const TYPE_BY_LABEL = new Map(TYPE_OPTS.map((o) => [o.label, o.code]));
const LABEL_BY_CODE = new Map(TYPE_OPTS.map((o) => [o.code, o.label]));
const OCC = ['사업장', '법인', '개인'] as const;
const BUNIT = ['사업장', '법인', '개인', '건'] as const;
const OX = ['O', 'X'] as const;

interface ColMeta { h: string; w: number; list?: readonly string[]; typeRef?: boolean }
// 참고 컬럼(회색·매칭이나 참고용, 계약 등록엔 미사용): 거래처코드·거래처명·구분·사업장명·본점지점·상태·매출팀.
const COLS: ColMeta[] = [
  { h: '매출계약코드(수정금지)', w: 22 },
  { h: '거래처코드(필수)', w: 12 },
  { h: '거래처명(참고)', w: 22 },
  { h: '구분(법인/개인)', w: 10 },
  { h: '사업장명(비우면 본사)', w: 16 },
  { h: '본점/지점', w: 9 },
  { h: '상태(정상/폐업/이관)', w: 13 },
  { h: '매출팀(감사team,taxteam)', w: 16 },
  { h: '매출유형(필수)', w: 30, typeRef: true },
  { h: '기타명칭', w: 14 },
  { h: '발생단위', w: 10, list: OCC },
  { h: '청구단위', w: 10, list: BUNIT },
  { h: '청구주기(필수)', w: 12, list: BILLING_CYCLES },
  { h: '분할(O/X)', w: 9, list: OX },
  { h: '계약금액(필수)', w: 13 },
  { h: '담당CPA', w: 12, list: CPA_LIST },
  { h: '담당직원(콤마)', w: 16 },
  { h: '귀속연도', w: 9 },
  { h: '계약일(YYYY-MM-DD)', w: 15 },
  { h: '개시일(YYYY-MM)', w: 13 },
  { h: '종료일(YYYY-MM/계속)', w: 15 },
  { h: '부가세포함(O/X)', w: 12, list: OX },
  { h: '원천세포함(O/X)', w: 12, list: OX },
  { h: '자문유형(일반/전문)', w: 14, list: ['일반', '전문'] },
  { h: '비고', w: 24 },
];
const HEADERS = COLS.map((c) => c.h);

const FILL_EDIT = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFF7D6' } };
const FILL_REF = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFECECEC' } };
const REF_COLS = new Set([0, 1, 2, 3, 4, 5, 6, 7]); // 매출계약코드·거래처코드~매출팀 = 회색(키/참고)

/** 계약 한 건의 계약 열(매출유형~비고) 값. */
function contractCells(c: SalesContract): (string | number)[] {
  return [
    LABEL_BY_CODE.get(c.categoryCode) ?? c.categoryCode,
    c.categoryEtcName || '', c.occurrenceUnit, c.billingUnit ?? '', c.billingCycle,
    c.isInstallment ? 'O' : '', c.amount, c.cpa || '', c.staff.map((s) => s.staffName).join(','),
    c.fiscalYear ?? '', c.contractDate || '', c.startDate ? c.startDate.slice(0, 7) : '',
    c.endDate ? c.endDate.slice(0, 7) : '', c.includesVat ? 'O' : '', c.includesWht ? 'O' : '',
    c.advisoryType ?? '', c.note || '',
  ];
}
const CONTRACT_COL_COUNT = 17; // 매출유형~비고

/**
 * 양식 내보내기 — 사업장 1행씩 프리필(거래처코드·거래처명·구분·사업장명·본점지점·상태·매출팀).
 * 기존 계약이 있으면 그 계약을 프리필한 회색 행(이미 등록·재업로드 시 스킵), 없으면 빈 노란 행(추가 입력).
 */
export async function exportContractTemplate(entities: BizEntityFull[], contracts: SalesContract[]): Promise<void> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('매출계약', { views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }] });
  const N = COLS.length;

  ws.addRow(HEADERS);
  ws.addRow(['※ 회색=키/참고(수정금지). 노란칸=입력·수정. 매출계약코드 있으면 그 계약을 수정, 없으면 신규. 한 사업장에 계약 여러 개면 행을 복사. 매출유형 빈 행은 제외.']);
  ws.getCell(2, 1).font = { ...FONT, size: 9, color: { argb: 'FF888888' } };

  const opt = wb.addWorksheet('선택목록');
  opt.getCell(1, 1).value = '매출유형';
  TYPE_OPTS.forEach((o, i) => { opt.getCell(i + 2, 1).value = o.label; });
  opt.state = 'hidden';
  const typeRef = `'선택목록'!$A$2:$A$${TYPE_OPTS.length + 1}`;

  const conByPlace = new Map<string, SalesContract[]>();
  for (const c of contracts) if (c.placeId) (conByPlace.get(c.placeId) ?? conByPlace.set(c.placeId, []).get(c.placeId)!).push(c);

  // 데이터 행 구성 — existing 플래그로 계약 열 색상(회색=기존/노랑=신규) 구분.
  const rows: { values: (string | number)[]; existing: boolean }[] = [];
  for (const e of entities) {
    for (const p of e.places) {
      const ref = [e.code, e.name, e.kind, p.placeName, p.branchType ?? '', p.status, p.salesTeams.join(',')];
      const cs = conByPlace.get(p.id) ?? [];
      if (cs.length) for (const c of cs) rows.push({ values: [c.contractCode || '', ...ref, ...contractCells(c)], existing: true });
      else rows.push({ values: ['', ...ref, ...new Array(CONTRACT_COL_COUNT).fill('')], existing: false });
    }
  }
  for (const r of rows) ws.addRow(r.values);

  const dataStart = 3;
  const dataEnd = ws.rowCount;
  frame(ws, 1, 1, 1, N, { fill: FILL_HEADER, bold: true, align: 'center', wrap: true });
  ws.getRow(1).height = 30;

  if (dataEnd >= dataStart) {
    frame(ws, dataStart, 1, dataEnd, N);
    for (let r = dataStart; r <= dataEnd; r++) {
      for (let ci = 0; ci < N; ci++) {
        const meta = COLS[ci];
        const isRef = REF_COLS.has(ci); // 키/참고 컬럼만 회색. 계약열은 기존·신규 모두 노랑(수정 허용)
        ws.getCell(r, ci + 1).fill = isRef ? FILL_REF : FILL_EDIT;
        if (!isRef) {
          if (meta.typeRef) ws.getCell(r, ci + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [typeRef] };
          else if (meta.list) ws.getCell(r, ci + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${meta.list.join(',')}"`] };
        }
      }
    }
  }
  setWidths(ws, COLS.map((c) => c.w));
  await saveWorkbook(wb, '매출계약_일괄등록양식.xlsx');
}

export interface ContractExcelRow {
  contractCode: string; code: string; placeName: string; type: string; etcName: string; occ: string; bunit: string;
  cycle: string; installment: string; amount: string; cpa: string; staff: string; year: string;
  contractDate: string; startDate: string; endDate: string; vat: string; wht: string; advisory: string; note: string;
}

export async function parseContractExcelFile(file: File): Promise<ContractExcelRow[]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
  if (raw.length < 2) return [];
  const header = (raw[0] as unknown[]).map((h) => String(h).trim());
  const idx = (kw: string) => header.findIndex((h) => h.includes(kw));
  const map = {
    contractCode: idx('매출계약코드'), code: idx('거래처코드'), placeName: idx('사업장명'), type: idx('매출유형'), etcName: idx('기타명칭'),
    occ: idx('발생단위'), bunit: idx('청구단위'), cycle: idx('청구주기'), installment: idx('분할'),
    amount: idx('계약금액'), cpa: idx('담당CPA'), staff: idx('담당직원'), year: idx('귀속연도'),
    contractDate: idx('계약일'), startDate: idx('개시일'), endDate: idx('종료일'),
    vat: idx('부가세'), wht: idx('원천세'), advisory: idx('자문'), note: idx('비고'),
  };
  const get = (row: unknown[], i: number) => (i >= 0 ? String(row[i] ?? '').trim() : '');
  const getDate = (row: unknown[], i: number): string => {
    if (i < 0) return '';
    const v = row[i];
    if (v == null || v === '') return '';
    if (typeof v === 'number' && v > 0) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
    return String(v).trim();
  };
  const out: ContractExcelRow[] = [];
  for (const r of raw.slice(1)) {
    const row = r as unknown[];
    const code = get(row, map.code);
    const type = get(row, map.type);
    if (code.startsWith('※')) continue;
    if (!code && !type) continue;
    out.push({
      contractCode: get(row, map.contractCode), code, placeName: get(row, map.placeName), type, etcName: get(row, map.etcName),
      occ: get(row, map.occ), bunit: get(row, map.bunit), cycle: get(row, map.cycle), installment: get(row, map.installment),
      amount: get(row, map.amount), cpa: get(row, map.cpa), staff: get(row, map.staff), year: get(row, map.year),
      contractDate: getDate(row, map.contractDate), startDate: getDate(row, map.startDate), endDate: getDate(row, map.endDate),
      vat: get(row, map.vat), wht: get(row, map.wht), advisory: get(row, map.advisory), note: get(row, map.note),
    });
  }
  return out;
}

export interface ContractExcelResult { created: number; updated: number; skipped: number; failed: { ref: string; error: string }[] }

const isO = (s: string) => /^(o|y|예|true|1|✓)$/i.test(s.trim());
const toMonthDate = (s: string): string | null => {
  const t = s.trim();
  if (!t || /계속/.test(t)) return null;
  if (/^\d{4}-\d{2}$/.test(t)) return `${t}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return null;
};
const asOcc = (s: string): OccurrenceUnit | undefined => (OCC as readonly string[]).includes(s) ? (s as OccurrenceUnit) : undefined;
const asBunit = (s: string): BillingUnit | undefined => (BUNIT as readonly string[]).includes(s) ? (s as BillingUnit) : undefined;
const asCycle = (s: string): BillingCycle | undefined => (BILLING_CYCLES as string[]).includes(s) ? (s as BillingCycle) : undefined;
/** 매출유형 셀 → leaf code (팀+경로 라벨, 순수 코드, 경로만 모두 허용). */
const asTypeCode = (s: string): string | undefined => {
  const t = s.trim();
  if (!t) return undefined;
  if (TYPE_BY_LABEL.has(t)) return TYPE_BY_LABEL.get(t);
  if (findNode(t) && leafOf(t)) return t; // 코드 직접입력
  const hit = TYPE_OPTS.find((o) => o.label.endsWith(t) || o.label.replace(/^[^·]+·/, '') === t);
  return hit?.code;
};

/**
 * 파싱된 행 적용.
 *  · 매출계약코드 있으면 그 계약을 찾아 **수정(update)**.
 *  · 코드 없으면 거래처코드+사업장명으로 사업장 찾아 **신규 생성**(동일 사업장+유형+귀속연도 있으면 스킵).
 */
export async function applyContractExcel(rows: ContractExcelRow[], entities: BizEntityFull[]): Promise<ContractExcelResult> {
  const res: ContractExcelResult = { created: 0, updated: 0, skipped: 0, failed: [] };
  const byCode = new Map(entities.map((e) => [e.code, e]));
  const staffProfiles = await listContractStaffProfiles();
  const staffByName = new Map(staffProfiles.map((s) => [s.name, s.id]));

  const { data: existing, error } = await supabase.from('biz_sales_contract').select('id, contract_code, place_id, category_code, fiscal_year');
  if (error) throw new Error(error.message);
  const key = (placeId: string, code: string, fy: number | null) => `${placeId}|${code}|${fy ?? ''}`;
  const seen = new Set<string>();
  const codeToId = new Map<string, string>();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  for (const c of (existing ?? []) as any[]) {
    seen.add(key(c.place_id, c.category_code, c.fiscal_year ?? null));
    if (c.contract_code) codeToId.set(c.contract_code, c.id);
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const resolveStaff = (cell: string) => cell.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean)
    .map((nm) => ({ nm, id: staffByName.get(nm) }))
    .filter((x): x is { nm: string; id: string } => !!x.id)
    .map((x) => ({ staffId: x.id, staffName: x.nm }));

  for (const r of rows) {
    if (!r.type) continue; // 매출유형 없는 행 = 미작성, 제외
    const ref = `${r.contractCode || r.code}${r.placeName ? `/${r.placeName}` : ''}`;
    try {
      const e = byCode.get(r.code);
      if (!e) { res.failed.push({ ref, error: '거래처코드를 찾을 수 없음' }); continue; }
      const place = r.placeName
        ? e.places.find((p) => p.placeName === r.placeName)
        : (e.places.find((p) => p.isHeadquarters) ?? e.places[0]);
      if (!place) { res.failed.push({ ref, error: '사업장을 찾을 수 없음' }); continue; }
      const code = asTypeCode(r.type);
      if (!code) { res.failed.push({ ref, error: `매출유형 인식 불가: ${r.type}` }); continue; }
      const node = findNode(code);
      const leaf = leafOf(code);
      if (!node || !leaf) { res.failed.push({ ref, error: '매출유형이 leaf 가 아님' }); continue; }
      const amount = Number(r.amount.replace(/[^\d.-]/g, '')) || 0;
      const fiscalYear = r.year ? (Number(r.year) || null) : null;

      const input: ContractInput = {
        entityId: e.id, placeId: place.id,
        team: node.team,
        categoryCode: code,
        categoryEtcName: r.etcName || undefined,
        occurrenceUnit: asOcc(r.occ) ?? leaf.defaultUnit ?? '사업장',
        billingUnit: asBunit(r.bunit) ?? null,
        billingCycle: asCycle(r.cycle) ?? leaf.defaultCycle ?? '월',
        isInstallment: isO(r.installment),
        amount,
        cpa: r.cpa || undefined,
        fiscalYear,
        contractDate: toMonthDate(r.contractDate),
        startDate: toMonthDate(r.startDate),
        endDate: toMonthDate(r.endDate),
        includesVat: r.vat ? isO(r.vat) : undefined,
        includesWht: r.wht ? isO(r.wht) : undefined,
        advisoryType: r.advisory === '전문' ? '전문' : r.advisory === '일반' ? '일반' : undefined,
        note: r.note || undefined,
      };

      // 매출계약코드로 기존 계약 수정
      if (r.contractCode && codeToId.has(r.contractCode)) {
        const id = codeToId.get(r.contractCode)!;
        await updateSalesContract(id, input);
        if (r.staff.trim()) await saveContractStaff(id, resolveStaff(r.staff)); // 담당 비우면 미변경
        res.updated++;
        continue;
      }

      // 신규 생성(동일 사업장+유형+귀속연도 중복 스킵)
      const k = key(place.id, code, fiscalYear);
      if (seen.has(k)) { res.skipped++; continue; }
      const contractId = await createSalesContract(input);
      const staff = resolveStaff(r.staff);
      if (staff.length) await saveContractStaff(contractId, staff);
      seen.add(k);
      res.created++;
    } catch (er) {
      res.failed.push({ ref, error: er instanceof Error ? er.message : String(er) });
    }
  }
  return res;
}
