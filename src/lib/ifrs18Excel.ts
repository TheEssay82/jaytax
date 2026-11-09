// K-IFRS 1118 월결산 — 결과를 **엑셀 수식으로 다시 계산되는** 검증 파일로 내보낸다(사용자 2026-11-09
// 「산출물은 엑셀 내 검증 가능하게 다운로드」). 화면 숫자를 값으로 붙이지 않는다:
//   분개장손익(원천 줄, 값) → 시산표(SUMIFS 수식) → 손익계산서 · 브릿지 · 주석금액(SUMIFS 수식)
// 각 결과 옆에 「화면 계산값」(값)과 「차이」(수식)를 두어, 엑셀이 다시 센 숫자와 화면이 같은지 바로 보이게 한다.
//
// 색: 노랑 = 사람이 바꿀 수 있는 곳(없음 — 이 파일은 결과 보관용) · 파랑 글씨 = 원천 값 · 초록 글씨 = 다른 시트 참조 수식.
// ExcelJS 는 무거워 내보낼 때만 동적 로드한다.
import type { Worksheet } from 'exceljs';
import { FONT, FONT_BOLD, FILL_HEADER, FILL_TOTAL, BORDER_ALL, setWidths, saveWorkbook } from './confirmExcelStyle';
import { PL1118_ORDER, PL1001_ORDER, LINES_1118, isPl, type Ifrs18Config, type Ifrs18Result, type JLine, type Judgment } from './ifrs18';

async function loadExcelJS() {
  const mod = await import('exceljs');
  const ns = (mod as unknown as { default?: unknown }).default ?? mod;
  return ns as typeof import('exceljs');
}

const NUM = '#,##0;(#,##0);"-"';
const BLUE = { ...FONT, color: { argb: 'FF0000FF' } };
const GREEN = { ...FONT, color: { argb: 'FF008000' } };
const RED_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF8D7DA' } };

function header(ws: Worksheet, row: number, cols: string[]) {
  cols.forEach((h, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = h; c.font = FONT_BOLD; c.fill = FILL_HEADER; c.border = BORDER_ALL;
    c.alignment = { vertical: 'middle', wrapText: true };
  });
}
function title(ws: Worksheet, t: string, sub: string) {
  ws.getCell('A1').value = t; ws.getCell('A1').font = { ...FONT, size: 13, bold: true };
  ws.getCell('A2').value = sub; ws.getCell('A2').font = { ...FONT, size: 9, color: { argb: 'FF5B6573' } };
}
function cell(ws: Worksheet, r: number, c: number, v: unknown, font = FONT, fmt?: string) {
  const x = ws.getCell(r, c);
  x.value = v as never; x.font = font; x.border = BORDER_ALL;
  if (fmt) x.numFmt = fmt;
  return x;
}
const f = (formula: string) => ({ formula });

export interface Ifrs18ExportOpts { cfg: Ifrs18Config; res: Ifrs18Result; lines: JLine[]; judgments: Judgment[]; fileName: string; byName: string }

