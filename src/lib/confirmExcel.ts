// 조회서 엑셀 — 양식 다운로드 / 조서 출력 / 총괄 출력 / 업로드 파싱
//
// 출력 서식은 2025 control sheet 를 따른다(맑은 고딕 10pt, thin 테두리, 2단 헤더,
// 입력칸 노란 채움, 가로 인쇄 + 헤더행 반복). 서식을 쓰려면 ExcelJS 가 필요한데
// 용량이 커서 내보내는 순간에만 동적 로드한다(평소 화면에는 실리지 않는다).
//
// 읽기(파싱)는 가벼운 SheetJS 로 충분해 그대로 쓴다.
import * as XLSX from 'xlsx';
import { ITEM_KINDS, DEFAULT_CONTACT, type ItemInput, type ItemKind } from './confirmApi';
import type { Confirmation, ConfirmItem, Progress } from './confirmApi';
import { summarize, pct } from './confirmApi';
import {
  FONT, FONT_BOLD, FONT_TITLE, FILL_HEADER, FILL_INPUT, FILL_TOTAL,
  frame, setupPrint, setWidths, saveWorkbook,
} from './confirmExcelStyle';

const d = (s: string | null) => (s ? s.replace(/-/g, '.') : '');

/** ExcelJS 동적 로드 (CJS interop 대응) */
async function loadExcelJS() {
  const mod = await import('exceljs');
  const ns = (mod as unknown as { default?: unknown }).default ?? mod;
  return ns as typeof import('exceljs');
}

// ── 조회처 명세 양식(업로드/배포용) ─────────────────────────
const FORM_HEADERS = [
  'No.', '구분', '금융기관명', '조회방식', '주소', '우편번호', '전화번호',
  '부서', '담당자명', '직책', '비고',
] as const;
const FORM_WIDTHS = [5, 12, 24, 11, 42, 9, 15, 12, 16, 9, 30];

/** 명세 양식 공통 뼈대 — 제목 + 안내 + 2단 헤더 + 본문. 반환값은 본문 시작행. */
function buildFormSheet(
  ws: import('exceljs').Worksheet,
  title: string,
  subtitle: string,
  rows: (string | number)[][],
  blankRows = 0,
): number {
  const LAST = FORM_HEADERS.length; // 11열

  ws.mergeCells(1, 1, 1, LAST);
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = FONT_TITLE;
  ws.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, LAST);
  ws.getCell(2, 1).value = subtitle;
  ws.getCell(2, 1).font = { ...FONT, size: 9, color: { argb: 'FF666666' } };
  ws.getCell(2, 1).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 18;

  const H = 3; // 헤더행
  FORM_HEADERS.forEach((h, i) => { ws.getCell(H, i + 1).value = h; });
  frame(ws, H, 1, H, LAST, { fill: FILL_HEADER, bold: true, align: 'center' });
  ws.getRow(H).height = 22;

  rows.forEach((r, i) => {
    r.forEach((v, c) => { ws.getCell(H + 1 + i, c + 1).value = v; });
  });
  const dataEnd = H + rows.length + blankRows;
  if (dataEnd > H) {
    frame(ws, H + 1, 1, dataEnd, LAST, { wrap: true });
    // No.·구분·조회방식·우편번호·직책은 가운데
    for (const c of [1, 2, 4, 6, 10]) {
      for (let r = H + 1; r <= dataEnd; r++) ws.getCell(r, c).alignment = { vertical: 'middle', horizontal: 'center' };
    }
  }

  // 거래처가 채우는 칸이라 선택지를 드롭다운으로 준다(오타·표기흔들림 방지)
  for (let r = H + 1; r <= dataEnd; r++) {
    ws.getCell(r, 2).dataValidation = {
      type: 'list', allowBlank: true, formulae: [`"${ITEM_KINDS.join(',')}"`],
      showErrorMessage: true, errorTitle: '구분', error: `${ITEM_KINDS.join(' / ')} 중에서 선택하세요.`,
    };
    ws.getCell(r, 4).dataValidation = {
      type: 'list', allowBlank: true, formulae: ['"전자조회,우편"'],
      showErrorMessage: true, errorTitle: '조회방식', error: '전자조회 또는 우편을 선택하세요.',
    };
  }

  setWidths(ws, FORM_WIDTHS);
  setupPrint(ws, `${H}:${H}`, 'K', dataEnd);
  return dataEnd;
}

