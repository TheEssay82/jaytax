// 감사업무관리 › Journal Entry 시스템 — 조서 엑셀(audit tool 업로드용, 사용자 2026-10-21).
//
// 틀: 우리 실물 조서 JETEST_조서_<회사>_FY2025(나래 · 세원, 같은 템플릿) + 표지는 IOC 실증절차 양식.
//   표지(JET) → 총괄 → 「번호_약칭」 시트들. 총괄의 조서번호(A01 · B01 …) · 수행여부 O / X *n(각주에 미수행 사유).
//   4_기초잔액검토의 기초재계산(G) · 차이(I), 5_일정금액이상의 중요성(E)은 **수식**으로 둔다(실물과 같이, 값을 고치면 다시 계산).
//   실물의 오류(10 · 11번 조서번호 B06 중복, 9 · 11번 머리 링크 빠짐, 날짜 글자, 다른 회사 잔존 데이터)는 생기지 않는다.
// 분개장 줄 자체는 넣지 않는다 — 조서에는 추출 목록 · 대사표만(원본은 회사 PBC 로 따로 보관).
import type { Cell, Worksheet, Workbook } from 'exceljs';
import { FONT, FONT_BOLD, FILL_HEADER, FILL_INPUT, BORDER_ALL, saveWorkbook } from './confirmExcelStyle';
import { SCENARIOS, benchThreshold, type CheckResult } from './jeChecks';
import type { JeJob, JeUpload, JePick } from './jeApi';

async function loadExcelJS() {
  const mod = await import('exceljs');
  const ns = (mod as unknown as { default?: unknown }).default ?? mod;
  return ns as typeof import('exceljs');
}
const ACC = '_-* #,##0_-;\\-* #,##0_-;_-* "-"_-;_-@_-';
const MYEONG = { name: 'HY신명조', size: 12 };
const thin = { style: 'thin' as const }, medium = { style: 'medium' as const };
const FILL_GROUP = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFDDEBF7' } };
const FILL_DONE_TAB = { argb: 'FF00B050' };

export interface ExportInput {
  companyName: string;
  fy: number;
  periodFrom: string;
  periodTo: string;
  job: JeJob;
  results: CheckResult[];
  uploads: JeUpload[];
  picks: JePick[];
  /** 분개장 필드 목록(1_데이터유효성) */ fields: string[];
}

export function jeFileName(company: string, fy: number, today = new Date()) {
  const d = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  return `JETEST_조서_${company.replace(/[\\/:*?"<>|()（）㈜]/g, '').replace(/^주식회사\s*|\s*주식회사$/g, '').trim()}_FY${fy}_${d}.xlsx`;
}

/** 이 시나리오를 수행했는가(켜져 있고 자료가 있음). */
export const performed = (job: JeJob, r: CheckResult) => !!job.scenarios[r.code as keyof JeJob['scenarios']]?.on && r.status !== '자료없음';

const put = (ws: Worksheet, addr: string, v: unknown, o: { bold?: boolean; size?: number; fmt?: string; fill?: boolean; wrap?: boolean; align?: 'left' | 'center' | 'right'; color?: string } = {}): Cell => {
  const c = ws.getCell(addr);
  c.value = v as Cell['value'];
  c.font = { ...(o.bold ? FONT_BOLD : FONT), ...(o.size ? { size: o.size } : {}), ...(o.color ? { color: { argb: o.color } } : {}) };
  if (o.fmt) c.numFmt = o.fmt;
  if (o.fill) c.fill = FILL_INPUT;
  c.alignment = { vertical: 'middle', wrapText: o.wrap, horizontal: o.align };
  return c;
};

