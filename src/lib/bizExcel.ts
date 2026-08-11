// 거래처 레지스트리 Excel 라운드트립 (Phase B) — 이관 거래처 부족정보 보강 + 신규 대량등록.
// 내보내기: 사업장 1행 + 거래처코드(KEY) + 현재값 + 빈 칸. 채워서 다시 올리면 코드로 upsert.
// 코드 없는 행 = 신규 등록. 민감정보(주민번호·홈텍스PW)는 내보낼 때 출력 안 하고, 업로드 시 입력값만 암호화 저장.
// xlsx는 무거우므로 동적 import.
import {
  updateBizEntity, updateBizPlace, createBizEntity, createBizPlace, assignStaff,
  setEntityResident, setPlaceHometaxPw,
  CORP_FORMS, CPA_OPTIONS, PLACE_STATUSES, STAFF_STATUSES,
  type BizEntityFull, type BizKind, type BizNature, type CorpForm, type PlaceStatus, type SalesTeam,
  type StaffStatus, type TaxType, type Withholding, type StaffProfile,
} from './bizRegistryApi';
import { FONT, FILL_HEADER, frame, setWidths, saveWorkbook } from './confirmExcelStyle';

/** ExcelJS 동적 로드 (CJS interop) */
async function loadExcelJS() {
  const mod = await import('exceljs');
  const ns = (mod as unknown as { default?: unknown }).default ?? mod;
  return ns as typeof import('exceljs');
}

// 컬럼 정의(HEADERS 와 1:1). list=드롭다운 선택지, strict=목록 외 입력 차단, readonly=회색(수정금지).
interface ColMeta { h: string; w: number; list?: readonly string[]; strict?: boolean; readonly?: boolean }
const COLS: ColMeta[] = [
  { h: '거래처코드(수정금지)', w: 13, readonly: true },
  { h: '구분(법인/개인)', w: 12, list: ['법인', '개인'], strict: true },
  { h: '상호/성명', w: 22 },
  { h: '법인격', w: 12, list: CORP_FORMS, strict: true },
  { h: '법인격위치(앞/뒤)', w: 13, list: ['앞', '뒤'], strict: true },
  { h: '법인등록번호', w: 16 },
  { h: '주민등록번호🔒', w: 16 },
  { h: '설립일(YYYY-MM-DD)', w: 15 },
  { h: '사업장명', w: 16 },
  { h: '본점/지점', w: 10, list: ['본점', '지점'], strict: true },
  { h: '사업자번호', w: 14 },
  { h: '사업자없음(O/X)', w: 12, list: ['O', 'X'], strict: true },
  { h: '상태(정상/폐업/이관)', w: 14, list: PLACE_STATUSES, strict: true },
  { h: '귀속월(YYYY-MM)', w: 13 },
  { h: '사업장주소', w: 28 },
  { h: '성격(매출/일반)', w: 12, list: ['매출', '일반'], strict: true },
  { h: '매출팀(감사team,taxteam)', w: 20 },
  { h: '과세유형', w: 12, list: ['과세', '겸영', '면세'], strict: true },
  { h: '원천세', w: 12, list: ['월별', '반기별', 'N/A'], strict: true },
  { h: '개업일(YYYY-MM-DD)', w: 15 },
  { h: '사업자단위과세(O/X)', w: 14, list: ['O', 'X'], strict: true },
  { h: '담당CPA', w: 12, list: CPA_OPTIONS, strict: false },
  { h: '홈텍스ID', w: 14 },
  { h: '홈텍스PW🔒', w: 14 },
  { h: '담당직원(콤마·배정예정·N/A)', w: 22 },
  { h: '비고', w: 24 },
  { h: '이관업체', w: 18 },
  { h: '이관업체연락처', w: 16 },
  { h: '이관업체담당자', w: 14 },
];
const HEADERS = COLS.map((c) => c.h);
const placeCode = (e: BizEntityFull, placeNo: number) => `${e.code}-${String(placeNo).padStart(2, '0')}`;

