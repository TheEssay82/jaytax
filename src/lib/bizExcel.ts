// 거래처 레지스트리 Excel 라운드트립 (Phase B) — 이관 거래처 부족정보 보강 + 신규 대량등록.
// 내보내기: 사업장 1행 + 거래처코드(KEY) + 현재값 + 빈 칸. 채워서 다시 올리면 코드로 upsert.
// 코드 없는 행 = 신규 등록. 민감정보(주민번호·홈텍스PW)는 내보낼 때 출력 안 하고, 업로드 시 입력값만 암호화 저장.
// xlsx는 무거우므로 동적 import.
import {
  updateBizEntity, updateBizPlace, createBizEntity, createBizPlace, assignStaff,
  setEntityResident, setPlaceHometaxPw,
  CORP_FORMS,
  type BizEntityFull, type BizKind, type BizNature, type CorpForm, type SalesTeam,
  type TaxType, type Withholding, type StaffProfile,
} from './bizRegistryApi';

const HEADERS = [
  '거래처코드(수정금지)', '구분(법인/개인)', '상호/성명', '법인격', '법인격위치(앞/뒤)',
  '법인등록번호', '주민등록번호', '설립일(YYYY-MM-DD)', '사업장명', '본점/지점',
  '사업자번호', '사업자없음(O)', '사업장주소', '성격(매출/일반)', '매출팀(감사team,taxteam)',
  '과세유형(과세/겸영/면세)', '원천세(월별/반기별/N/A)', '개업일(YYYY-MM-DD)', '사업자단위과세(O)',
  '담당CPA', '홈텍스ID', '홈텍스PW', '담당직원(콤마)', '비고',
];
const placeCode = (e: BizEntityFull, placeNo: number) => `${e.code}-${String(placeNo).padStart(2, '0')}`;

/** 보강 양식 내보내기 — 사업장 1행. 민감정보(주민번호·PW)는 빈 칸(보안). */
export async function exportBizRegistry(entities: BizEntityFull[]): Promise<void> {
  const XLSX = await import('xlsx');
  const rows: (string | number)[][] = [HEADERS];
  const note = ['※ 코드 있는 행=보강(빈 칸은 미변경), 코드 없는 행=신규 등록', '', '', '', '', '', '(입력값만 암호화 저장)', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '(입력값만 저장)', '', ''];
  rows.push(note);
  for (const e of entities) {
    for (const p of e.places) {
      rows.push([
        placeCode(e, p.placeNo), e.kind, e.name, e.corpForm ?? '', e.corpFormPosition ?? '',
        e.corpRegNo, '', e.establishedDate ?? '', p.placeName, p.branchType ?? '',
        p.bizRegNo, p.noBiz ? 'O' : '', p.address, p.nature, p.salesTeams.join(','),
        p.taxType ?? '', p.withholding ?? '', p.openedDate ?? '', p.unitTaxation ? 'O' : '',
        p.cpa, p.hometaxId, '', p.staff.map((s) => s.staffName).filter(Boolean).join(','), p.note,
      ]);
    }
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = HEADERS.map(() => ({ wch: 18 }));
  XLSX.utils.book_append_sheet(wb, ws, '거래처보강');
  XLSX.writeFile(wb, '거래처_보강양식.xlsx');
}

export interface ExcelRow {
  code: string; kind: string; name: string; corpForm: string; corpFormPos: string;
  corpRegNo: string; residentNo: string; establishedDate: string; placeName: string; branchType: string;
  bizRegNo: string; noBiz: string; address: string; nature: string; salesTeams: string;
  taxType: string; withholding: string; openedDate: string; unitTaxation: string;
  cpa: string; hometaxId: string; hometaxPw: string; staff: string; note: string;
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
    branchType: idx('본점'), bizRegNo: idx('사업자번호'), noBiz: idx('사업자없음'), address: idx('사업장주소'),
    nature: idx('성격'), salesTeams: idx('매출팀'), taxType: idx('과세유형'), withholding: idx('원천세'),
    openedDate: idx('개업일'), unitTaxation: idx('사업자단위과세'), cpa: idx('담당CPA'), hometaxId: idx('홈텍스ID'),
    hometaxPw: idx('홈텍스PW'), staff: idx('담당직원'), note: idx('비고'),
  };
  const get = (row: unknown[], i: number) => (i >= 0 ? String(row[i] ?? '').trim() : '');
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
      corpRegNo: get(row, map.corpRegNo), residentNo: get(row, map.residentNo), establishedDate: get(row, map.establishedDate),
      placeName: get(row, map.placeName), branchType: get(row, map.branchType), bizRegNo: get(row, map.bizRegNo),
      noBiz: get(row, map.noBiz), address: get(row, map.address), nature: get(row, map.nature), salesTeams: get(row, map.salesTeams),
      taxType: get(row, map.taxType), withholding: get(row, map.withholding), openedDate: get(row, map.openedDate),
      unitTaxation: get(row, map.unitTaxation), cpa: get(row, map.cpa), hometaxId: get(row, map.hometaxId),
      hometaxPw: get(row, map.hometaxPw), staff: get(row, map.staff), note: get(row, map.note),
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
        if (r.address) pp.address = r.address;
        if (asNature(r.nature)) pp.nature = asNature(r.nature);
        if (r.salesTeams) pp.salesTeams = parseTeams(r.salesTeams);
        if (asTaxType(r.taxType)) pp.taxType = asTaxType(r.taxType);
        if (asWithholding(r.withholding)) pp.withholding = asWithholding(r.withholding);
        if (r.openedDate) pp.openedDate = r.openedDate;
        if (r.unitTaxation) pp.unitTaxation = isO(r.unitTaxation);
        if (r.cpa) pp.cpa = r.cpa;
        if (r.hometaxId) pp.hometaxId = r.hometaxId;
        if (Object.keys(pp).length) await updateBizPlace(hit.placeId, pp);
        if (r.hometaxPw) await setPlaceHometaxPw(hit.placeId, r.hometaxPw);
        if (r.staff) await assignStaffNames(hit.placeId, r.staff, hit.placeStaffNames);
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
          nature: asNature(r.nature) ?? '매출', salesTeams: parseTeams(r.salesTeams),
          taxType: asTaxType(r.taxType) ?? null, withholding: asWithholding(r.withholding) ?? null,
          openedDate: r.openedDate || null, unitTaxation: isO(r.unitTaxation),
          cpa: r.cpa || undefined, hometaxId: r.hometaxId || undefined, hometaxPw: r.hometaxPw || undefined,
          note: r.note || undefined,
        });
        if (r.staff) await assignStaffNames(placeId, r.staff, new Set());
        res.created++;
      }
    } catch (e) {
      res.failed.push({ ref, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return res;
}
