// 기장배분 — 엑셀 내려받기. 원본 「3. 기장_세무배분안」처럼 **수식이 살아 있게**(변수·금액을 고치면 다시 계산된다).
// 숫자 칸은 앱 값, 비율·배분·정산·요약은 전부 수식.
import { FONT, FONT_BOLD, FONT_TITLE, FILL_HEADER, FILL_TOTAL, FILL_INPUT, BORDER_ALL, setWidths, saveWorkbook } from './confirmExcelStyle';
import { CPAS, COST_ITEMS, type SettleBundle } from './bkSettle';
import type { ClientRow } from './bkLedger';
import { fyRange, periodLabel } from './expenseParse';

async function loadExcelJS() {
  const mod = await import('exceljs');
  const ns = (mod as unknown as { default?: unknown }).default ?? mod;
  return ns as typeof import('exceljs');
}
const NUM = '#,##0';
const PCT = '0.000%';

export function settleFileName(fy: number, status: string, today = new Date()) {
  const { from, to } = fyRange(fy);
  const d = `${String(today.getFullYear()).slice(2)}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  return `기장배분안_${from.replace(/-/g, '')}~${to.replace(/-/g, '')}_${status}_${d}.xlsx`;
}

export async function buildSettleWorkbook(b: SettleBundle, clients: ClientRow[] = []) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('기장_세무배분안');
  // ── 거래처별(원본 「기장24」 시트처럼) — 회계사별 수임료·미수금 칸이 이 시트를 SUMIFS 로 더한다 ──
  const CS = '거래처별';
  const cs = clients.length ? wb.addWorksheet(CS) : null;
  let cLast = 3;
  if (cs) {
    cs.getCell('A1').value = `거래처별 입금 · 미수금 · ${periodLabel(b.settle.fy)} (ERP 기간 미수금대장 · 부서별원장)`;
    cs.getCell('A1').font = FONT_TITLE;
    const hc = ['부서', 'ERP 코드', '거래처', '담당', '세무조정 구분', '입금(VAT 포함)', '기장', '그중 자문', '세무조정', '감사·용역', '대손(VAT 포함)', '기초 미수금(VAT 제외)', '기말 미수금(VAT 제외)', 'ERP 회계사', '자료', '메모'];
    hc.forEach((h, i) => { const c = cs.getRow(3).getCell(i + 1); c.value = h; c.font = FONT_BOLD; c.fill = FILL_HEADER; c.border = BORDER_ALL; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
    let rr = 4;
    const sorted = [...clients].filter((r) => r.cash || r.cash_bk || r.cash_tax || r.writeoff || r.ar_open || r.ar_close)
      .sort((x, y) => x.dept.localeCompare(y.dept, 'ko') || (x.cpa ?? '힣').localeCompare(y.cpa ?? '힣', 'ko') || x.name.localeCompare(y.name, 'ko'));
    for (const r of sorted) {
      const row = cs.getRow(rr);
      row.values = [r.dept, r.code.startsWith('N:') ? '' : r.code, r.name, r.cpa ?? '(없음)', r.cash_tax || r.billed_tax ? r.tax_mode : '', r.cash, r.cash_bk, r.cash_adv, r.cash_tax, r.cash_other, r.writeoff, Math.round(r.ar_open ?? 0), Math.round(r.ar_close ?? 0), r.erp_cpa ?? '', r.source ?? '', r.memo ?? ''];
      for (let i = 1; i <= hc.length; i++) { const c = row.getCell(i); c.font = FONT; c.border = BORDER_ALL; if (i >= 6 && i <= 13) c.numFmt = NUM; }
      if (!r.cpa) for (let i = 1; i <= hc.length; i++) row.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE2E2' } };
      rr++;
    }
    cLast = rr - 1;
    const tr = cs.getRow(rr);
    tr.getCell(3).value = '합계';
    for (let i = 6; i <= 13; i++) { const col = String.fromCharCode(64 + i); tr.getCell(i).value = { formula: `SUM(${col}4:${col}${cLast})` }; tr.getCell(i).numFmt = NUM; }
    for (let i = 1; i <= hc.length; i++) { const c = tr.getCell(i); c.font = FONT_BOLD; c.fill = FILL_TOTAL; c.border = BORDER_ALL; }
    cs.getCell(`A${rr + 2}`).value = '담당이 「(없음)」인 줄(분홍)은 회계사별 합계에 들어가지 않습니다. 세무조정 구분: 기장수행 = 비율에 듦, 자가 = 정산(회수금액)에만.';
    cs.getCell(`A${rr + 2}`).font = FONT;
    setWidths(cs, [8, 9, 30, 8, 10, 14, 13, 12, 13, 13, 11, 14, 14, 9, 11, 26]);
    cs.views = [{ state: 'frozen', ySplit: 3 }];
    cs.autoFilter = { from: 'A3', to: `P${cLast}` };
  }
  // 회계사별 칸을 거래처별 시트의 합으로 — 그 칸이 거래처 자료로 채워진 경우만(사람이 직접 고친 칸은 값 그대로).
  const R = (col: string) => `'${CS}'!$${col}$4:$${col}$${cLast}`;
  const viaClients = (k: string, name: string, src?: string): { formula: string } | null => {
    if (!cs || !src || !/^ERP/.test(src)) return null;
    const byCpa = `${R('D')},"${name}"`;
    switch (k) {
      case 'bk_fee': return { formula: `SUMIFS(${R('G')},${byCpa})` };
      case 'advisory_excl': return { formula: `SUMIFS(${R('H')},${byCpa})` };
      case 'tax_bk': return { formula: `SUMIFS(${R('I')},${byCpa},${R('E')},"기장수행")` };
      case 'tax_self': return { formula: `SUMIFS(${R('I')},${byCpa},${R('E')},"자가")` };
      case 'writeoff': return { formula: `ROUND(SUMIFS(${R('K')},${byCpa},${R('A')},"기장팀")/1.1,0)` };
      case 'ar_open': return { formula: `SUMIFS(${R('L')},${byCpa},${R('A')},"기장팀")` };
      case 'ar_close': return { formula: `SUMIFS(${R('M')},${byCpa},${R('A')},"기장팀")` };
      default: return null;
    }
  };
  const cell = (ref: string, v: unknown, o: { bold?: boolean; fmt?: string; fill?: 'h' | 't' | 'i'; box?: boolean } = {}) => {
    const c = ws.getCell(ref);
    c.value = v as never;
    c.font = o.bold ? FONT_BOLD : FONT;
    if (o.fmt) c.numFmt = o.fmt;
    if (o.fill) c.fill = o.fill === 'h' ? FILL_HEADER : o.fill === 't' ? FILL_TOTAL : FILL_INPUT;
    if (o.box !== false) c.border = BORDER_ALL;
    return c;
  };
  const f = (formula: string) => ({ formula });

  ws.getCell('B1').value = `기장 배분안 · ${periodLabel(b.settle.fy)} · ${b.settle.status}`;
  ws.getCell('B1').font = FONT_TITLE;
  cell('B3', '정액부담금(1인)', { fill: 'h' }); cell('C3', b.settle.fixed_share, { fmt: NUM, fill: 'i' });
  cell('B4', '공통비율', { fill: 'h' }); cell('C4', b.settle.common_rate, { fmt: '0.0%', fill: 'i' });
  ws.getCell('E3').value = clients.length ? '노란 칸을 고치면 아래가 다시 계산됩니다. 흰 수임료 칸은 「거래처별」 시트의 합(SUMIFS)입니다 — 그 시트의 담당·구분을 바꾸면 따라 바뀝니다. 미수금·대손은 VAT 제외, 입금은 VAT 포함.' : '노란 칸을 고치면 아래가 다시 계산됩니다. 미수금·대손은 VAT 제외, 입금은 VAT 포함.';
  ws.getCell('E3').font = FONT;

  // ── 비용 ──
  let r = 6;
  cell(`B${r}`, '<기장팀 비용> 현금주의', { bold: true, box: false });
  r++;
  ['항목', '직원', '금액', '상태', '출처', '메모'].forEach((h, i) => cell(`${'BCDEFG'[i]}${r}`, h, { bold: true, fill: 'h' }));
  r++;
  const costFirst = r;
  const order = (it: string) => COST_ITEMS.findIndex((x) => x.key === it);
  for (const c of [...b.costs].sort((x, y) => order(x.item) - order(y.item) || x.staff.localeCompare(y.staff, 'ko'))) {
    cell(`B${r}`, c.item); cell(`C${r}`, c.staff); cell(`D${r}`, c.amount, { fmt: NUM, fill: 'i' });
    cell(`E${r}`, c.state); cell(`F${r}`, c.source ?? ''); cell(`G${r}`, c.memo ?? '');
    r++;
  }
  const costLast = r - 1;
  cell(`B${r}`, '합계', { bold: true, fill: 't' }); cell(`C${r}`, '', { fill: 't' });
  cell(`D${r}`, f(`SUM(D${costFirst}:D${costLast})`), { bold: true, fmt: NUM, fill: 't' });
  const costTot = `D${r}`;
  r += 3;

  // ── 수임료·비율 ──
  cell(`B${r}`, '<수임료 · 비율>  비율바탕 = (기장료 + 기장수행 세무조정 − 자문) ÷ 1.1 + 미수금 변동', { bold: true, box: false });
  r++;
  const hdr = ['성명', '기장료 입금', '기장수행 세무조정', '자가 세무조정', '안분미대상 자문', '기초 미수금', '기말 미수금', '당기 대손', '미수금 변동', '비율바탕', '비율'];
  hdr.forEach((h, i) => cell(`${'BCDEFGHIJKL'[i]}${r}`, h, { bold: true, fill: 'h' }));
  r++;
  const cpaFirst = r;
  for (const name of CPAS) {
    const x = b.cpas.find((c) => c.cpa === name);
    cell(`B${r}`, name);
    (['bk_fee', 'tax_bk', 'tax_self', 'advisory_excl', 'ar_open', 'ar_close', 'writeoff'] as const).forEach((k, i) => {
      const fml = viaClients(k, name, x?.sources[k]);
      cell(`${'CDEFGHI'[i]}${r}`, fml ?? x?.[k] ?? 0, { fmt: NUM, fill: fml ? undefined : 'i' });
    });
    cell(`J${r}`, f(`H${r}-G${r}+I${r}`), { fmt: NUM });
    cell(`K${r}`, f(`(C${r}+D${r}-F${r})/1.1+J${r}`), { fmt: NUM });
    r++;
  }
  const cpaLast = r - 1;
  cell(`B${r}`, '합계', { bold: true, fill: 't' });
  for (const col of 'CDEFGHIJK') cell(`${col}${r}`, f(`SUM(${col}${cpaFirst}:${col}${cpaLast})`), { bold: true, fmt: NUM, fill: 't' });
  const baseTot = `K${r}`;
  for (let i = cpaFirst; i <= cpaLast; i++) cell(`L${i}`, f(`IF(${baseTot}=0,0,K${i}/${baseTot})`), { fmt: PCT });
  cell(`L${r}`, f(`SUM(L${cpaFirst}:L${cpaLast})`), { bold: true, fmt: PCT, fill: 't' });
  r += 3;

  // ── 배분 · 정산 ──
  cell(`B${r}`, '<배분 · 정산>', { bold: true, box: false });
  r++;
  cell(`B${r}`, '기장 부담금(비용 합계)', { fill: 'h' }); cell(`C${r}`, f(costTot), { fmt: NUM });
  cell(`D${r}`, '정액부담금 합계', { fill: 'h' }); cell(`E${r}`, f(`C3*${CPAS.length}`), { fmt: NUM });
  cell(`F${r}`, '안분대상', { fill: 'h' }); cell(`G${r}`, f(`C${r}-E${r}`), { fmt: NUM, bold: true });
  const alloc = `G${r}`;
  r += 2;
  const h2 = ['성명', '회수금액(VAT 포함)', '부가세', '매출금액', '공통비', '배분대상', '정액부담금', '비율부담금', '받을 금액'];
  h2.forEach((h, i) => cell(`${'BCDEFGHIJ'[i]}${r}`, h, { bold: true, fill: 'h' }));
  r++;
  const setFirst = r;
  CPAS.forEach((name, i) => {
    const src = cpaFirst + i;
    cell(`B${r}`, name);
    cell(`C${r}`, f(`C${src}+D${src}+E${src}`), { fmt: NUM });
    cell(`D${r}`, f(`ROUND(C${r}*0.1/1.1,0)`), { fmt: NUM });
    cell(`E${r}`, f(`C${r}-D${r}`), { fmt: NUM });
    cell(`F${r}`, f(`TRUNC(E${r}*$C$4)`), { fmt: NUM });
    cell(`G${r}`, f(`E${r}-F${r}`), { fmt: NUM });
    cell(`H${r}`, f('$C$3'), { fmt: NUM });
    cell(`I${r}`, f(`${alloc.replace(/([A-Z]+)(\d+)/, '$$$1$$$2')}*L${src}`), { fmt: NUM });
    cell(`J${r}`, f(`G${r}-H${r}-I${r}`), { fmt: NUM, bold: true });
    r++;
  });
  cell(`B${r}`, '합계', { bold: true, fill: 't' });
  for (const col of 'CDEFGHIJ') cell(`${col}${r}`, f(`SUM(${col}${setFirst}:${col}${r - 1})`), { bold: true, fmt: NUM, fill: 't' });
  r += 3;

  // ── 요약 ──
  cell(`B${r}`, '<기장 사업 손익 요약>  수익 = 비율바탕, 공통비 = 수익 × 공통비율', { bold: true, box: false });
  r++;
  ['성명', '기장 관련 수익', '기장 관련 비용', '공통비', '최종수익'].forEach((h, i) => cell(`${'BCDEF'[i]}${r}`, h, { bold: true, fill: 'h' }));
  r++;
  const sumFirst = r;
  CPAS.forEach((name, i) => {
    cell(`B${r}`, name);
    cell(`C${r}`, f(`K${cpaFirst + i}`), { fmt: NUM });
    cell(`D${r}`, f(`H${setFirst + i}+I${setFirst + i}`), { fmt: NUM });
    cell(`E${r}`, f(`C${r}*$C$4`), { fmt: NUM });
    cell(`F${r}`, f(`C${r}-D${r}-E${r}`), { fmt: NUM, bold: true });
    r++;
  });
  cell(`B${r}`, '합계', { bold: true, fill: 't' });
  for (const col of 'CDEF') cell(`${col}${r}`, f(`SUM(${col}${sumFirst}:${col}${r - 1})`), { bold: true, fmt: NUM, fill: 't' });
  r += 2;
  for (const t of ['ㅇ 세무조정은 기장 업체는 기장 분담 세무조정으로 본다(거래처마다 기장수행 / 자가).',
    'ㅇ 원본 엑셀의 실수(미수금 한 칸 밀림 · VAT 섞임 · 자문을 한 사람만 뺌 · 옛 시트 참조)를 고친 셈입니다.',
    ...(b.settle.note ? [`ㅇ ${b.settle.note}`] : [])]) {
    ws.getCell(`B${r}`).value = t; ws.getCell(`B${r}`).font = FONT; r++;
  }
  setWidths(ws, [2, 24, 16, 16, 14, 30, 22, 14, 12, 14, 16, 10]);
  wb.calcProperties = { fullCalcOnLoad: true } as never;
  return wb;
}

export async function exportSettleXlsx(b: SettleBundle, clients: ClientRow[] = []) {
  await saveWorkbook(await buildSettleWorkbook(b, clients), settleFileName(b.settle.fy, b.settle.status));
}