// 입력 셀 채움색: 보통(연노랑)·민감(연빨강)·읽기전용(회색)
const FILL_EDIT = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFF7D6' } };
const FILL_PII = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFCE4E4' } };
const FILL_RO = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFECECEC' } };
// 민감(암호화) 컬럼 = 헤더에 🔒 표시(주민등록번호·홈텍스PW). 컬럼 추가로 인덱스가 밀려도 안전하게 계산.
const PII_COLS = new Set(COLS.map((c, i) => (c.h.includes('🔒') ? i : -1)).filter((i) => i >= 0));

/** 보강 양식 내보내기 — 사업장 1행. 입력셀 색상 + 선택 드롭다운. 민감정보(주민번호·PW)는 빈 칸(보안). */
export async function exportBizRegistry(entities: BizEntityFull[]): Promise<void> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('거래처보강', { views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }] });
  const N = COLS.length;

  ws.addRow(HEADERS);
  ws.addRow(['※ 코드 있는 행 = 보강(빈 칸은 미변경) · 코드 없는 행 = 신규 등록 · 노란칸=입력, 분홍칸=민감(입력값만 암호화 저장)']);
  ws.getCell(2, 1).font = { ...FONT, size: 9, color: { argb: 'FF888888' } };

  for (const e of entities) {
    for (const p of e.places) {
      ws.addRow([
        placeCode(e, p.placeNo), e.kind, e.name, e.corpForm ?? '', e.corpFormPosition ?? '',
        e.corpRegNo, '', e.establishedDate ?? '', p.placeName, p.branchType ?? '',
        p.bizRegNo, p.noBiz ? 'O' : '', p.status, p.statusMonth, p.address, p.nature, p.salesTeams.join(','),
        p.taxType ?? '', p.withholding ?? '', p.openedDate ?? '', p.unitTaxation ? 'O' : '',
        p.cpa, p.hometaxId, '',
        p.staff.length ? p.staff.map((s) => s.staffName).filter(Boolean).join(',') : (p.staffStatus ?? ''), p.note,
        p.transferTo, p.transferContact, p.transferManager,
      ]);
    }
  }
  const dataStart = 3;
  const dataEnd = ws.rowCount;

  // 헤더 스타일
  frame(ws, 1, 1, 1, N, { fill: FILL_HEADER, bold: true, align: 'center', wrap: true });
  ws.getRow(1).height = 30;

  // 본문: 테두리 + 폰트 + 채움 + 드롭다운
  if (dataEnd >= dataStart) {
    frame(ws, dataStart, 1, dataEnd, N);
    for (let ci = 0; ci < N; ci++) {
      const meta = COLS[ci];
      const fill = meta.readonly ? FILL_RO : PII_COLS.has(ci) ? FILL_PII : FILL_EDIT;
      for (let r = dataStart; r <= dataEnd; r++) {
        ws.getCell(r, ci + 1).fill = fill;
        if (meta.list) {
          ws.getCell(r, ci + 1).dataValidation = {
            type: 'list', allowBlank: true, formulae: [`"${meta.list.join(',')}"`],
            showErrorMessage: !!meta.strict,
            errorTitle: meta.h, error: `${meta.list.join(' / ')} 중에서 선택하세요.`,
          };
        }
      }
    }
  }
  setWidths(ws, COLS.map((c) => c.w));
  await saveWorkbook(wb, '거래처_보강양식.xlsx');
}

export interface ExcelRow {
  code: string; kind: string; name: string; corpForm: string; corpFormPos: string;
  corpRegNo: string; residentNo: string; establishedDate: string; placeName: string; branchType: string;
  bizRegNo: string; noBiz: string; status: string; statusMonth: string; address: string; nature: string; salesTeams: string;
  taxType: string; withholding: string; openedDate: string; unitTaxation: string;
  cpa: string; hometaxId: string; hometaxPw: string; staff: string; note: string;
  transferTo: string; transferContact: string; transferManager: string;
}