/** 빈 양식 — 거래처에 보내 조회처 목록을 받아오는 용도 */
export async function downloadBlankTemplate(companyName?: string): Promise<void> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('조회처목록', { views: [{ state: 'frozen', ySplit: 3 }] });

  buildFormSheet(
    ws,
    `금융기관조회서 조회처 목록${companyName ? ` — ${companyName}` : ''}`,
    `구분·조회방식은 셀을 클릭해 목록에서 고르세요. 전자조회면 주소·우편번호는 비워 두시면 됩니다. 담당자명 기본값은 ‘${DEFAULT_CONTACT}’ 입니다.`,
    [[1, '은행', '（예시）국민은행', '전자조회', '', '', '', '', DEFAULT_CONTACT, '', '']],
    29, // 빈 줄 29행 = 총 30행
  );
  // 예시 행은 옅게 — 지우고 쓰라는 뜻
  for (let c = 1; c <= FORM_HEADERS.length; c++) {
    ws.getCell(4, c).font = { ...FONT, italic: true, color: { argb: 'FF999999' } };
  }

  await saveWorkbook(wb, `금융기관조회서_조회처양식${companyName ? `_${companyName}` : ''}.xlsx`);
}

/** 현재 명세 다운로드 — 손봐서 다시 올리는 용도(업로드 파서가 그대로 읽는다) */
export async function downloadItems(companyName: string, fiscalYear: number, items: ItemInput[]): Promise<void> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('조회처목록', { views: [{ state: 'frozen', ySplit: 3 }] });

  const rows = items.map((it, i) => [
    it.seq || i + 1,
    it.kind,
    it.institution,
    it.isElectronic ? '전자조회' : '우편',
    it.isElectronic ? '' : it.address,
    it.isElectronic ? '' : it.postalCode,
    it.phone, it.dept, it.contactName, it.contactTitle, it.note,
  ]);
  buildFormSheet(
    ws,
    `금융기관조회서 조회처 목록 — ${companyName} (${fiscalYear} 회계연도)`,
    '이 파일을 수정한 뒤 그대로 다시 업로드하면 명세가 교체됩니다.',
    rows,
    3,
  );
  await saveWorkbook(wb, `금융기관조회서_${companyName}_${fiscalYear}.xlsx`);
}

// ── 진행현황 조서 ───────────────────────────────────────────
/**
 * 거래처별 진행현황 조서 — 2025 control sheet 의 개별 시트 서식을 따른다.
 * 머리(회사명·기준일·담당회계사 + 발송 일자/담당/서명) / 2단 헤더 본문 / 꼬리(합계·회수율 확인란).
 */
