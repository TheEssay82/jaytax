// 매출계약 일괄등록 Excel — 빈 양식(사업장 목록 프리필) 내보내기 + 업로드 적용.
// 매칭키 = 거래처코드 + 사업장명(비우면 본사). 전부 신규 생성하되, 동일 사업장+매출유형(+귀속연도) 활성 계약이
// 이미 있으면 스킵(재실행 안전). 매출유형은 팀+경로 라벨 드롭다운 → 내부 코드로 변환.
import { supabase } from './supabase';
import {
  createSalesContract, saveContractStaff, listContractStaffProfiles,
  BILLING_CYCLES, CPA_LIST,
  type ContractInput, type OccurrenceUnit, type BillingUnit, type BillingCycle,
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
const OCC = ['사업장', '법인', '개인'] as const;
const BUNIT = ['사업장', '법인', '개인', '건'] as const;
const OX = ['O', 'X'] as const;

interface ColMeta { h: string; w: number; list?: readonly string[]; typeRef?: boolean }
const COLS: ColMeta[] = [
  { h: '거래처코드(필수)', w: 12 },
  { h: '거래처명(참고)', w: 22 },
  { h: '사업장명(비우면 본사)', w: 16 },
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
const REF_COLS = new Set([0, 1]); // 거래처코드·거래처명(참고) = 회색(키/참고)

/** 빈 양식 내보내기 — 사업장 1행씩 프리필(거래처코드·거래처명·사업장명). 계약 열은 빈칸+드롭다운. */
export async function exportContractTemplate(entities: BizEntityFull[]): Promise<void> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('매출계약', { views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }] });
  const N = COLS.length;

  ws.addRow(HEADERS);
  ws.addRow(['※ 한 사업장에 계약이 여러 개면 그 행을 복사해 여러 줄로. 매출유형이 빈 행은 등록에서 제외됩니다.']);
  ws.getCell(2, 1).font = { ...FONT, size: 9, color: { argb: 'FF888888' } };

  // 매출유형 선택지 참조 시트
  const opt = wb.addWorksheet('선택목록');
  opt.getCell(1, 1).value = '매출유형';
  TYPE_OPTS.forEach((o, i) => { opt.getCell(i + 2, 1).value = o.label; });
  opt.state = 'hidden';
  const typeRef = `'선택목록'!$A$2:$A$${TYPE_OPTS.length + 1}`;

  for (const e of entities) {
    for (const p of e.places) {
      const row = new Array(N).fill('');
      row[0] = e.code; row[1] = e.name; row[2] = p.placeName;
      ws.addRow(row);
    }
  }
  const dataStart = 3;
  const dataEnd = ws.rowCount;

  frame(ws, 1, 1, 1, N, { fill: FILL_HEADER, bold: true, align: 'center', wrap: true });
  ws.getRow(1).height = 30;

  if (dataEnd >= dataStart) {
    frame(ws, dataStart, 1, dataEnd, N);
    for (let ci = 0; ci < N; ci++) {
      const meta = COLS[ci];
      const fill = REF_COLS.has(ci) ? FILL_REF : FILL_EDIT;
      for (let r = dataStart; r <= dataEnd; r++) {
        ws.getCell(r, ci + 1).fill = fill;
        if (meta.typeRef) {
          ws.getCell(r, ci + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [typeRef] };
        } else if (meta.list) {
          ws.getCell(r, ci + 1).dataValidation = {
            type: 'list', allowBlank: true, formulae: [`"${meta.list.join(',')}"`],
          };
        }
      }
    }
  }
  setWidths(ws, COLS.map((c) => c.w));
  await saveWorkbook(wb, '매출계약_일괄등록양식.xlsx');
}

export interface ContractExcelRow {
  code: string; placeName: string; type: string; etcName: string; occ: string; bunit: string;
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
    code: idx('거래처코드'), placeName: idx('사업장명'), type: idx('매출유형'), etcName: idx('기타명칭'),
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
      code, placeName: get(row, map.placeName), type, etcName: get(row, map.etcName),
      occ: get(row, map.occ), bunit: get(row, map.bunit), cycle: get(row, map.cycle), installment: get(row, map.installment),
      amount: get(row, map.amount), cpa: get(row, map.cpa), staff: get(row, map.staff), year: get(row, map.year),
      contractDate: getDate(row, map.contractDate), startDate: getDate(row, map.startDate), endDate: getDate(row, map.endDate),
      vat: get(row, map.vat), wht: get(row, map.wht), advisory: get(row, map.advisory), note: get(row, map.note),
    });
  }
  return out;
}

export interface ContractExcelResult { created: number; skipped: number; failed: { ref: string; error: string }[] }

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

/** 파싱된 행 적용 — 거래처코드+사업장명으로 사업장 찾아 신규 계약 생성. 동일 사업장+유형(+귀속연도) 있으면 스킵. */
export async function applyContractExcel(rows: ContractExcelRow[], entities: BizEntityFull[]): Promise<ContractExcelResult> {
  const res: ContractExcelResult = { created: 0, skipped: 0, failed: [] };
  const byCode = new Map(entities.map((e) => [e.code, e]));
  const staffProfiles = await listContractStaffProfiles();
  const staffByName = new Map(staffProfiles.map((s) => [s.name, s.id]));

  // 기존 계약 색인(중복 스킵) — place_id|category_code|fiscal_year
  const { data: existing, error } = await supabase.from('biz_sales_contract').select('place_id, category_code, fiscal_year');
  if (error) throw new Error(error.message);
  const key = (placeId: string, code: string, fy: number | null) => `${placeId}|${code}|${fy ?? ''}`;
  const seen = new Set<string>();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  for (const c of (existing ?? []) as any[]) seen.add(key(c.place_id, c.category_code, c.fiscal_year ?? null));
  /* eslint-enable @typescript-eslint/no-explicit-any */

  for (const r of rows) {
    if (!r.type) continue; // 매출유형 없는 행 = 미작성, 제외
    const ref = `${r.code}${r.placeName ? `/${r.placeName}` : ''}`;
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

      const k = key(place.id, code, fiscalYear);
      if (seen.has(k)) { res.skipped++; continue; }

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
      const contractId = await createSalesContract(input);
      // 담당직원(콤마)
      const staff = r.staff.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean)
        .map((nm) => ({ nm, id: staffByName.get(nm) }))
        .filter((x): x is { nm: string; id: string } => !!x.id)
        .map((x) => ({ staffId: x.id, staffName: x.nm }));
      if (staff.length) await saveContractStaff(contractId, staff);
      seen.add(k);
      res.created++;
    } catch (er) {
      res.failed.push({ ref, error: er instanceof Error ? er.message : String(er) });
    }
  }
  return res;
}