/** 업로드 파일 파싱 → ExcelRow[] */
export async function parseBizExcelFile(file: File): Promise<ExcelRow[]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
  if (raw.length < 2) return [];
  const header = (raw[0] as unknown[]).map((h) => String(h).trim());
  const idx = (kw: string) => header.findIndex((h) => h.includes(kw));
  const map = {
    code: idx('거래처코드'), kind: idx('구분'), name: idx('상호'), corpForm: idx('법인격'), corpFormPos: idx('법인격위치'),
    corpRegNo: idx('법인등록번호'), residentNo: idx('주민등록번호'), establishedDate: idx('설립일'), placeName: idx('사업장명'),
    branchType: idx('본점'), bizRegNo: idx('사업자번호'), noBiz: idx('사업자없음'),
    status: idx('상태'), statusMonth: idx('귀속월'), address: idx('사업장주소'),
    nature: idx('성격'), salesTeams: idx('매출팀'), taxType: idx('과세유형'), withholding: idx('원천세'),
    openedDate: idx('개업일'), unitTaxation: idx('사업자단위과세'), cpa: idx('담당CPA'), hometaxId: idx('홈텍스ID'),
    hometaxPw: idx('홈텍스PW'), staff: idx('담당직원'), note: idx('비고'),
    // '이관업체연락처'·'이관업체담당자'도 '이관업체'를 포함하므로, transferTo 는 연락처/담당자를 제외해 매칭.
    transferTo: header.findIndex((h) => h.includes('이관업체') && !h.includes('연락처') && !h.includes('담당자')),
    transferContact: idx('이관업체연락처'), transferManager: idx('이관업체담당자'),
  };
  const get = (row: unknown[], i: number) => (i >= 0 ? String(row[i] ?? '').trim() : '');
  // 날짜 셀: Excel이 날짜 서식이면 일련번호(예: 45673)로 저장됨 → YYYY-MM-DD 로 변환
  const getDate = (row: unknown[], i: number): string => {
    if (i < 0) return '';
    const v = row[i];
    if (v == null || v === '') return '';
    if (typeof v === 'number' && v > 0) {
      const ms = Math.round((v - 25569) * 86400000); // 25569 = 1970-01-01 의 Excel 일련번호
      return new Date(ms).toISOString().slice(0, 10);
    }
    return String(v).trim();
  };
  // 귀속월 셀: 'YYYY-MM'. Excel 날짜서식이면 일련번호로 저장됨 → YYYY-MM 으로. 'YYYY-MM-DD' 도 앞 7자리만.
  const getMonth = (row: unknown[], i: number): string => {
    const d = getDate(row, i);
    return d ? d.slice(0, 7) : '';
  };
  const out: ExcelRow[] = [];
  for (const r of raw.slice(1)) {
    const row = r as unknown[];
    const name = get(row, map.name);
    const code = get(row, map.code);
    // 빈 행·주석(※)·코드형식 아닌 행 스킵. 신규 등록 행은 code 가 빈칸이어야 한다.
    if (!name && !code) continue;
    if (name.startsWith('※') || code.startsWith('※')) continue;
    if (code && !/^[A-Za-z]\d+-\d+$/.test(code)) continue; // 유효 코드(L0001-01) 아니면 스킵
    out.push({
      code, kind: get(row, map.kind), name, corpForm: get(row, map.corpForm), corpFormPos: get(row, map.corpFormPos),
      corpRegNo: get(row, map.corpRegNo), residentNo: get(row, map.residentNo), establishedDate: getDate(row, map.establishedDate),
      placeName: get(row, map.placeName), branchType: get(row, map.branchType), bizRegNo: get(row, map.bizRegNo),
      noBiz: get(row, map.noBiz), status: get(row, map.status), statusMonth: getMonth(row, map.statusMonth),
      address: get(row, map.address), nature: get(row, map.nature), salesTeams: get(row, map.salesTeams),
      taxType: get(row, map.taxType), withholding: get(row, map.withholding), openedDate: getDate(row, map.openedDate),
      unitTaxation: get(row, map.unitTaxation), cpa: get(row, map.cpa), hometaxId: get(row, map.hometaxId),
      hometaxPw: get(row, map.hometaxPw), staff: get(row, map.staff), note: get(row, map.note),
      transferTo: get(row, map.transferTo), transferContact: get(row, map.transferContact), transferManager: get(row, map.transferManager),
    });
  }
  return out;
}

export interface ExcelApplyResult { updated: number; created: number; failed: { ref: string; error: string }[] }