function table(ws: Worksheet, top: number, left: number, head: string[], rows: (string | number | null)[][], numCols: Set<number> = new Set()): number {
  head.forEach((h, i) => { const c = ws.getCell(top, left + i); c.value = h; c.font = FONT_BOLD; c.fill = FILL_HEADER; c.border = BORDER_ALL; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  rows.forEach((r, ri) => r.forEach((v, ci) => {
    const c = ws.getCell(top + 1 + ri, left + ci);
    c.value = v as Cell['value']; c.font = FONT; c.border = BORDER_ALL;
    if (typeof v === 'number' || numCols.has(ci)) c.numFmt = ACC;
    c.alignment = { vertical: 'middle' };
  }));
  return top + rows.length;
}

function sheetHead(ws: Worksheet, r: CheckResult, inp: ExportInput) {
  ws.getCell('A1').value = { formula: `총괄!B${15 + r.no}`, result: r.no } as Cell['value'];
  ws.getCell('B1').value = { formula: `총괄!C${15 + r.no}`, result: r.title } as Cell['value'];
  ws.getCell('A1').font = FONT_BOLD; ws.getCell('B1').font = { ...FONT_BOLD, size: 12 };
  put(ws, 'F1', `회사명: ${inp.companyName}`); put(ws, 'F2', `결산일: ${inp.periodTo}`); put(ws, 'H1', `조서번호: ${r.code}`, { bold: true });
}

function writeScenario(wb: Workbook, r: CheckResult, inp: ExportInput) {
  const ws = wb.addWorksheet(r.sheet, { views: [{ showGridLines: false }] });
  if (performed(inp.job, r)) ws.properties.tabColor = FILL_DONE_TAB;
  ws.columns = [{ width: 4 }, { width: 13 }, { width: 14 }, { width: 30 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 30 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];
  sheetHead(ws, r, inp);
  const st = inp.job.scenarios[r.code as keyof JeJob['scenarios']];
  let row = 3;
  put(ws, `A${row}`, `${r.no}.1 방법`, { bold: true }); row++;
  for (const m of r.method) { put(ws, `B${row}`, m); row++; }
  row++;
  put(ws, `A${row}`, `${r.no}.2 결과`, { bold: true }); row++;
  const concl = st?.conclusion?.trim() || (performed(inp.job, r) ? r.summary : `수행하지 않음 — ${st?.reason || r.summary}`);
  for (const line of concl.split('\n')) { put(ws, `B${row}`, line, { color: 'FF1F3864' }); row++; }
  row++;

  if (r.code === 'A01') {
    put(ws, `B${row}`, '수령자료 및 재요청 경과', { bold: true }); row++;
    const ups = [...inp.uploads].sort((a, b) => a.kind.localeCompare(b.kind) || a.version - b.version);
    row = table(ws, row, 2, ['구분', '판', '파일명', '필드수', 'Record수', '전표수', '기간', '받은 날', '비고'], ups.map((u) => [
      u.kind === 'journal' ? '분개장' : '잔액표', `${u.version}차${u.current ? '(사용)' : ''}`, u.fileName, u.kind === 'journal' ? inp.fields.length : 6, u.lines, u.kind === 'journal' ? u.vouchers : null,
      u.dateFrom ? `${u.dateFrom} ~ ${u.dateTo}` : '', u.createdAt.slice(0, 10), u.note ?? '',
    ])) + 2;
    put(ws, `B${row}`, '전표관련 Field', { bold: true }); row++;
    row = table(ws, row, 2, ['No', 'FieldName', '필수'], inp.fields.map((f, i) => [i + 1, f, /일자|번호|계정|금액|차변|대변/.test(f) ? 'O' : ''])) + 2;
  }

  if (r.code === 'A04') { writeOpening(ws, r, row); return ws; }
  if (r.code === 'B01') { writeMateriality(ws, r, row, inp); return ws; }

  if (r.rows.length) {
    const max = 3000;
    table(ws, row, 2, r.head, r.rows.slice(0, max));
    if (r.rows.length > max) put(ws, `B${row + max + 2}`, `… 이하 ${r.rows.length - max}줄 생략(JAYTAX 화면에서 전체 확인)`);
  }
  ws.pageSetup = { paperSize: 9, orientation: r.head.length > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return ws;
}

/** 4_기초잔액검토 — 실물 17행 머리. G = F − D + E(차변 계정) / F + D − E(대변 계정), I = G − H. 묶음은 연한 파랑 + 굵은 테두리. */
function writeOpening(ws: Worksheet, r: CheckResult, top: number) {
  put(ws, `B${top}`, '계정별합산내역', { bold: true });
  put(ws, `C${top}`, '※ 노란 칸(F 회사제시기말 · H 회사제시기초)은 회사 제시 재무제표 금액. 같은 묶음끼리 차이 합이 0이면 공시과목 나눔 · 재분류로 상쇄된 것', { color: 'FF7F7F7F' });
  const h = top + 1;
  const head = ['묶음', '계정코드', '계정명', '차변합계', '대변합계', '회사제시기말잔액', '기초재계산금액', '회사제시 기초잔액', '차이금액', '잔액방향'];
  head.forEach((t, i) => { const c = ws.getCell(h, 1 + i); c.value = t; c.font = FONT_BOLD; c.fill = FILL_HEADER; c.border = BORDER_ALL; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  const groups = new Map<string, number[]>();
  r.rows.forEach((row, i) => {
    const rr = h + 1 + i;
    const [grp, code, name, jdr, jcr, close, calc, open, diff] = row;
    const isDr = row[9] === '차';
    const vals: unknown[] = [grp || '', code, name, jdr, jcr, close,
      { formula: isDr ? `F${rr}-D${rr}+E${rr}` : `F${rr}+D${rr}-E${rr}`, result: calc }, open, { formula: `G${rr}-H${rr}`, result: diff }, isDr ? '차' : '대'];
    vals.forEach((v, ci) => {
      const c = ws.getCell(rr, 1 + ci); c.value = v as Cell['value']; c.font = FONT; c.border = BORDER_ALL;
      if (ci >= 3 && ci <= 8) c.numFmt = ACC;
      if (ci === 5 || ci === 7) c.fill = FILL_INPUT;
    });
    const g = String(grp || code);
    if (grp) groups.set(g, [...(groups.get(g) ?? []), rr]);
  });
  // 묶음: 연한 파랑 + 양옆 굵은 테두리(실물 표시 방식)
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    for (const rr of rows) {
      for (let c = 1; c <= 10; c++) { const cell = ws.getCell(rr, c); if (c !== 6 && c !== 8) cell.fill = FILL_GROUP; }
      ws.getCell(rr, 1).border = { ...BORDER_ALL, left: medium };
      ws.getCell(rr, 9).border = { ...BORDER_ALL, right: medium };
    }
    ws.getCell(rows[0], 9).border = { ...ws.getCell(rows[0], 9).border, top: medium };
    ws.getCell(rows[rows.length - 1], 9).border = { ...ws.getCell(rows[rows.length - 1], 9).border, bottom: medium };
  }
  const last = h + r.rows.length;
  const t = last + 1;
  put(ws, `C${t}`, '합계', { bold: true });
  for (const [k, col] of ['D', 'E', 'F', 'G', 'H', 'I'].entries()) { const c = ws.getCell(`${col}${t}`); c.value = { formula: `SUM(${col}${h + 1}:${col}${last})`, result: r.rows.reduce((s, x) => s + (Number(x[3 + k]) || 0), 0) } as Cell['value']; c.numFmt = ACC; c.font = FONT_BOLD; c.border = { top: thin, bottom: { style: 'double' } }; }
  ws.columns = [{ width: 10 }, { width: 10 }, { width: 34 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 15 }, { width: 8 }];
  ws.views = [{ state: 'frozen', ySplit: h, showGridLines: false }];
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${h}:${h}` };
}

/** 5_일정금액이상 — BENCHMARK 블록(E = ROUND(금액 × 적용률, 0)) + 추출 줄 + 검토 칸(REF · 결과 · 비고). */
function writeMateriality(ws: Worksheet, r: CheckResult, top: number, inp: ExportInput) {
  const b = inp.job.bench;
  let row = top;
  put(ws, `B${row}`, 'BENCHMARK', { bold: true }); put(ws, `D${row}`, b.name, { fill: true }); put(ws, `E${row}`, '사유'); put(ws, `F${row}`, b.reason || '', { wrap: false }); row += 2;
  put(ws, `B${row}`, 'BENCHMARK 금액', { bold: true }); put(ws, `E${row}`, Math.round(b.amount), { fmt: ACC, fill: true }); const amtRow = row; row += 2;
  put(ws, `B${row}`, '중요성 기준', { bold: true }); put(ws, `D${row}`, b.rate, { fmt: '0.0%', fill: true });
  const c = ws.getCell(`E${row}`); c.value = { formula: `ROUND(E${amtRow}*D${row},0)`, result: benchThreshold(b) } as Cell['value']; c.numFmt = ACC; c.font = FONT_BOLD;
  row += 2;
  const picks = new Map(inp.picks.map((p) => [`${p.vdate}|${p.vno}`, p]));
  const head = [...r.head, '검토(REF 조서)', '결과', '비고'];
  const rows = r.rows.map((x) => { const p = picks.get(`${x[0]}|${x[1]}`); return [...x, p?.evidence ?? '', p?.result ?? '', p?.note ?? '']; });
  table(ws, row, 1, head, rows);
  ws.columns = [{ width: 11 }, { width: 9 }, { width: 7 }, { width: 9 }, { width: 22 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 36 }, { width: 18 }, { width: 18 }, { width: 10 }, { width: 18 }];
  ws.views = [{ state: 'frozen', ySplit: row, showGridLines: false }];
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${row}:${row}` };
}

function writeCover(wb: Workbook, inp: ExportInput) {
  const ws = wb.addWorksheet('JET', { views: [{ showGridLines: false }] });
  ws.columns = [3.9, 9.6, 5.9, 2.2, 8.7, 7.7, 6.3, 6.6, 6.7, 12.7, 9.0].map((width) => ({ width }));
  const f = (a: string, v: unknown, o: { bold?: boolean; size?: number; align?: 'left' | 'center'; wrap?: boolean } = {}) => {
    const c = ws.getCell(a); c.value = v as Cell['value']; c.font = { ...MYEONG, ...(o.size ? { size: o.size } : {}), bold: o.bold }; c.alignment = { horizontal: o.align ?? 'left', vertical: 'middle', wrapText: o.wrap }; return c;
  };
  ws.mergeCells('A1:K1'); f('A1', '실 증 절 차', { bold: true, size: 15, align: 'center' });
  ws.mergeCells('A2:K3'); f('A2', '(JET. 분개 테스트 — Journal Entry Test)', { align: 'center' });
  const under = { bottom: thin };
  const job = inp.job;
  ([['A4:B4', '회 사 명', 'C4:E4', inp.companyName], ['A5:B5', '결 산 일', 'C5:E5', inp.periodTo]] as const).forEach(([l, lt, v, vt]) => { ws.mergeCells(l); f(l.split(':')[0], lt, { size: 11.5 }); ws.mergeCells(v); const c = f(v.split(':')[0], vt, { size: 11.5, align: 'center' }); c.border = under; });
  ([['F4', '작성자', 'G4:H4', job.preparer ?? '', 'I4', 'J4:K4', job.preparedOn ?? ''], ['F5', '검토자', 'G5:H5', job.reviewer ?? '', 'I5', 'J5:K5', job.reviewedOn ?? '']] as const).forEach(([a, at, b, bt, c2, d, dt]) => {
    f(a, at, { size: 11.5 }); ws.mergeCells(b); f(b.split(':')[0], bt, { size: 11.5, align: 'center' }).border = under;
    f(c2, '일 자', { size: 11.5 }); ws.mergeCells(d); f(d.split(':')[0], dt, { size: 11.5, align: 'center' }).border = under;
  });
  f('A6', '경영진 주장 :', { size: 11.5 });
  const claims = [['A', '정확성', 'C', '완전성', 'CO', '기간귀속'], ['E', '실재성', 'O', '발생사실', 'V', '평가'], ['RO', '권리와 의무', 'CL', '분류', 'P', '표시']];
  claims.forEach((r, i) => { f(`A${7 + i}`, `${r[0]} : ${r[1]}`, { size: 11 }); f(`E${7 + i}`, `${r[2]} : ${r[3]}`, { size: 11 }); f(`H${7 + i}`, `${r[4]} : ${r[5]}`, { size: 11 }); });
  ws.mergeCells('A11:K11'); f('A11', '※ 업무요령 : 감사기준 240 문단 32(경영진의 통제무력화 위험 대응)에 따라 분개와 기타 조정사항의 적정성을 검사한다. 비경상 · 부적합 분개에 대해 재무보고 관여자에게 질문하고, 보고기간말 분개를 추출하여 검사하며, 기간 전체 검사의 필요성을 고려한다.', { size: 11, wrap: true });
  ws.getRow(11).height = 60;
  ws.mergeCells('A13:K13'); f('A13', 'Part 1. 감사절차', { bold: true, size: 12 });
  ws.mergeCells('A14:I14'); f('A14', '감사절차', { bold: true, align: 'center', size: 11 }); f('J14', '경영진 주장', { bold: true, align: 'center', size: 11 }); f('K14', '조서번호', { bold: true, align: 'center', size: 11 });
  for (const a of ['A14', 'J14', 'K14']) ws.getCell(a).border = { top: medium, bottom: thin };
  const procs: [string, string, string][] = [
    ['1. 분개장 수령 및 완전성 검증', 'C, A', ''],
    ['   (1) 분개장의 필드 · 레코드 수를 확인하고 유효성(기간 · 차대 기재)을 검증한다.', '', 'A01'],
    ['   (2) 필수 필드의 빈값을 확인한다.', '', 'A02'],
    ['   (3) 전표별 차변 · 대변 합계의 일치를 확인한다.', '', 'A03'],
    ['   (4) 분개장 증감과 회사 제시 잔액으로 기초잔액을 역산하여 전기말 잔액과 대사한다.', '', 'A04'],
    ['2. 시나리오별 분개 추출 및 검토', 'E, O, CO', ''],
    ...SCENARIOS.filter((s) => s.kind === 'Option').map((s) => [`   (${s.no - 4}) ${s.title}`, '', s.code] as [string, string, string]),
    ['3. 결론', '', '총괄'],
  ];
  procs.forEach(([t, a, n], i) => { const rr = 15 + i; ws.mergeCells(`A${rr}:I${rr}`); f(`A${rr}`, t, { size: 11 }); f(`J${rr}`, a, { size: 11, align: 'center' }); f(`K${rr}`, n, { size: 11, align: 'center' }); });
  const end = 15 + procs.length;
  for (const a of ['A', 'J', 'K']) ws.getCell(`${a}${end - 1}`).border = { bottom: medium };
  ws.headerFooter = { oddFooter: '&R조서번호: &A(&P)' };
  ws.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

function writeSummary(wb: Workbook, inp: ExportInput) {
  const ws = wb.addWorksheet('총괄', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 2 }, { width: 8 }, { width: 34 }, { width: 30 }, { width: 30 }, { width: 12 }, { width: 10 }, { width: 12 }];
  const job = inp.job;
  put(ws, 'B2', `회사명: ${inp.companyName}`, { bold: true }); put(ws, 'B3', `작성자: ${job.preparer ?? ''}   검토자: ${job.reviewer ?? ''}`); put(ws, 'B4', `회계일: ${inp.periodTo}  (회계기간 ${inp.periodFrom} ~ ${inp.periodTo})`);
  put(ws, 'H2', 'Journal Entry Test', { bold: true, size: 12 }); put(ws, 'H3', job.preparedOn ?? '');
  put(ws, 'B6', '목적', { bold: true }); put(ws, 'C7', '재무제표의 완전성 및 정확성 검증'); put(ws, 'C8', '비정상적인 전표데이터 검토(경영진의 통제무력화 위험 대응, 감사기준 240 문단 32)');
  put(ws, 'B10', '회사담당자', { bold: true });
  table(ws, 11, 3, ['성명', '부서&직급', '전화번호', '메일주소'], (job.contacts.length ? job.contacts : [{ name: '', dept: '', phone: '', email: '' }]).map((c) => [c.name, c.dept, c.phone, c.email]));
  put(ws, 'B14', '시나리오', { bold: true });
  const notes: string[] = [];
  const head = ['No', '제목', '설명', '', '구분', '조서번호', '수행여부'];
  head.forEach((h, i) => { const c = ws.getCell(15, 2 + i); c.value = h; c.font = FONT_BOLD; c.fill = FILL_HEADER; c.border = BORDER_ALL; c.alignment = { horizontal: 'center', vertical: 'middle' }; });
  ws.mergeCells('D15:E15');
  inp.results.forEach((r, i) => {
    const rr = 16 + i;
    const st = job.scenarios[r.code as keyof JeJob['scenarios']];
    let done = performed(job, r) ? 'O' : 'X';
    if (done === 'X') { notes.push(st?.reason || r.summary); done = `X)*${notes.length}`; }
    const vals = [r.no, r.title, r.desc, '', r.kind, r.code, done];
    vals.forEach((v, ci) => { const c = ws.getCell(rr, 2 + ci); c.value = v; c.font = FONT; c.border = BORDER_ALL; c.alignment = { vertical: 'middle', wrapText: ci === 2, horizontal: ci >= 4 || ci === 0 ? 'center' : undefined }; });
    ws.mergeCells(`D${rr}:E${rr}`);
    ws.getRow(rr).height = 30;
  });
  let row = 16 + inp.results.length + 1;
  notes.forEach((n, i) => { put(ws, `B${row}`, `*${i + 1})`); put(ws, `C${row}`, n); row++; });
  row++;
  put(ws, `B${row}`, '회사시스템', { bold: true }); row++; put(ws, `C${row}`, `${job.erp} ERP`); row += 2;
  put(ws, `B${row}`, '분석방법', { bold: true }); row++; put(ws, `C${row}`, 'JAYTAX Journal Entry 시스템(분개장 전수 로드 · 규칙 기반 추출)'); row += 2;
  if (job.relaxed) { put(ws, `B${row}`, '완화된 절차', { bold: true }); row++; for (const l of (job.relaxedNote ?? '').split('\n')) { put(ws, `C${row}`, l); row++; } row++; }
  put(ws, `B${row}`, '결론', { bold: true }); row++;
  const exc = inp.results.filter((r) => performed(job, r) && r.status === '예외');
  put(ws, `C${row}`, exc.length ? `추출된 예외 · 검토 대상은 각 시나리오 조서에서 검토하였음(${exc.map((r) => r.code).join(', ')})` : '검토결과, 예외사항이 발견되지 아니함');
  if (job.memo) { row++; put(ws, `C${row}`, job.memo); }
  ws.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

export async function exportJeWorkbook(inp: ExportInput): Promise<void> {
  await saveWorkbook(await buildJeWorkbook(inp), jeFileName(inp.companyName, inp.fy));
}

/** 조서 워크북을 짓는다(내려받기와 시험이 같이 쓴다). */
export async function buildJeWorkbook(inp: ExportInput): Promise<Workbook> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'JAYTAX';
  wb.calcProperties = { fullCalcOnLoad: true };
  writeCover(wb, inp);
  writeSummary(wb, inp);
  for (const r of inp.results) {
    // 자료가 없어 못 한 것 · 끈 것은 총괄 각주로만(시트는 만들지 않는다). 필수는 늘 시트를 만든다.
    if (r.kind === 'Mandatory' || performed(inp.job, r)) writeScenario(wb, r, inp);
  }
  return wb;
}