export async function exportConfirmationSheet(conf: Confirmation, items: ConfirmItem[]): Promise<void> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('조회서');
  const p = summarize(items);
  const LAST = 15; // A..O

  // 제목
  ws.mergeCells(1, 1, 1, LAST);
  ws.getCell(1, 1).value = '금융기관조회서(적극적 조회) Control Sheet';
  ws.getCell(1, 1).font = FONT_TITLE;
  ws.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 28;

  // 머리말 (3~5행) — 좌: 회사정보 / 우: 발송 일자·담당·서명
  const head: [string, string][] = [
    ['회사명', conf.companyName],
    ['조회발송기준일', d(conf.baseDate)],
    ['담당회계사', conf.accountantName || ''],
  ];
  head.forEach(([label, value], i) => {
    const r = 3 + i;
    ws.mergeCells(r, 1, r, 2);
    ws.getCell(r, 1).value = label;
    ws.mergeCells(r, 3, r, 6);
    ws.getCell(r, 3).value = value;
    ws.getRow(r).height = 20;
  });
  frame(ws, 3, 1, 5, 2, { fill: FILL_HEADER, bold: true, align: 'center' });
  frame(ws, 3, 3, 5, 6, { align: 'center' });

  // 우측 결재란
  ws.mergeCells(3, 8, 5, 8);
  ws.getCell(3, 8).value = '조회서발송';
  const sign: [string, string][] = [['일  자', d(p.firstSentDate)], ['담  당', ''], ['서  명', '']];
  sign.forEach(([label, value], i) => {
    const r = 3 + i;
    ws.getCell(r, 9).value = label;
    ws.mergeCells(r, 10, r, 12);
    ws.getCell(r, 10).value = value;
  });
  frame(ws, 3, 8, 5, 9, { fill: FILL_HEADER, bold: true, align: 'center' });
  frame(ws, 3, 10, 5, 12, { align: 'center' });
  ws.getCell(3, 10).fill = FILL_INPUT; // 발송일은 기입칸(원본과 동일하게 노랑)

  // 2단 헤더 (7~8행)
  const single = ['No.', '구분', '금융기관명', '조회방식', '주소', '우편번호', '전화번호'];
  single.forEach((h, i) => {
    ws.mergeCells(7, i + 1, 8, i + 1);
    ws.getCell(7, i + 1).value = h;
  });
  ws.mergeCells(7, 8, 7, 10);
  ws.getCell(7, 8).value = '거래처 담당자';
  ['부서', '담당자명', '직책'].forEach((h, i) => { ws.getCell(8, 8 + i).value = h; });
  ['등기번호', '발송일', '회수', '반송사유', '발송대상'].forEach((h, i) => {
    ws.mergeCells(7, 11 + i, 8, 11 + i);
    ws.getCell(7, 11 + i).value = h;
  });
  frame(ws, 7, 1, 8, LAST, { fill: FILL_HEADER, bold: true, align: 'center', wrap: true });
  ws.getRow(7).height = 20;
  ws.getRow(8).height = 20;

  // 본문
  const START = 9;
  items.forEach((it, i) => {
    const r = START + i;
    const vals = [
      i + 1, it.kind, it.institution,
      it.isElectronic ? '전자조회' : '우편',
      it.isElectronic ? '전자조회' : it.address,
      it.isElectronic ? '' : it.postalCode,
      it.phone, it.dept, it.contactName, it.contactTitle,
      it.isElectronic ? '' : it.trackingNo,
      d(it.sentDate),
      it.collectStatus === '회수완료' ? 'O' : it.collectStatus === '반송' ? '반송' : '',
      it.returnReason,
      it.sent ? 1 : '',
    ];
    vals.forEach((v, c) => { ws.getCell(r, c + 1).value = v as string | number; });
  });
  const END = START + Math.max(items.length, 1) - 1;
  frame(ws, START, 1, END, LAST, { wrap: true });
  // 가운데 정렬 열: No.·구분·조회방식·우편번호·직책·발송일·회수·발송대상
  for (const c of [1, 2, 4, 6, 10, 12, 13, 15]) {
    for (let r = START; r <= END; r++) ws.getCell(r, c).alignment = { vertical: 'middle', horizontal: 'center' };
  }
  // 회수 열은 기입칸이라 노랑, 반송은 붉게
  for (let r = START; r <= END; r++) {
    ws.getCell(r, 13).fill = FILL_INPUT;
    if (ws.getCell(r, 13).value === '반송') {
      ws.getCell(r, 13).font = { ...FONT_BOLD, color: { argb: 'FFB91C1C' } };
      ws.getCell(r, 14).font = { ...FONT, color: { argb: 'FFB91C1C' } };
    }
  }

  // 합계행
  const SUM = END + 1;
  ws.getCell(SUM, 1).value = '합계';
  ws.mergeCells(SUM, 1, SUM, 2);
  ws.getCell(SUM, 13).value = p.collected;
  ws.getCell(SUM, 15).value = p.sent;
  frame(ws, SUM, 1, SUM, LAST, { fill: FILL_TOTAL, bold: true, align: 'center' });

  // 요약 2줄 (발송/회수 · 전자/실물 · 비율)
  const S1 = SUM + 2;
  const summary: [string, string, string, string][] = [
    ['발송', `전자 ${p.elecSent}/${p.elecTotal}`, `실물 ${p.postSent}/${p.postTotal}`, `합계 ${p.sent}/${p.total}  (${pct(p.sent, p.total)}%)`],
    ['회수', `전자 ${p.elecCollected}/${p.elecSent}`, `실물 ${p.postCollected}/${p.postSent}`, `합계 ${p.collected}/${p.sent}  (${pct(p.collected, p.sent)}%)${p.returned ? `   반송 ${p.returned}건` : ''}`],
  ];
  summary.forEach((row, i) => {
    const r = S1 + i;
    ws.getCell(r, 1).value = row[0];
    ws.mergeCells(r, 1, r, 2);
    ws.getCell(r, 3).value = row[1];
    ws.mergeCells(r, 3, r, 4);
    ws.getCell(r, 5).value = row[2];
    ws.mergeCells(r, 5, r, 6);
    ws.getCell(r, 7).value = row[3];
    ws.mergeCells(r, 7, r, 12);
    ws.getRow(r).height = 20;
  });
  frame(ws, S1, 1, S1 + 1, 2, { fill: FILL_HEADER, bold: true, align: 'center' });
  frame(ws, S1, 3, S1 + 1, 12, { align: 'center' });

  // 1·2차 회수율 확인 및 조치 (원본 꼬리말)
  let r = S1 + 3;
  for (const label of ['1차 회수율', '2차 회수율']) {
    ws.mergeCells(r, 2, r + 1, 2);
    ws.getCell(r, 2).value = `${label}\n확인및조치`;
    ['일  자', '담  당', '서  명'].forEach((t, i) => { ws.getCell(r + i, 3).value = t; });
    ws.mergeCells(r, 4, r, 6);
    ws.mergeCells(r + 1, 4, r + 1, 6);
    ws.mergeCells(r + 2, 4, r + 2, 6);
    ws.getCell(r, 7).value = '조치내용';
    ws.mergeCells(r, 7, r + 2, 12);
    frame(ws, r, 2, r + 2, 3, { fill: FILL_HEADER, bold: true, align: 'center', wrap: true });
    frame(ws, r, 4, r + 2, 6, { align: 'center' });
    frame(ws, r, 7, r + 2, 12, { align: 'left', wrap: true });
    ws.getCell(r, 7).alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
    r += 4;
  }

  setWidths(ws, [5, 11, 22, 10, 38, 8, 14, 10, 15, 8, 16, 11, 7, 26, 9]);
  setupPrint(ws, '7:8', 'O', r);
  ws.views = [{ state: 'frozen', ySplit: 8 }];

  await saveWorkbook(wb, `금융기관조회서_${conf.companyName}_${conf.fiscalYear}_진행현황.xlsx`);
}