const isO = (s: string) => /^(o|y|예|true|1|✓)$/i.test(s.trim());
const asCorpForm = (s: string): CorpForm | undefined => (CORP_FORMS as string[]).includes(s) ? (s as CorpForm) : undefined;
const asNature = (s: string): BizNature | undefined => (s === '매출' || s === '일반') ? s : undefined;
const asTaxType = (s: string): TaxType | undefined => (['과세', '겸영', '면세'] as string[]).includes(s) ? (s as TaxType) : undefined;
const asWithholding = (s: string): Withholding | undefined => (['월별', '반기별', 'N/A'] as string[]).includes(s) ? (s as Withholding) : undefined;
const asStatus = (s: string): PlaceStatus | undefined => (PLACE_STATUSES as string[]).includes(s) ? (s as PlaceStatus) : undefined;
/** 담당직원 칸 값이 상태 토큰(배정예정·N/A)이면 그 값, 아니면 undefined(=실제 이름들). */
const asStaffStatus = (s: string): StaffStatus | undefined => {
  const t = s.trim();
  if (t === '배정예정') return '배정예정';
  if (/^n\/?a$/i.test(t)) return 'N/A';
  return (STAFF_STATUSES as string[]).includes(t) ? (t as StaffStatus) : undefined;
};
const parseTeams = (s: string): SalesTeam[] => s.split(/[,\s]+/).map((x) => x.trim()).filter((x) => x === '감사team' || x === 'taxteam') as SalesTeam[];

