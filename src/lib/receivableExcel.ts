// 기초 미수금 Excel — 사업장 목록이 프리필된 양식 내보내기 + 업로드.
// 단위는 사업장(세금계산서 발행 단위). 기준일은 2026-07-01 고정.
import { corpDisplayName, type BizEntityFull } from './bizRegistryApi';
import { OPENING_AS_OF, type ReceivableOpening } from './invoiceRequestApi';
import { FONT, FILL_HEADER, frame, setWidths, saveWorkbook } from './confirmExcelStyle';

async function loadExcelJS() {
  const mod = await import('exceljs');
  const ns = (mod as unknown as { default?: unknown }).default ?? mod;
  return ns as typeof import('exceljs');
}

const COLS = [
  { h: '사업장ID(수정금지)', w: 34 },
  { h: '거래처코드', w: 12 },
  { h: '거래처명', w: 22 },
  { h: '사업장명', w: 18 },
  { h: '사업자번호', w: 14 },
  { h: '상태', w: 8 },
  { h: `기초 미수금(${OPENING_AS_OF} 기준, VAT포함)`, w: 22 },
  { h: '비고', w: 24 },
];
const REF = new Set([0, 1, 2, 3, 4, 5]);
const FILL_EDIT = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFF7D6' } };
const FILL_REF = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFECECEC' } };

export async function exportOpeningTemplate(entities: BizEntityFull[], openings: ReceivableOpening[]): Promise<void> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('기초미수금', { views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }] });
  const byPlace = new Map(openings.map((o) => [o.placeId, o]));

  ws.addRow(COLS.map((c) => c.h));
  ws.addRow([`※ 회색=참고(수정금지). 노란칸에 ${OPENING_AS_OF} 기준 미수 잔액을 원 단위로 적어 올리세요. 0원도 '확인함'으로 저장됩니다. 빈칸은 건너뜁니다.`]);
  ws.getCell(2, 1).font = { ...FONT, size: 9, color: { argb: 'FF888888' } };

  for (const e of entities) {
    const name = corpDisplayName(e.name, e.corpForm, e.corpFormPosition);
    for (const p of e.places) {
      const o = byPlace.get(p.id);
      ws.addRow([p.id, e.code, name, p.placeName, p.bizRegNo || '', p.status, o ? o.amount : '', o?.note ?? '']);
    }
  }

  const N = COLS.length;
  const start = 3, end = ws.rowCount;
  frame(ws, 1, 1, 1, N, { fill: FILL_HEADER, bold: true, align: 'center', wrap: true });
  ws.getRow(1).height = 30;
  if (end >= start) {
    frame(ws, start, 1, end, N);
    for (let r = start; r <= end; r++) {
      for (let ci = 0; ci < N; ci++) ws.getCell(r, ci + 1).fill = REF.has(ci) ? FILL_REF : FILL_EDIT;
      ws.getCell(r, 7).numFmt = '#,##0';
    }
  }
  setWidths(ws, COLS.map((c) => c.w));
  await saveWorkbook(wb, `기초미수금_${OPENING_AS_OF}.xlsx`);
}

export interface OpeningExcelRow { placeId: string; amount: number; note: string; label: string }

export async function parseOpeningFile(file: File): Promise<OpeningExcelRow[]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
  if (raw.length < 2) return [];
  const header = (raw[0] as unknown[]).map((h) => String(h).trim());
  const idx = (kw: string) => header.findIndex((h) => h.includes(kw));
  const map = { id: idx('사업장ID'), name: idx('사업장명'), amount: idx('기초'), note: idx('비고'), company: idx('거래처명') };
  const get = (row: unknown[], i: number) => (i >= 0 ? String(row[i] ?? '').trim() : '');
  const out: OpeningExcelRow[] = [];
  for (const r of raw.slice(1)) {
    const row = r as unknown[];
    const placeId = get(row, map.id);
    if (!placeId || placeId.startsWith('※')) continue;
    const cell = get(row, map.amount);
    if (cell === '') continue;                       // 빈칸은 건너뜀(0 은 저장)
    const amount = Number(cell.replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(amount)) continue;
    out.push({ placeId, amount, note: get(row, map.note), label: `${get(row, map.company)} ${get(row, map.name)}`.trim() });
  }
  return out;
}