// ── 연도 총괄 ───────────────────────────────────────────────
/** 연도 총괄 — 2025 파일의 '조회서 총괄시트'에 대응 */
export async function exportYearSummary(
  year: number,
  rows: { conf: Confirmation; progress: Progress }[],
): Promise<void> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('총괄');

  const head = [
    '거래처명', '조회서 구분', '조회처', '전자', '실물',
    '발송', '발송률(%)', '회수', '회수율(%)', '반송',
    '전자 발송/회수', '실물 발송/회수', '최초발송일', '최종발송일', '담당회계사', '기준일',
  ];
  const LAST = head.length;

  ws.mergeCells(1, 1, 1, LAST);
  ws.getCell(1, 1).value = `${year} 회계연도 금융기관조회서 총괄`;
  ws.getCell(1, 1).font = FONT_TITLE;
  ws.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 28;

  const H = 3;
  head.forEach((h, i) => { ws.getCell(H, i + 1).value = h; });
  frame(ws, H, 1, H, LAST, { fill: FILL_HEADER, bold: true, align: 'center', wrap: true });
  ws.getRow(H).height = 24;

  rows.forEach(({ conf: c, progress: p }, i) => {
    const r = H + 1 + i;
    const vals = [
      c.companyName, '금융기관조회서', p.total, p.elecTotal, p.postTotal,
      p.sent, pct(p.sent, p.total), p.collected, pct(p.collected, p.sent), p.returned,
      `${p.elecSent}/${p.elecCollected}`, `${p.postSent}/${p.postCollected}`,
      d(p.firstSentDate), d(p.lastSentDate), c.accountantName, d(c.baseDate),
    ];
    vals.forEach((v, cc) => { ws.getCell(r, cc + 1).value = v as string | number; });
  });
  const END = H + Math.max(rows.length, 1);
  frame(ws, H + 1, 1, END, LAST);
  for (let cc = 2; cc <= LAST; cc++) {
    for (let r = H + 1; r <= END; r++) ws.getCell(r, cc).alignment = { vertical: 'middle', horizontal: 'center' };
  }
  // 회수율 100% 미만은 눈에 띄게
  for (let r = H + 1; r <= END; r++) {
    const v = ws.getCell(r, 9).value;
    if (typeof v === 'number' && v < 100) ws.getCell(r, 9).font = { ...FONT_BOLD, color: { argb: 'FFB91C1C' } };
    const ret = ws.getCell(r, 10).value;
    if (typeof ret === 'number' && ret > 0) ws.getCell(r, 10).font = { ...FONT_BOLD, color: { argb: 'FFB91C1C' } };
  }

  // 합계
  const t = rows.reduce(
    (a, { progress: p }) => {
      a.total += p.total; a.elec += p.elecTotal; a.post += p.postTotal;
      a.sent += p.sent; a.collected += p.collected; a.returned += p.returned;
      a.elecSent += p.elecSent; a.elecCol += p.elecCollected;
      a.postSent += p.postSent; a.postCol += p.postCollected;
      return a;
    },
    { total: 0, elec: 0, post: 0, sent: 0, collected: 0, returned: 0, elecSent: 0, elecCol: 0, postSent: 0, postCol: 0 },
  );
  const SUM = END + 1;
  [
    '합계', '', t.total, t.elec, t.post, t.sent, pct(t.sent, t.total), t.collected, pct(t.collected, t.sent), t.returned,
    `${t.elecSent}/${t.elecCol}`, `${t.postSent}/${t.postCol}`,
  ].forEach((v, i) => { ws.getCell(SUM, i + 1).value = v as string | number; });
  frame(ws, SUM, 1, SUM, LAST, { fill: FILL_TOTAL, bold: true, align: 'center' });
  ws.getCell(SUM, 1).alignment = { vertical: 'middle', horizontal: 'left' };

  setWidths(ws, [26, 14, 8, 7, 7, 8, 10, 8, 10, 7, 14, 14, 12, 12, 12, 12]);
  setupPrint(ws, `${H}:${H}`, 'P', SUM);
  ws.views = [{ state: 'frozen', ySplit: H }];

  await saveWorkbook(wb, `금융기관조회서_총괄_${year}.xlsx`);
}