/** 파일 이름 — 「날짜_회사_K-IFRS1118_월결산_YYYYMM.xlsx」 (증빙 파일에 날짜를 넣는다). */
export function ifrs18FileName(o: Pick<Ifrs18ExportOpts, 'cfg' | 'res'>): string {
  const ym = `${o.res.year}${String(o.res.month).padStart(2, '0')}`;
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${today}_${o.cfg.clientKey}_K-IFRS1118_월결산_${ym}.xlsx`;
}

export async function exportIfrs18Workbook(opts: Ifrs18ExportOpts): Promise<void> {
  const wb = await buildIfrs18Workbook(opts);
  await saveWorkbook(wb, ifrs18FileName(opts));
}

/** 통합문서를 만든다(저장은 하지 않는다 — 시험에서 버퍼로 꺼내 본다). */
export async function buildIfrs18Workbook(opts: Ifrs18ExportOpts) {
  const { cfg, res, lines, judgments } = opts;
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'jaytax'; wb.created = new Date();
  const period = `${res.year}. 1. 1 ~ ${res.year}. ${res.month}. ${new Date(res.year, res.month, 0).getDate()}`;

  const wsG = wb.addWorksheet('0_안내');
  const wsP = wb.addWorksheet('1_손익계산서');
  const wsN = wb.addWorksheet('2_주석금액');
  const wsW = wb.addWorksheet('3_주의계정검토');
  const wsT = wb.addWorksheet('4_시산표');
  const wsA = wb.addWorksheet('5_조정');
  const wsJ = wb.addWorksheet('6_분개장손익');
  const wsR = wb.addWorksheet('7_계정판단표');

  // ── 6_분개장손익 — 원천(값). 손익 계정 줄만, 임시전표 제외 ──
  title(wsJ, '분개장 손익 계정 줄 (원천 · 값)', `SAP 분개장 「${opts.fileName}」에서 손익 계정 줄만(임시전표 제외). 4_시산표가 이 줄을 SUMIFS 로 다시 합한다.`);
  header(wsJ, 4, ['전표번호', '전기일', 'G/L', '계정명', '차변', '대변', '금액(차변+)', '라인텍스트', '거래처']);
  setWidths(wsJ, [13, 11, 11, 30, 15, 15, 15, 44, 26]);
  const pl = lines.filter((l) => !l.temp && isPl(l.gl));
  pl.forEach((l, i) => {
    const r = 5 + i;
    const row = wsJ.getRow(r);
    row.values = [l.docNo, l.date, l.gl, l.glName, l.dr, l.cr, null, l.memo, l.vendor];
    row.getCell(7).value = f(`E${r}-F${r}`);
    for (const c of [5, 6, 7]) row.getCell(c).numFmt = NUM;
  });
  const JE = 4 + Math.max(pl.length, 1);
  wsJ.views = [{ state: 'frozen', ySplit: 4 }];
  wsJ.autoFilter = `A4:I${JE}`;

  // ── 4_시산표 — 분개장 합계(수식) + 판단표 매핑(값) ──
  title(wsT, '시산표 = 분개장 손익 합계 (수식)', '금액은 6_분개장손익을 SUMIFS 로 다시 합한 값. 1001 항목 · 범주 · 1118 표시항목은 7_계정판단표의 판단(값).');
  header(wsT, 4, ['G/L', '계정명', '누적(차변+) = 분개장 합계', '1001 항목', '적용범주', '1118 표시항목', '주석 세부항목', '손익(수익+)', '화면 계산값(차변+)', '차이']);
  setWidths(wsT, [11, 32, 18, 11, 9, 22, 26, 16, 16, 10]);
  res.tb.forEach((t, i) => {
    const r = 5 + i;
    cell(wsT, r, 1, t.gl, BLUE); cell(wsT, r, 2, t.name, BLUE);
    cell(wsT, r, 3, f(`SUMIFS('6_분개장손익'!$G$5:$G$${JE},'6_분개장손익'!$C$5:$C$${JE},A${r})`), GREEN, NUM);
    cell(wsT, r, 4, t.l1001, BLUE); cell(wsT, r, 5, t.cat, BLUE); cell(wsT, r, 6, t.l1118, BLUE); cell(wsT, r, 7, t.detail, BLUE);
    cell(wsT, r, 8, f(`-C${r}`), FONT, NUM); cell(wsT, r, 9, t.amt, BLUE, NUM); cell(wsT, r, 10, f(`ROUND(C${r}-I${r},0)`), FONT, NUM);
  });
  const TE = 4 + Math.max(res.tb.length, 1);
  wsT.views = [{ state: 'frozen', ySplit: 4 }];
  wsT.autoFilter = `A4:J${TE}`;
  const T = (c: string) => `'4_시산표'!$${c}$5:$${c}$${TE}`;

  // ── 5_조정 — 계리 · 판단 · 수동(값) ──
  title(wsA, '조정 (원천 항목 → 대상 항목, 금액 차변+)', '같은 금액이 원천 항목에서 빠져 대상 항목에 들어간다 — 당기순이익은 바뀌지 않는다.');
  header(wsA, 4, ['구분', '내용', '원천 G/L', '원천 1118 항목', '대상 1118 항목', '금액(차변+)']);
  setWidths(wsA, [8, 60, 11, 18, 18, 16]);
  res.moves.forEach((m, i) => {
    const r = 5 + i;
    cell(wsA, r, 1, m.kind, BLUE); cell(wsA, r, 2, m.label, BLUE); cell(wsA, r, 3, m.srcGl, BLUE);
    cell(wsA, r, 4, m.src, BLUE); cell(wsA, r, 5, m.target, BLUE); cell(wsA, r, 6, m.amount, BLUE, NUM);
  });
  const AE = 4 + Math.max(res.moves.length, 1);
  const A = (c: string) => `'5_조정'!$${c}$5:$${c}$${AE}`;
  const lineF = (n: string) => `SUMIFS(${T('H')},${T('F')},"${n}")+SUMIFS(${A('F')},${A('D')},"${n}")-SUMIFS(${A('F')},${A('E')},"${n}")`;

  // ── 1_손익계산서 ──
  title(wsP, `${cfg.clientName} · K-IFRS 1118 손익계산서 (${period})`, '모두 수식. C열 = 엑셀이 다시 센 값 / D열 = 화면 계산값 / E열 = 차이(0이어야 함). 수익 + / 비용 −');
  header(wsP, 4, ['', '1118 적용 후', '금액(엑셀 수식)', '화면 계산값', '차이']);
  setWidths(wsP, [3, 40, 18, 18, 12, 40]);
  const pos: Record<string, number> = {};
  let r = 5;
  for (const o of PL1118_ORDER) { pos[o.key] = r; r++; }
  for (const o of PL1118_ORDER) {
    const rr = pos[o.key];
    cell(wsP, rr, 2, o.label, o.sub ? FONT_BOLD : FONT);
    let fx: string;
    if (o.key === '영업손익') fx = `SUM(C${pos['영업수익']}:C${pos['기타영업비용']})`;
    else if (o.key === '재무손익 및 법인세비용차감전손익') fx = `C${pos['영업손익']}+SUM(C${pos['종속기업·관계기업 관련 손익']}:C${pos['기타투자비용']})`;
    else if (o.key === '법인세비용차감전순손익') fx = `C${pos['재무손익 및 법인세비용차감전손익']}+C${pos['재무수익']}+C${pos['재무비용']}`;
    else if (o.key === '당기순손익') fx = `C${pos['법인세비용차감전순손익']}+C${pos['법인세비용']}`;
    else fx = lineF(o.key);
    cell(wsP, rr, 3, f(fx), o.sub ? FONT_BOLD : GREEN, NUM);
    cell(wsP, rr, 4, Math.round(res.pl1118[o.key] ?? 0), BLUE, NUM);
    cell(wsP, rr, 5, f(`ROUND(C${rr}-D${rr},0)`), FONT, NUM);
    if (o.sub) for (const c of [2, 3, 4, 5]) wsP.getCell(rr, c).fill = FILL_TOTAL;
  }
  r = pos['당기순손익'] + 2;
  header(wsP, r, ['', '1001 (현행)', '금액(엑셀 수식)', '화면 계산값', '차이']); r++;
  const p1: Record<string, number> = {};
  for (const o of PL1001_ORDER) { p1[o.key] = r; r++; }
  for (const o of PL1001_ORDER) {
    const rr = p1[o.key];
    cell(wsP, rr, 2, o.label, o.sub ? FONT_BOLD : FONT);
    let fx: string;
    if (o.key === '영업이익') fx = `C${p1['영업수익']}+C${p1['영업비용']}`;
    else if (o.key === '법인세비용차감전순이익') fx = `C${p1['영업이익']}+SUM(C${p1['기타수익']}:C${p1['금융비용']})+SUMIFS(${T('H')},${T('D')},"임시계정")`;
    else if (o.key === '당기순이익') fx = `C${p1['법인세비용차감전순이익']}+C${p1['법인세비용']}`;
    else fx = `SUMIFS(${T('H')},${T('D')},"${o.key}")`;
    cell(wsP, rr, 3, f(fx), o.sub ? FONT_BOLD : GREEN, NUM);
    const appV = o.key === '법인세비용차감전순이익' ? res.pl1001[o.key] + res.pl1001['임시계정'] : res.pl1001[o.key];
    cell(wsP, rr, 4, Math.round(appV ?? 0), BLUE, NUM);
    cell(wsP, rr, 5, f(`ROUND(C${rr}-D${rr},0)`), FONT, NUM);
    if (o.sub) for (const c of [2, 3, 4, 5]) wsP.getCell(rr, c).fill = FILL_TOTAL;
  }
  r += 1;
  header(wsP, r, ['', '영업손익 브릿지 (1001 영업이익 → 1118 영업손익)', '금액(엑셀 수식)', '화면 계산값', '차이', '설명']); r++;
  const sf = (l1001: string, cat: string) => `SUMIFS(${T('H')},${T('D')},"${l1001}",${T('E')},"${cat}")`;
  const opSum = LINES_1118.slice(0, 5).map((n) => `SUMIFS(${T('H')},${T('F')},"${n}")`).join('+');
  const bfx = [
    `C${p1['영업이익']}`,
    `-(${sf('영업비용', '투자')}+${sf('영업비용', '재무')}+${sf('영업비용', '법인세')})`,
    sf('기타수익', '영업'), sf('금융수익', '영업'), sf('기타비용', '영업'), sf('금융비용', '영업'),
    `C${pos['영업손익']}-(${opSum})`,
  ];
  const b0 = r;
  res.bridge.forEach((b, i) => {
    const rr = b0 + i;
    cell(wsP, rr, 2, b.label, i === 0 || i === res.bridge.length - 1 ? FONT_BOLD : FONT);
    cell(wsP, rr, 3, f(i < bfx.length ? bfx[i] : `SUM(C${b0}:C${rr - 1})`), GREEN, NUM);
    cell(wsP, rr, 4, Math.round(b.amount), BLUE, NUM);
    cell(wsP, rr, 5, f(`ROUND(C${rr}-D${rr},0)`), FONT, NUM);
    cell(wsP, rr, 6, b.note, { ...FONT, size: 9 });
  });
  r = b0 + res.bridge.length + 1;
  header(wsP, r, ['', '엑셀 재계산 검증', '결과']); r++;
  const vrows: [string, string][] = [
    ['시산표 = 화면(계정별 차이 0)', `SUMPRODUCT(ABS(${T('J')}))=0`],
    ['1118 손익계산서 = 화면', `SUMPRODUCT(ABS(E${pos['영업수익']}:E${pos['당기순손익']}))=0`],
    ['당기순이익 1001 = 1118', `ROUND(C${p1['당기순이익']}-C${pos['당기순손익']},0)=0`],
    ['브릿지 = 1118 영업손익', `ROUND(C${b0 + res.bridge.length - 1}-C${pos['영업손익']},0)=0`],
  ];
  for (const [lab, fx] of vrows) {
    cell(wsP, r, 2, lab); const c = cell(wsP, r, 3, f(`IF(${fx},"✔","✘")`), GREEN);
    c.alignment = { horizontal: 'center' }; r++;
  }
  wsP.addConditionalFormatting({ ref: `E5:E${r}`, rules: [{ type: 'expression', formulae: ['AND(ISNUMBER(E5),E5<>0)'], style: { fill: RED_FILL }, priority: 1 }] });
  wsP.views = [{ state: 'frozen', ySplit: 4 }];

  // ── 2_주석금액 ──
  title(wsN, '범주별 손익 — 주석 #6 기타영업손익 · #7 투자 범주 · #8 재무 범주', 'C열 = 4_시산표를 (1118 표시항목, 세부항목)으로 SUMIFS / 「계리 금액 · 조정」 줄은 5_조정에서.');
  header(wsN, 4, ['1118 표시항목', '주석 세부항목', '금액(엑셀 수식)', '화면 계산값', '차이']);
  setWidths(wsN, [26, 30, 18, 18, 12]);
  let nr = 5;
  for (const ln of LINES_1118) {
    if (ln === '영업수익' || ln === '영업비용' || ln === '법인세비용') continue;
    const items = res.notes.filter((n) => n.line === ln);
    if (!items.length && !(res.pl1118[ln] ?? 0)) continue;
    const s0 = nr;
    for (const it of items) {
      cell(wsN, nr, 1, ln); cell(wsN, nr, 2, it.detail, BLUE);
      const fx = it.detail === '계리 금액 · 조정'
        ? `SUMIFS(${A('F')},${A('D')},A${nr})-SUMIFS(${A('F')},${A('E')},A${nr})`
        : `SUMIFS(${T('H')},${T('F')},A${nr},${T('G')},B${nr})`;
      cell(wsN, nr, 3, f(fx), GREEN, NUM); cell(wsN, nr, 4, Math.round(it.amount), BLUE, NUM); cell(wsN, nr, 5, f(`ROUND(C${nr}-D${nr},0)`), FONT, NUM);
      nr++;
    }
    cell(wsN, nr, 1, `${ln} 합계`, FONT_BOLD); cell(wsN, nr, 2, '1_손익계산서와 일치?', FONT);
    cell(wsN, nr, 3, f(`SUM(C${s0}:C${nr - 1})`), FONT_BOLD, NUM);
    cell(wsN, nr, 4, f(`'1_손익계산서'!C${pos[ln]}`), GREEN, NUM);
    cell(wsN, nr, 5, f(`ROUND(C${nr}-D${nr},0)`), FONT, NUM);
    for (const c of [1, 2, 3, 4, 5]) wsN.getCell(nr, c).fill = FILL_TOTAL;
    nr += 2;
  }
  wsN.addConditionalFormatting({ ref: `E5:E${nr}`, rules: [{ type: 'expression', formulae: ['AND(ISNUMBER(E5),E5<>0)'], style: { fill: RED_FILL }, priority: 1 }] });

  // ── 3_주의계정검토 ──
  title(wsW, '주의계정 검토 — 같은 전표에 투자 · 재무 계정이 있는 라인과 판단', '판단 「조정」은 5_조정에 같은 금액으로 들어가 있다.');
  header(wsW, 4, ['전표번호', '전기일', 'G/L', '계정명', '금액(차변+)', '라인텍스트', '같은 전표 투자·재무 계정', '속성', '제안 항목', '판단', '대상 항목', '근거', '판단자', '일시']);
  setWidths(wsW, [13, 11, 11, 26, 14, 40, 26, 6, 14, 10, 14, 44, 10, 16]);
  const jm = new Map(judgments.map((j) => [`${j.docNo}|${j.gl}`, j]));
  res.watch.forEach((w, i) => {
    const rr = 5 + i;
    const j = jm.get(`${w.docNo}|${w.gl}`);
    const vals = [w.docNo, w.date, w.gl, w.glName, w.amt, w.memo, w.cpName, w.cpAttr, w.suggest ?? '', w.decision, j?.target ?? '', j?.reason ?? '', j?.byName ?? '', j?.at ?? ''];
    vals.forEach((v, c) => cell(wsW, rr, c + 1, v, BLUE, c === 4 ? NUM : undefined));
  });
  if (!res.watch.length) cell(wsW, 5, 1, '검토 대상 라인 없음');

  // ── 7_계정판단표 ──
  title(wsR, `계정 판단표 — ${cfg.clientName}`, cfg.source ?? '');
  header(wsR, 4, ['G/L', '계정명', '1001 항목', '크래프톤 범주', '회사 판단 범주', '특수구분', '주석 세부항목', '주의계정', '근거·비고']);
  setWidths(wsR, [11, 32, 11, 10, 10, 12, 26, 8, 50]);
  cfg.accounts.forEach((a, i) => {
    const vals = [a.gl, a.name, a.l1001, a.kcat, a.ncat ?? '', a.special ?? '', a.detail ?? '', a.watch ? 'Y' : '', a.note ?? ''];
    vals.forEach((v, c) => cell(wsR, 5 + i, c + 1, v, BLUE));
  });
  wsR.views = [{ state: 'frozen', ySplit: 4 }];
  wsR.autoFilter = `A4:I${4 + cfg.accounts.length}`;

  // ── 0_안내 ──
  title(wsG, `${cfg.clientName} · K-IFRS 제1118호 월결산 결과`, `기간 ${period} · 생성 ${new Date().toLocaleString('ko-KR')} · ${opts.byName} · jaytax`);
  setWidths(wsG, [24, 90]);
  const info: [string, string][] = [
    ['원천 파일', opts.fileName],
    ['분개장 줄', `${res.lineCount.toLocaleString()}줄 사용 (임시전표 ${res.tempCount}줄 제외) · 손익 계정 ${pl.length.toLocaleString()}줄을 6_분개장손익에 수록`],
    ['검증 방법', '이 파일의 손익계산서 · 브릿지 · 주석금액은 모두 엑셀 수식이다. 6_분개장손익(원천) → 4_시산표(SUMIFS) → 1_손익계산서 · 2_주석금액(SUMIFS). 각 시트의 「차이」 열이 0이고 1_손익계산서 맨 아래 검증이 모두 ✔이면 화면 결과와 엑셀 재계산이 같다.'],
    ['판단 근거', cfg.source ?? ''],
    ['자동 확인', res.checks.map((c) => `${c.ok ? '✔' : '✘'} ${c.label}`).join('  ·  ')],
    ['기준', 'K-IFRS 제1118호 문단 47~65 · 69 · 86 · B65 · B70~B76 · 24 · 41 · 42'],
  ];
  info.forEach(([k, v], i) => {
    cell(wsG, 4 + i, 1, k, FONT_BOLD); const c = cell(wsG, 4 + i, 2, v); c.alignment = { wrapText: true, vertical: 'top' };
    wsG.getRow(4 + i).height = Math.max(18, Math.ceil(v.length / 60) * 15);
  });

  for (const ws of [wsP, wsN, wsW]) ws.views = ws.views?.length ? ws.views : [{ state: 'frozen', ySplit: 4 }];
  wb.calcProperties = { fullCalcOnLoad: true };
  return wb;
}