/** 파싱된 행 적용 — 코드 있으면 upsert(보강), 없으면 신규 등록. 빈 칸은 미변경. */
export async function applyBizExcel(rows: ExcelRow[], entities: BizEntityFull[], staff: StaffProfile[]): Promise<ExcelApplyResult> {
  const res: ExcelApplyResult = { updated: 0, created: 0, failed: [] };
  const staffByName = new Map(staff.map((s) => [s.name, s.id]));
  // 코드 → {entity, place} 색인
  const byCode = new Map<string, { e: BizEntityFull; placeId: string; placeStaffNames: Set<string> }>();
  for (const e of entities) for (const p of e.places) {
    byCode.set(`${e.code}-${String(p.placeNo).padStart(2, '0')}`, { e, placeId: p.id, placeStaffNames: new Set(p.staff.map((s) => s.staffName)) });
  }

  async function assignStaffNames(placeId: string, cell: string, already: Set<string>) {
    for (const nm of cell.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean)) {
      if (already.has(nm)) continue;
      const sid = staffByName.get(nm);
      if (!sid) continue;
      try {
        await assignStaff(placeId, sid, nm);
      } catch (e) {
        // 이미 배정(활성 유니크 충돌)이면 무시, 그 외만 전파
        if (!/duplicate|unique|23505|이미/i.test(e instanceof Error ? e.message : String(e))) throw e;
      }
    }
  }

  for (const r of rows) {
    const ref = r.code || r.name;
    try {
      if (r.code) {
        // ── 보강(upsert) ──
        const hit = byCode.get(r.code);
        if (!hit) { res.failed.push({ ref, error: '코드에 해당하는 거래처를 찾을 수 없음' }); continue; }
        // entity patch (빈 칸 미변경)
        const ep: Record<string, unknown> = {};
        if (r.name) ep.name = r.name;
        if (hit.e.kind === '법인') {
          if (r.corpForm) ep.corpForm = asCorpForm(r.corpForm) ?? null;
          if (r.corpFormPos === '앞' || r.corpFormPos === '뒤') ep.corpFormPosition = r.corpFormPos;
          if (r.corpRegNo) ep.corpRegNo = r.corpRegNo;
          if (r.establishedDate) ep.establishedDate = r.establishedDate;
        }
        if (Object.keys(ep).length) await updateBizEntity(hit.e.id, ep);
        if (hit.e.kind === '개인' && r.residentNo) await setEntityResident(hit.e.id, r.residentNo);
        // place patch
        const pp: Record<string, unknown> = {};
        if (r.placeName) pp.placeName = r.placeName;
        if (r.branchType === '본점' || r.branchType === '지점') pp.branchType = r.branchType;
        if (r.bizRegNo) pp.bizRegNo = r.bizRegNo;
        if (r.noBiz) pp.noBiz = isO(r.noBiz);
        if (asStatus(r.status)) {
          const st = asStatus(r.status)!;
          pp.status = st;
          pp.statusMonth = st === '정상' ? null : (r.statusMonth || null);
          pp.transferTo = st === '이관' ? (r.transferTo || null) : null;
          pp.transferContact = st === '이관' ? (r.transferContact || null) : null;
          pp.transferManager = st === '이관' ? (r.transferManager || null) : null;
        }
        if (r.address) pp.address = r.address;
        if (asNature(r.nature)) pp.nature = asNature(r.nature);
        if (r.salesTeams) pp.salesTeams = parseTeams(r.salesTeams);
        if (asTaxType(r.taxType)) pp.taxType = asTaxType(r.taxType);
        if (asWithholding(r.withholding)) pp.withholding = asWithholding(r.withholding);
        if (r.openedDate) pp.openedDate = r.openedDate;
        if (r.unitTaxation) pp.unitTaxation = isO(r.unitTaxation);
        if (r.cpa) pp.cpa = r.cpa;
        if (r.hometaxId) pp.hometaxId = r.hometaxId;
        // 담당직원 칸: '배정예정'/'N/A' 토큰이면 상태로, 실제 이름이면 배정(+상태 해제).
        const st = r.staff ? asStaffStatus(r.staff) : undefined;
        if (r.staff) pp.staffStatus = st ?? null;
        if (Object.keys(pp).length) await updateBizPlace(hit.placeId, pp);
        if (r.hometaxPw) await setPlaceHometaxPw(hit.placeId, r.hometaxPw);
        if (r.staff && !st) await assignStaffNames(hit.placeId, r.staff, hit.placeStaffNames);
        res.updated++;
      } else {
        // ── 신규 등록 ──
        if (!r.name || !r.placeName) { res.failed.push({ ref, error: '신규 행은 상호/성명과 사업장명이 필요' }); continue; }
        const kind: BizKind = r.kind === '개인' ? '개인' : '법인';
        const entityId = await createBizEntity({
          kind, name: r.name,
          corpForm: kind === '법인' ? asCorpForm(r.corpForm) ?? null : null,
          corpFormPosition: kind === '법인' && (r.corpFormPos === '앞' || r.corpFormPos === '뒤') ? r.corpFormPos : null,
          corpRegNo: kind === '법인' ? r.corpRegNo : undefined,
          establishedDate: kind === '법인' ? (r.establishedDate || null) : null,
          note: r.note || undefined,
          residentNo: kind === '개인' ? r.residentNo : undefined,
        });
        const placeId = await createBizPlace({
          entityId, placeName: r.placeName, isHeadquarters: true,
          branchType: r.branchType === '지점' ? '지점' : '본점',
          bizRegNo: r.bizRegNo || undefined, noBiz: isO(r.noBiz), address: r.address || undefined,
          status: asStatus(r.status) ?? '정상',
          statusMonth: asStatus(r.status) && asStatus(r.status) !== '정상' ? (r.statusMonth || null) : null,
          transferTo: asStatus(r.status) === '이관' ? (r.transferTo || null) : null,
          transferContact: asStatus(r.status) === '이관' ? (r.transferContact || null) : null,
          transferManager: asStatus(r.status) === '이관' ? (r.transferManager || null) : null,
          nature: asNature(r.nature) ?? '매출', salesTeams: parseTeams(r.salesTeams),
          taxType: asTaxType(r.taxType) ?? null, withholding: asWithholding(r.withholding) ?? null,
          openedDate: r.openedDate || null, unitTaxation: isO(r.unitTaxation),
          cpa: r.cpa || undefined, hometaxId: r.hometaxId || undefined, hometaxPw: r.hometaxPw || undefined,
          note: r.note || undefined,
          staffStatus: r.staff ? (asStaffStatus(r.staff) ?? null) : null,
        });
        if (r.staff && !asStaffStatus(r.staff)) await assignStaffNames(placeId, r.staff, new Set());
        res.created++;
      }
    } catch (e) {
      res.failed.push({ ref, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return res;
}