// ── 업로드 파싱 (읽기는 SheetJS 로 충분) ────────────────────
export interface ParseResult {
  items: ItemInput[];
  /** 무시했거나 고쳐 읽은 행 안내 — 사용자에게 그대로 보여준다 */
  warnings: string[];
}

/** 헤더 행을 찾는다. '금융기관명' 열(옛 양식은 '거래처명' 칸에 금융기관을 적었으므로 이것도 허용)이 있으면 읽는다. */
function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? '').replace(/\s/g, ''));
    if (cells.some((c) => c === '금융기관명' || c === '거래처명') && cells.some((c) => c === '구분')) return i;
  }
  return -1;
}

const norm = (v: unknown) => String(v ?? '').trim();

/** 조서 꼬리말(1차/2차 회수율 확인란) — 여기서부터는 조회처 명세가 아니다. */
const FOOTER = ['1차회수율', '2차회수율', '확인및조치', '합계', '일자', '담당', '서명', '발송', '회수'];
function isFooterRow(first: string, kindRaw: string, institution: string): boolean {
  const strip = (v: string) => v.replace(/\s/g, '');
  // 합계·발송·회수 같은 꼬리말 라벨은 보통 첫 열에 있다.
  return [first, kindRaw, institution].map(strip).some((v) => FOOTER.includes(v));
}

/** 구분 값 보정 — 2025 파일의 '증권회사·보험회사·여신전문금융회사·비은행금융회사' 표기를 흡수 */
function normalizeKind(raw: string): ItemKind | null {
  const s = raw.replace(/\s/g, '');
  if (!s) return null;
  if ((ITEM_KINDS as readonly string[]).includes(s)) return s as ItemKind;
  if (s.startsWith('은행')) return '은행';
  if (s.startsWith('증권')) return '증권';
  if (s.startsWith('보증')) return '보증기관';
  if (s.startsWith('여신')) return '여신전문';
  if (s.startsWith('비은행')) return '비은행금융';
  if (s.startsWith('보험')) return '보험';
  return null;
}

/** 업로드 파일 → 조회처 명세. 첫 시트만 읽는다. */
export async function parseItemsFile(file: File): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('시트를 읽을 수 없습니다.');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });

  const h = findHeaderRow(rows);
  if (h < 0) {
    throw new Error("양식을 알아볼 수 없습니다. '구분'과 '금융기관명' 열이 있는 양식을 올려 주세요.");
  }
  const head = (rows[h] || []).map((c) => String(c ?? '').replace(/\s/g, ''));
  const col = (...names: string[]) => head.findIndex((c) => names.includes(c));

  const cKind = col('구분');
  // '금융기관명'을 최우선으로 찾는다. '거래처'는 이 시스템에서 '감사대상 회사'를 뜻하므로
  // 금융기관 열로 오인하면 안 된다. 옛 control sheet 가 금융기관을 '거래처명' 칸에 적어둔 경우에만
  // (금융기관명 열이 아예 없을 때) 그 열을 대신 읽는다.
  const cInstitution = col('금융기관명');
  const cLegacyName = col('거래처명');
  const cName = cInstitution >= 0 ? cInstitution : cLegacyName;
  const usedLegacyName = cInstitution < 0 && cLegacyName >= 0;
  const cWay = col('조회방식');
  const cAddr = col('주소');
  const cPost = col('우편번호');
  const cPhone = col('전화번호');
  const cDept = col('부서');
  const cPerson = col('담당자명', '담당자');
  const cTitle = col('직책');
  const cNote = col('비고', '특이사항');

  const items: ItemInput[] = [];
  const warnings: string[] = [];
  // 표기 정리는 행마다 알리면 시끄러우므로 매핑별로 묶어서 한 줄로 알린다.
  const fixed = new Map<string, number>();

  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const institution = norm(r[cName]);
    if (!institution) continue; // 빈 행(양식의 여유 행)은 조용히 건너뛴다
    if (institution.startsWith('（예시）') || institution.startsWith('(예시)')) continue; // 빈 양식의 예시행
    const kindRaw = norm(r[cKind]);
    if (isFooterRow(norm(r[0]), kindRaw, institution)) break; // 조서 꼬리말(회수율 확인란)부터는 명세가 아니다
    const kind = normalizeKind(kindRaw);
    if (!kind) {
      warnings.push(`${i + 1}행 '${institution}' — 구분('${kindRaw}')을 알 수 없어 건너뜀`);
      continue;
    }
    if (kindRaw.replace(/\s/g, '') !== kind) {
      const key = `'${kindRaw}' → '${kind}'`;
      fixed.set(key, (fixed.get(key) ?? 0) + 1);
    }

    const addr = cAddr >= 0 ? norm(r[cAddr]) : '';
    const way = cWay >= 0 ? norm(r[cWay]) : '';
    // 조회방식 열이 없던 2025 양식은 주소칸에 '전자조회'라고 적어 구분했다. 둘 다 인식한다.
    const isElectronic = way.replace(/\s/g, '') === '전자조회' || addr.replace(/\s/g, '') === '전자조회';

    items.push({
      seq: items.length + 1,
      kind,
      institution,
      isElectronic,
      address: isElectronic ? '' : addr,
      postalCode: isElectronic || cPost < 0 ? '' : norm(r[cPost]),
      phone: cPhone >= 0 ? norm(r[cPhone]) : '',
      dept: cDept >= 0 ? norm(r[cDept]) : '',
      contactName: (cPerson >= 0 ? norm(r[cPerson]) : '') || DEFAULT_CONTACT,
      contactTitle: cTitle >= 0 ? norm(r[cTitle]) : '',
      note: cNote >= 0 ? norm(r[cNote]) : '',
    });
  }

  if (!items.length) throw new Error('읽어들일 조회처가 없습니다. 금융기관명이 채워진 행이 있는지 확인해 주세요.');
  // 표기 정리는 묶음 안내를 앞에 둔다(개별 문제 행보다 덜 급한 정보라서).
  const summaryMsg = [...fixed.entries()].map(([k, n]) => `구분 표기 정리 ${k} ${n}건`);
  const legacy = usedLegacyName
    ? ['옛 양식의 ‘거래처명’ 칸을 금융기관명으로 읽었습니다(이 시스템에서 거래처는 감사대상 회사를 뜻합니다).']
    : [];
  return { items, warnings: [...legacy, ...summaryMsg, ...warnings] };
}
