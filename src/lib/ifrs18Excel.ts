// K-IFRS 1118 월결산 — 결과를 **엑셀만으로 다시 계산 · 검증되는** 파일로 내보낸다(사용자 2026-11-09).
//
//   · 시스템 흔적을 남기지 않는다: 「화면 값」 비교 열이 없고 프로그램 이름도 적지 않는다. 모든 결과는
//     92_분개장(원천 값) · 93_계정판단표 · 94_BS속성 · 91_조정내역의 입력만으로 엑셀 수식이 다시 센다.
//   · 시트 이름 앞 번호가 쓰임새다 — 00 읽는 법 · 01 검증 · 1x 보고 · 20 권고 · 30 검토 · 9x 근거.
//   · 20_조정권고전표: 1118 기준으로 회사 장부(SAP)에 기표해야 할 재분류 전표. 라인텍스트에 권고코드를 적어 기표하면
//     다음 분개장에서 「이미 기표」로 잡혀 권고액이 줄고(2차 마감), 손익계산서는 그대로다.
//
// 색: 노랑 칠 = 바꿀 수 있는 입력 · 파랑 글씨 = 원천 값 · 초록 글씨 = 다른 시트를 읽는 수식 · 검정 = 이 시트 안 수식.
// ExcelJS 는 무거워 내보낼 때만 동적 로드한다.
import type { Worksheet } from 'exceljs';
import { FONT, FONT_BOLD, FILL_HEADER, FILL_TOTAL, FILL_INPUT, BORDER_ALL, setWidths, saveWorkbook } from './confirmExcelStyle';
import {
  PL1118_ORDER, PL1001_ORDER, LINES_1118,
  type Ifrs18Config, type Ifrs18Result, type Ifrs18Periods, type JLine, type Judgment, type CloseSummary,
} from './ifrs18';

async function loadExcelJS() {
  const mod = await import('exceljs');
  const ns = (mod as unknown as { default?: unknown }).default ?? mod;
  return ns as typeof import('exceljs');
}

const NUM = '#,##0;(#,##0);"-"';
const BLUE = { ...FONT, color: { argb: 'FF0000FF' } };
const GREEN = { ...FONT, color: { argb: 'FF008000' } };
const RED_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF8D7DA' } };
const TAB = { guide: 'FF5B6573', check: 'FF16A34A', report: 'FF1F4E79', advise: 'FFED7D31', review: 'FF7030A0', basis: 'FFA6A6A6' };

function header(ws: Worksheet, row: number, cols: string[]) {
  cols.forEach((h, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = h; c.font = FONT_BOLD; c.fill = FILL_HEADER; c.border = BORDER_ALL;
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  ws.getRow(row).height = 30;
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
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

export interface Ifrs18ExportOpts {
  cfg: Ifrs18Config; res: Ifrs18Result; per?: Ifrs18Periods; lines: JLine[]; judgments: Judgment[]; fileName: string; byName: string;
  /** 1차 마감 요약(있으면 01_검증체크에 「1차 마감 대비」를 넣는다) */ close1?: { summary: CloseSummary; at: string; byName: string | null } | null;
  /** 2차 마감 여부 표시 */ close2?: { at: string; byName: string | null } | null;
}

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
  wb.creator = opts.byName || ''; wb.created = new Date();
  const lastDay = new Date(res.year, res.month, 0).getDate();
  const period = `${res.year}. 1. 1 ~ ${res.year}. ${res.month}. ${lastDay}`;

  const add = (name: string, tab: string) => { const ws = wb.addWorksheet(name); ws.properties.tabColor = { argb: tab }; return ws; };
  const wsG = add('00_읽는법', TAB.guide);
  const wsC = add('01_검증체크', TAB.check);
  const wsP = add('10_손익계산서', TAB.report);
  const wsQ = add('11_기간별손익', TAB.report);
  const wsN = add('12_주석금액', TAB.report);
  const wsR = add('20_조정권고전표', TAB.advise);
  const wsW = add('30_주의계정판단', TAB.review);
  const wsT = add('90_시산표', TAB.basis);
  const wsA = add('91_조정내역', TAB.basis);
  const wsJ = add('92_분개장', TAB.basis);
  const wsK = add('93_계정판단표', TAB.basis);
  const wsB = add('94_BS속성', TAB.basis);

  // ── 00 기본 정보(다른 시트가 읽는 값: B6 연도 · B7 기준월 · B8 전월 · B9 직전 분기 말 월) ──
  const P = { Y: "'00_읽는법'!$B$6", M: "'00_읽는법'!$B$7", PM: "'00_읽는법'!$B$8", PQ: "'00_읽는법'!$B$9" };
  const cutPM = `DATE(${P.Y},${P.PM}+1,0)`, cutPQ = `DATE(${P.Y},${P.PQ}+1,0)`;

  // ── 93_계정판단표 — 판단(입력) + 1118 표시항목(수식) ──
  title(wsK, `계정 판단표 — ${cfg.clientName}`, `${cfg.source ?? ''}  ·  노란 칸(회사 판단 범주)을 바꾸면 1118 표시항목과 모든 결과가 다시 계산된다. 적용 범주 = 회사 판단 범주가 있으면 그것, 없으면 그룹 범주.`);
  header(wsK, 4, ['G/L', '계정명', '1001 항목', '그룹(크래프톤) 범주', '회사 판단 범주', '적용 범주', '특수구분', '주석 세부항목(지정)', '주의계정', '근거·비고', '1118 표시항목', '주석 세부항목(적용)']);
  setWidths(wsK, [11, 32, 11, 10, 10, 9, 12, 24, 8, 44, 24, 26]);
  cfg.accounts.forEach((a, i) => {
    const r = 5 + i;
    [a.gl, a.name, a.l1001, a.kcat].forEach((v, c) => cell(wsK, r, c + 1, v, BLUE));
    const e = cell(wsK, r, 5, a.ncat ?? '', BLUE); e.fill = FILL_INPUT;
    cell(wsK, r, 6, f(`IF(E${r}="",D${r},E${r})`));
    cell(wsK, r, 7, a.special ?? '', BLUE); cell(wsK, r, 8, a.detail ?? '', BLUE); cell(wsK, r, 9, a.watch ? 'Y' : '', BLUE); cell(wsK, r, 10, a.note ?? '', BLUE);
    const inc = `OR(C${r}="기타수익",C${r}="금융수익")`;
    cell(wsK, r, 11, f(`IF(F${r}="임시","임시계정",IF(F${r}="법인세","법인세비용",IF(F${r}="영업",IF(G${r}="무형자산손상","무형자산손상차손",IF(OR(C${r}="영업수익",C${r}="영업비용"),C${r},IF(${inc},"기타영업수익","기타영업비용"))),IF(F${r}="투자",IF(G${r}="종속관계","종속기업·관계기업 관련 손익",IF(G${r}="대여금손상","대여금 손상차손",IF(OR(${inc},C${r}="영업수익"),"투자수익","기타투자비용"))),IF(F${r}="재무",IF(${inc},"재무수익","재무비용"),"확인필요")))))`));
    cell(wsK, r, 12, f(`IF(H${r}="",K${r},H${r})`));
  });
  const KE = 4 + Math.max(cfg.accounts.length, 1);
  const K = (c: string) => `'93_계정판단표'!$${c}$5:$${c}$${KE}`;
  wsK.views = [{ state: 'frozen', ySplit: 4 }];
  wsK.autoFilter = `A4:L${KE}`;
  const look = (key: string, col: string, miss: string) => `IFERROR(INDEX(${K(col)},MATCH(${key},${K('A')},0)),${q(miss)})`;

  // ── 94_BS속성 ──
  title(wsB, 'BS 계정 속성 — 주의계정 판단(같은 전표에 투자 · 재무 계정이 있는가)에 쓰는 표', '현금은 어느 쪽에도 넣지 않는다(모든 거래에 끼므로).');
  header(wsB, 4, ['G/L', '속성']);
  setWidths(wsB, [12, 10]);
  const bs = Object.entries(cfg.bsAttr).sort(([a], [b]) => a.localeCompare(b));
  bs.forEach(([gl, at], i) => { cell(wsB, 5 + i, 1, gl, BLUE); const c = cell(wsB, 5 + i, 2, at, BLUE); c.fill = FILL_INPUT; });
  const BE = 4 + Math.max(bs.length, 1);
  wsB.views = [{ state: 'frozen', ySplit: 4 }];

  // ── 91_조정내역 행 위치(92 의 태그 확인이 읽는다) ──
  const AE = 4 + Math.max(res.moves.length, 1);
  const A = (c: string) => `'91_조정내역'!$${c}$5:$${c}$${AE}`;

  // ── 92_분개장 — 원천(값) + 판별 수식. 임시전표는 뺀다 ──
  title(wsJ, '분개장 (원천 · 값) — 임시전표 제외 전체 줄', `원천 파일 「${opts.fileName}」. G~N 은 수식: 금액 · 손익/BS · 1118 표시항목(93) · BS 속성(94) · 권고코드(라인텍스트) · 조정전표 줄 확인.`);
  header(wsJ, 4, ['전표번호', '전기일', 'G/L', '계정명', '차변', '대변', '금액(차변+)', '라인텍스트', '거래처', '손익/BS', '1118 표시항목', 'BS 속성', '권고코드', '조정전표 줄 확인']);
  setWidths(wsJ, [13, 11, 11, 28, 15, 15, 15, 40, 22, 7, 20, 8, 26, 12]);
  const live = lines.filter((l) => !l.temp);
  live.forEach((l, i) => {
    const r = 5 + i;
    const row = wsJ.getRow(r);
    const [yy, mm, dd] = l.date.split('-').map(Number);
    row.values = [l.docNo, yy ? new Date(Date.UTC(yy, mm - 1, dd)) : l.date, l.gl, l.glName, l.dr, l.cr, null, l.memo, l.vendor];
    row.getCell(2).numFmt = 'yyyy-mm-dd';
    row.getCell(5).numFmt = NUM; row.getCell(6).numFmt = NUM; row.getCell(7).numFmt = NUM;
    row.getCell(7).value = f(`E${r}-F${r}`);
    row.getCell(10).value = f(`IF(LEFT(C${r},1)>="4","손익","BS")`);
    row.getCell(11).value = f(`IF(J${r}="손익",${look(`C${r}`, 'K', '확인필요')},"")`);
    row.getCell(12).value = f(`IF(J${r}="BS",IFERROR(INDEX('94_BS속성'!$B$5:$B$${BE},MATCH(C${r},'94_BS속성'!$A$5:$A$${BE},0)),"미등록"),"")`);
    row.getCell(13).value = f(`IFERROR(TRIM(LEFT(MID(H${r},SEARCH("1118-",H${r}),40),FIND(" ",MID(H${r},SEARCH("1118-",H${r}),40)&" ")-1)),"")`);
    row.getCell(14).value = f(`IF(OR(M${r}="",J${r}<>"손익"),"",IFERROR(IF(OR(C${r}=INDEX(${A('D')},MATCH(M${r},${A('A')},0)),K${r}=INDEX(${A('F')},MATCH(M${r},${A('A')},0))),"정상","확인"),"미등록코드"))`);
  });
  const JE = 4 + Math.max(live.length, 1);
  const J = (c: string) => `'92_분개장'!$${c}$5:$${c}$${JE}`;
  wsJ.views = [{ state: 'frozen', ySplit: 4 }];
  wsJ.autoFilter = `A4:N${JE}`;

  // ── 90_시산표 — 분개장 손익 줄 합계(수식) ──
  title(wsT, '시산표 = 92_분개장 손익 줄의 계정별 합계 (수식)', '1001 항목 · 범주 · 1118 표시항목 · 세부항목은 93_계정판단표에서 찾는다. I · J 열은 같은 분개장을 전기일로 잘라 다시 합한 값(기간별 손익용).');
  header(wsT, 4, ['G/L', '계정명', '누적(차변+)', '1001 항목', '적용 범주', '1118 표시항목', '주석 세부항목', '누적 손익(수익+)', '전월 말 누적 손익', '직전 분기 말 누적 손익']);
  setWidths(wsT, [11, 32, 17, 11, 9, 22, 26, 17, 17, 17]);
  res.tb.forEach((t, i) => {
    const r = 5 + i;
    cell(wsT, r, 1, t.gl, BLUE); cell(wsT, r, 2, t.name, BLUE);
    cell(wsT, r, 3, f(`SUMIFS(${J('G')},${J('C')},A${r})`), GREEN, NUM);
    cell(wsT, r, 4, f(look(`A${r}`, 'C', '확인필요')), GREEN); cell(wsT, r, 5, f(look(`A${r}`, 'F', '확인필요')), GREEN);
    cell(wsT, r, 6, f(look(`A${r}`, 'K', '확인필요')), GREEN); cell(wsT, r, 7, f(look(`A${r}`, 'L', '')), GREEN);
    cell(wsT, r, 8, f(`-C${r}`), FONT, NUM);
    cell(wsT, r, 9, f(`-SUMIFS(${J('G')},${J('C')},A${r},${J('B')},"<="&${cutPM})`), GREEN, NUM);
    cell(wsT, r, 10, f(`-SUMIFS(${J('G')},${J('C')},A${r},${J('B')},"<="&${cutPQ})`), GREEN, NUM);
  });
  const TE = 4 + Math.max(res.tb.length, 1);
  const T = (c: string) => `'90_시산표'!$${c}$5:$${c}$${TE}`;
  wsT.views = [{ state: 'frozen', ySplit: 4 }];
  wsT.autoFilter = `A4:J${TE}`;

  // ── 91_조정내역 — 1118 기준 옮길 금액(필요) − 회사가 이미 기표한 조정전표(기표) = 손익계산서에서 옮기는 금액(반영) ──
  title(wsA, '조정 내역 — 필요(1118 기준) − 이미 기표(권고코드 달린 조정전표) = 반영(손익계산서에서 옮김), 금액 차변+',
    '계리: 연간 금액(노란 칸) × 개월/12 · 판단: 92_분개장에서 그 전표 · 계정 합계 · 수동: 지정 금액. 이미 기표 = 92_분개장에서 권고코드가 같고 계정이 대상 1118 항목인 줄의 합계.');
  header(wsA, 4, ['권고코드', '구분', '원 전표번호', '원천 G/L', '원천 1118 항목', '대상 1118 항목', '기준 금액(계리 연간 · 수동)',
    '필요(누적)', '이미 기표(누적)', '반영(누적)', '필요(전월 말)', '이미 기표(전월 말)', '반영(전월 말)', '필요(직전 분기 말)', '이미 기표(직전 분기 말)', '반영(직전 분기 말)', '내용 · 근거']);
  setWidths(wsA, [28, 7, 12, 10, 16, 16, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 50]);
  res.moves.forEach((m, i) => {
    const r = 5 + i;
    cell(wsA, r, 1, m.code, BLUE); cell(wsA, r, 2, m.kind, BLUE); cell(wsA, r, 3, m.docNo ?? '', BLUE); cell(wsA, r, 4, m.srcGl, BLUE);
    cell(wsA, r, 5, f(look(`D${r}`, 'K', '확인필요')), GREEN); cell(wsA, r, 6, m.target, BLUE);
    const base = cell(wsA, r, 7, m.base ?? '', BLUE, NUM);
    const act = cfg.actuarial.find((x) => `1118-A-${x.key}` === m.code);
    if (m.kind === '계리') {
      base.fill = FILL_INPUT;
      if (act?.override != null) cell(wsA, r, 8, act.override, BLUE, NUM);
      else cell(wsA, r, 8, f(`ROUND(G${r}*${P.M}/12,0)`), GREEN, NUM);
      cell(wsA, r, 11, f(`ROUND(G${r}*${P.PM}/12,0)`), GREEN, NUM);
      cell(wsA, r, 14, f(`ROUND(G${r}*${P.PQ}/12,0)`), GREEN, NUM);
    } else if (m.kind === '판단') {
      cell(wsA, r, 8, f(`SUMIFS(${J('G')},${J('A')},C${r},${J('C')},D${r})`), GREEN, NUM);
      cell(wsA, r, 11, f(`SUMIFS(${J('G')},${J('A')},C${r},${J('C')},D${r},${J('B')},"<="&${cutPM})`), GREEN, NUM);
      cell(wsA, r, 14, f(`SUMIFS(${J('G')},${J('A')},C${r},${J('C')},D${r},${J('B')},"<="&${cutPQ})`), GREEN, NUM);
    } else {
      cell(wsA, r, 8, f(`G${r}`), FONT, NUM);
      cell(wsA, r, 11, f(`IF(${P.PM}>0,G${r},0)`), GREEN, NUM);
      cell(wsA, r, 14, f(`IF(${P.PQ}>0,G${r},0)`), GREEN, NUM);
    }
    cell(wsA, r, 9, f(`SUMIFS(${J('G')},${J('M')},A${r},${J('K')},F${r})`), GREEN, NUM);
    cell(wsA, r, 12, f(`SUMIFS(${J('G')},${J('M')},A${r},${J('K')},F${r},${J('B')},"<="&${cutPM})`), GREEN, NUM);
    cell(wsA, r, 15, f(`SUMIFS(${J('G')},${J('M')},A${r},${J('K')},F${r},${J('B')},"<="&${cutPQ})`), GREEN, NUM);
    for (const [c, a, b] of [[10, 'H', 'I'], [13, 'K', 'L'], [16, 'N', 'O']] as const) cell(wsA, r, c, f(`${a}${r}-${b}${r}`), FONT_BOLD, NUM);
    cell(wsA, r, 17, m.label, BLUE);
  });
  if (!res.moves.length) cell(wsA, 5, 1, '조정 없음');
  wsA.views = [{ state: 'frozen', ySplit: 4, xSplit: 1 }];

  // 1118 항목 금액 식 — tc: 시산 손익 열, ac: 91 반영 열
  const lineF = (n: string, tc: string, ac: string) => `SUMIFS(${T(tc)},${T('F')},"${n}")+SUMIFS(${A(ac)},${A('E')},"${n}")-SUMIFS(${A(ac)},${A('F')},"${n}")`;

  // ── 10_손익계산서 ──
  title(wsP, `${cfg.clientName} · K-IFRS 1118 손익계산서 (누적 ${period})`, '모두 수식(90_시산표 + 91_조정내역 반영 열). 수익 + / 비용 −');
  header(wsP, 4, ['', 'K-IFRS 1118', '금액', '근거']);
  setWidths(wsP, [3, 44, 18, 60]);
  const pos: Record<string, number> = {};
  let r = 5;
  for (const o of PL1118_ORDER) { pos[o.key] = r; r++; }
  const sub1118 = (key: string, col: string, p: Record<string, number>) => {
    if (key === '영업손익') return `SUM(${col}${p['영업수익']}:${col}${p['기타영업비용']})`;
    if (key === '재무손익 및 법인세비용차감전손익') return `${col}${p['영업손익']}+SUM(${col}${p['종속기업·관계기업 관련 손익']}:${col}${p['기타투자비용']})`;
    if (key === '법인세비용차감전순손익') return `${col}${p['재무손익 및 법인세비용차감전손익']}+${col}${p['재무수익']}+${col}${p['재무비용']}`;
    if (key === '당기순손익') return `${col}${p['법인세비용차감전순손익']}+${col}${p['법인세비용']}`;
    return null;
  };
  const why1118: Record<string, string> = {
    '영업손익': '문단 69 — 영업 범주 합계', '재무손익 및 법인세비용차감전손익': '문단 69 — 영업 + 투자 범주',
    '법인세비용차감전순손익': '재무 범주 포함', '당기순손익': '1001 당기순이익과 같아야 함(01_검증체크)',
  };
  for (const o of PL1118_ORDER) {
    const rr = pos[o.key];
    cell(wsP, rr, 2, o.label, o.sub ? FONT_BOLD : FONT);
    cell(wsP, rr, 3, f(sub1118(o.key, 'C', pos) ?? lineF(o.key, 'H', 'J')), o.sub ? FONT_BOLD : GREEN, NUM);
    cell(wsP, rr, 4, why1118[o.key] ?? '', { ...FONT, size: 9 });
    if (o.sub) for (const c of [2, 3, 4]) wsP.getCell(rr, c).fill = FILL_TOTAL;
  }
  r = pos['당기순손익'] + 2;
  header(wsP, r, ['', '1001 (현행)', '금액', '']); r++;
  const p1: Record<string, number> = {};
  for (const o of PL1001_ORDER) { p1[o.key] = r; r++; }
  const sub1001 = (key: string, col: string, p: Record<string, number>, tc: string) => {
    if (key === '영업이익') return `${col}${p['영업수익']}+${col}${p['영업비용']}`;
    if (key === '법인세비용차감전순이익') return `${col}${p['영업이익']}+SUM(${col}${p['기타수익']}:${col}${p['금융비용']})+SUMIFS(${T(tc)},${T('D')},"임시계정")`;
    if (key === '당기순이익') return `${col}${p['법인세비용차감전순이익']}+${col}${p['법인세비용']}`;
    return `SUMIFS(${T(tc)},${T('D')},"${key}")`;
  };
  for (const o of PL1001_ORDER) {
    const rr = p1[o.key];
    cell(wsP, rr, 2, o.label, o.sub ? FONT_BOLD : FONT);
    cell(wsP, rr, 3, f(sub1001(o.key, 'C', p1, 'H')), o.sub ? FONT_BOLD : GREEN, NUM);
    if (o.sub) for (const c of [2, 3, 4]) wsP.getCell(rr, c).fill = FILL_TOTAL;
  }
  r += 1;
  header(wsP, r, ['', '영업손익 조정 (1001 영업이익 → 1118 영업손익)', '금액', '설명']); r++;
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
    cell(wsP, rr, 4, b.note, { ...FONT, size: 9 });
  });
  const bEnd = b0 + res.bridge.length - 1;
  wsP.views = [{ state: 'frozen', ySplit: 4 }];

  // ── 11_기간별손익 ──
  const pm = res.month - 1, pq = Math.floor((res.month - 1) / 3) * 3;
  title(wsQ, `기간별 손익 — 당월(${res.month}월) · 당분기(${pq + 1}~${res.month}월) · 누적(1~${res.month}월)`,
    '누적 = 10_손익계산서 · 전월 말 / 직전 분기 말 누적 = 90_시산표 I · J 열 + 91_조정내역 반영(전월 말 · 직전 분기 말) · 당월 = 누적 − 전월 말 · 당분기 = 누적 − 직전 분기 말');
  header(wsQ, 4, ['', 'K-IFRS 1118', '누적', `전월 말 누적(~${pm}월)`, `당월(${res.month}월)`, `직전 분기 말 누적(~${pq}월)`, `당분기(${pq + 1}~${res.month}월)`]);
  setWidths(wsQ, [3, 40, 17, 17, 17, 17, 17]);
  const qp: Record<string, number> = {}; let qr = 5;
  for (const o of PL1118_ORDER) { qp[o.key] = qr; qr++; }
  qr++; const qh = qr; qr++;
  const qp1: Record<string, number> = {};
  for (const o of PL1001_ORDER) { qp1[o.key] = qr; qr++; }
  header(wsQ, qh, ['', '1001 (현행)', '누적', '전월 말 누적', '당월', '직전 분기 말 누적', '당분기']);
  const putQ = (rr: number, label: string, sub: boolean | undefined, cumRef: string, dF: string, fF: string) => {
    cell(wsQ, rr, 2, label, sub ? FONT_BOLD : FONT);
    cell(wsQ, rr, 3, f(cumRef), GREEN, NUM);
    cell(wsQ, rr, 4, f(dF), sub ? FONT_BOLD : GREEN, NUM);
    cell(wsQ, rr, 5, f(`C${rr}-D${rr}`), FONT_BOLD, NUM);
    cell(wsQ, rr, 6, f(fF), sub ? FONT_BOLD : GREEN, NUM);
    cell(wsQ, rr, 7, f(`C${rr}-F${rr}`), FONT_BOLD, NUM);
    if (sub) for (let c = 2; c <= 7; c++) wsQ.getCell(rr, c).fill = FILL_TOTAL;
  };
  for (const o of PL1118_ORDER) {
    putQ(qp[o.key], o.label, o.sub, `'10_손익계산서'!C${pos[o.key]}`,
      sub1118(o.key, 'D', qp) ?? lineF(o.key, 'I', 'M'), sub1118(o.key, 'F', qp) ?? lineF(o.key, 'J', 'P'));
  }
  for (const o of PL1001_ORDER) {
    putQ(qp1[o.key], o.label, o.sub, `'10_손익계산서'!C${p1[o.key]}`, sub1001(o.key, 'D', qp1, 'I'), sub1001(o.key, 'F', qp1, 'J'));
  }
  wsQ.views = [{ state: 'frozen', ySplit: 4 }];

  // ── 12_주석금액 ──
  title(wsN, '범주별 손익 — 주석 #6 기타영업손익 · #7 투자 범주 · #8 재무 범주', 'C열 = 90_시산표를 (1118 표시항목, 세부항목)으로 SUMIFS · 「계리 금액 · 조정」 줄은 91_조정내역 반영 열. 항목 합계가 10_손익계산서와 같은지 E열(차이).');
  header(wsN, 4, ['1118 표시항목', '주석 세부항목', '금액', '10_손익계산서', '차이']);
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
        ? `SUMIFS(${A('J')},${A('E')},A${nr})-SUMIFS(${A('J')},${A('F')},A${nr})`
        : `SUMIFS(${T('H')},${T('F')},A${nr},${T('G')},B${nr})`;
      cell(wsN, nr, 3, f(fx), GREEN, NUM);
      nr++;
    }
    cell(wsN, nr, 1, `${ln} 합계`, FONT_BOLD);
    cell(wsN, nr, 3, f(items.length ? `SUM(C${s0}:C${nr - 1})` : '0'), FONT_BOLD, NUM);
    cell(wsN, nr, 4, f(`'10_손익계산서'!C${pos[ln]}`), GREEN, NUM);
    cell(wsN, nr, 5, f(`ROUND(C${nr}-D${nr},0)`), FONT, NUM);
    for (const c of [1, 2, 3, 4, 5]) wsN.getCell(nr, c).fill = FILL_TOTAL;
    nr += 2;
  }
  const NE = Math.max(nr, 6);
  wsN.addConditionalFormatting({ ref: `E5:E${NE}`, rules: [{ type: 'expression', formulae: ['AND(ISNUMBER(E5),E5<>0)'], style: { fill: RED_FILL }, priority: 1 }] });

  // ── 20_조정권고전표 ──
  const startTxt = cfg.adjustFrom ? `${cfg.adjustFrom.replace('-', '년 ')}월` : '';
  const started = !cfg.adjustFrom || `${res.year}-${String(res.month).padStart(2, '0')}` >= cfg.adjustFrom;
  title(wsR, '조정 권고 전표 — K-IFRS 1118 기준으로 장부(SAP)에 기표할 재분류 전표',
    `${started ? '이번 달 기표 대상' : `참고용 — 기표는 ${startTxt} 결산부터`} · 금액 = 1118 기준 옮길 금액(누적) − 이미 기표한 조정전표(누적). 각 줄의 라인텍스트 맨 앞에 A열 권고코드를 적는다. 대상 G/L(노란 칸)은 바꿀 수 있다.`);
  header(wsR, 4, ['권고코드(라인텍스트에 기재)', '구분', '내용', '옮길 금액(누적)', '이미 기표(누적)', '이번 기표 금액(차변+)', '차변 G/L', '차변 계정명', '대변 G/L', '대변 계정명', '금액', '대상 G/L(입력)', '대상 G/L의 1118 항목', '확인']);
  setWidths(wsR, [28, 7, 40, 15, 15, 16, 10, 26, 10, 26, 15, 11, 20, 16]);
  res.moves.forEach((m, i) => {
    const rr = 5 + i, ar = 5 + i;
    cell(wsR, rr, 1, f(`'91_조정내역'!A${ar}`), GREEN); cell(wsR, rr, 2, f(`'91_조정내역'!B${ar}`), GREEN); cell(wsR, rr, 3, f(`'91_조정내역'!Q${ar}`), GREEN);
    cell(wsR, rr, 4, f(`'91_조정내역'!H${ar}`), GREEN, NUM); cell(wsR, rr, 5, f(`'91_조정내역'!I${ar}`), GREEN, NUM); cell(wsR, rr, 6, f(`'91_조정내역'!J${ar}`), GREEN, NUM);
    cell(wsR, rr, 7, f(`IF(F${rr}=0,"",IF(F${rr}>0,L${rr},'91_조정내역'!D${ar}))`));
    cell(wsR, rr, 8, f(`IF(G${rr}="","",${look(`G${rr}`, 'B', '판단표에 없음')})`), GREEN);
    cell(wsR, rr, 9, f(`IF(F${rr}=0,"",IF(F${rr}>0,'91_조정내역'!D${ar},L${rr}))`));
    cell(wsR, rr, 10, f(`IF(I${rr}="","",${look(`I${rr}`, 'B', '판단표에 없음')})`), GREEN);
    cell(wsR, rr, 11, f(`ABS(F${rr})`), FONT_BOLD, NUM);
    const t = cell(wsR, rr, 12, m.reclassGl, BLUE); t.fill = FILL_INPUT;
    cell(wsR, rr, 13, f(`IF(L${rr}="","대상 G/L 입력 필요",${look(`L${rr}`, 'K', '판단표에 없음')})`), GREEN);
    cell(wsR, rr, 14, f(`IF(F${rr}=0,"기표 불필요",IF(M${rr}='91_조정내역'!F${ar},"✔ 기표","✘ 대상 항목과 다름"))`));
  });
  const RE = 4 + Math.max(res.moves.length, 1);
  if (!res.moves.length) cell(wsR, 5, 1, '권고 전표 없음');
  let rr2 = RE + 2;
  cell(wsR, rr2, 3, '이번 기표 합계(차변 = 대변)', FONT_BOLD); cell(wsR, rr2, 11, f(`SUM(K5:K${RE})`), FONT_BOLD, NUM); rr2 += 2;
  const rules = [
    '1. 전표마다 차변 · 대변 두 줄. 두 줄 모두 라인텍스트 맨 앞에 권고코드(A열)를 적는다 — 다음 달 분개장에서 「이미 기표」로 잡히는 열쇠다.',
    '2. 금액은 1월부터 기준월까지 누적 기준이다. 지난달까지 기표한 금액은 「이미 기표」에 들어 있으므로 「이번 기표 금액」만 기표한다.',
    '3. 손익 안에서 계정만 옮기는 전표라 당기순이익은 바뀌지 않는다. 1001 영업이익은 계정의 1001 항목에 따라 바뀔 수 있다.',
    '4. 기표 후 같은 기준월 분개장을 다시 받아 이 파일을 다시 만들면 「이번 기표 금액」이 0 이고 10_손익계산서가 기표 전과 같아야 한다(01_검증체크 2차 항목).',
    '5. 대상 G/L 이 판단표에 없거나 1118 항목이 다르면 ✘ — 계정을 바꾸거나 판단표(93)를 고친다.',
  ];
  for (const t of rules) { const c = wsR.getCell(rr2, 1); c.value = t; c.font = { ...FONT, size: 9 }; wsR.mergeCells(rr2, 1, rr2, 14); rr2++; }
  wsR.views = [{ state: 'frozen', ySplit: 4, xSplit: 1 }];

  // ── 30_주의계정판단 ──
  title(wsW, '주의계정 판단 — 투자 · 재무 거래가 섞일 수 있는 계정 중 같은 전표에 투자 · 재무 속성 BS 계정이 있는 줄',
    'E · G · H 열은 92_분개장에서 다시 센 값. 판단 「조정」은 91_조정내역과 20_조정권고전표에 같은 권고코드로 들어간다.');
  header(wsW, 4, ['전표번호', '전기일', 'G/L', '계정명', '금액(전표·계정 합계)', '라인텍스트', '같은 전표 투자 BS 줄', '같은 전표 재무 BS 줄', '확인', '제안 항목', '판단', '대상 항목', '근거', '판단자', '일시', '권고코드']);
  setWidths(wsW, [13, 11, 11, 24, 15, 36, 9, 9, 10, 14, 10, 14, 40, 10, 16, 28]);
  const jm = new Map(judgments.map((j) => [`${j.docNo}|${j.gl}`, j]));
  res.watch.forEach((w, i) => {
    const rr = 5 + i;
    const j = jm.get(`${w.docNo}|${w.gl}`);
    cell(wsW, rr, 1, w.docNo, BLUE); cell(wsW, rr, 2, w.date, BLUE); cell(wsW, rr, 3, w.gl, BLUE); cell(wsW, rr, 4, w.glName, BLUE);
    cell(wsW, rr, 5, f(`SUMIFS(${J('G')},${J('A')},A${rr},${J('C')},C${rr})`), GREEN, NUM);
    cell(wsW, rr, 6, w.memo, BLUE);
    cell(wsW, rr, 7, f(`COUNTIFS(${J('A')},A${rr},${J('L')},"투자")`), GREEN);
    cell(wsW, rr, 8, f(`COUNTIFS(${J('A')},A${rr},${J('L')},"재무")`), GREEN);
    cell(wsW, rr, 9, f(`IF(G${rr}+H${rr}>0,"✔ 대상","✘ 대상 아님")`));
    cell(wsW, rr, 10, w.suggest ?? '', BLUE); cell(wsW, rr, 11, w.decision, BLUE);
    cell(wsW, rr, 12, w.decision === '조정' ? (j?.target ?? w.suggest ?? '') : '', BLUE);
    cell(wsW, rr, 13, j?.reason ?? '', BLUE); cell(wsW, rr, 14, j?.byName ?? '', BLUE);
    cell(wsW, rr, 15, j?.at ? new Date(j.at).toLocaleString('ko-KR') : '', BLUE);
    cell(wsW, rr, 16, f(`IF(K${rr}="조정","1118-J-"&A${rr}&"-"&C${rr},"")`));
  });
  const WE = 4 + Math.max(res.watch.length, 1);
  if (!res.watch.length) cell(wsW, 5, 1, '검토 대상 줄 없음');
  wsW.views = [{ state: 'frozen', ySplit: 4 }];

  // ── 01_검증체크 ──
  title(wsC, '검증 체크 — 이 파일만으로 결과가 맞는지 (모두 수식)', '「결과」가 모두 ✔ 이면 마감 조건을 만족한다. ✘ 이면 「고칠 곳」을 본다. 2차 항목은 조정전표를 기표한 뒤(조정전표 기표 시작월부터) 본다.');
  header(wsC, 4, ['', '확인 항목', '결과', '값', '고칠 곳']);
  setWidths(wsC, [4, 52, 9, 18, 60]);
  const ok = (x: string) => f(`IF(${x},"✔","✘")`);
  const checks: [string, string, string, string][] = [
    ['분개장 차변 합계 = 대변 합계', `ROUND(SUM(${J('E')})-SUM(${J('F')}),0)=0`, `SUM(${J('E')})-SUM(${J('F')})`, '분개장을 처음부터 다시 받기'],
    ['시산표 합계 = 분개장 손익 줄 합계(빠진 계정 없음)', `ROUND(SUM(${T('C')})-SUMIFS(${J('G')},${J('J')},"손익"),0)=0`, `SUM(${T('C')})-SUMIFS(${J('G')},${J('J')},"손익")`, '90_시산표에 없는 손익 계정 — 판단표 · 시산표 확인'],
    ['손익 계정이 모두 판단표에 있음', `COUNTIF(${T('F')},"확인필요")=0`, `COUNTIF(${T('F')},"확인필요")`, '93_계정판단표에 계정 추가'],
    ['BS 계정 속성이 모두 있음', `COUNTIF(${J('L')},"미등록")=0`, `COUNTIF(${J('L')},"미등록")`, '94_BS속성에 계정 추가'],
    ['임시계정 잔액 0', `ROUND(SUMIFS(${T('H')},${T('F')},"임시계정"),0)=0`, `SUMIFS(${T('H')},${T('F')},"임시계정")`, '장부에서 임시 · 전환 계정 정리'],
    ['주의계정 미판단 0', `COUNTIF('30_주의계정판단'!$K$5:$K$${WE},"미판단")=0`, `COUNTIF('30_주의계정판단'!$K$5:$K$${WE},"미판단")`, '30_주의계정판단 — 판단 기록'],
    ['주의계정 목록의 줄이 모두 대상(같은 전표에 투자 · 재무 BS 줄 있음)', `COUNTIF('30_주의계정판단'!$I$5:$I$${WE},"✘*")=0`, `COUNTIF('30_주의계정판단'!$I$5:$I$${WE},"✘*")`, '94_BS속성 확인'],
    ['1118 당기순손익 = 1001 당기순이익', `ROUND('10_손익계산서'!C${pos['당기순손익']}-'10_손익계산서'!C${p1['당기순이익']},0)=0`, `'10_손익계산서'!C${pos['당기순손익']}-'10_손익계산서'!C${p1['당기순이익']}`, '91_조정내역 원천 · 대상 항목 확인'],
    ['조정은 항목만 옮김(1118 당기순손익 = 시산표 손익 합계)', `ROUND('10_손익계산서'!C${pos['당기순손익']}-SUM(${T('H')}),0)=0`, `'10_손익계산서'!C${pos['당기순손익']}-SUM(${T('H')})`, '91_조정내역의 「확인필요」 항목'],
    ['영업손익 조정(브릿지) 끝 = 1118 영업손익', `ROUND('10_손익계산서'!C${bEnd}-'10_손익계산서'!C${pos['영업손익']},0)=0`, `'10_손익계산서'!C${bEnd}-'10_손익계산서'!C${pos['영업손익']}`, '93_계정판단표 범주 확인'],
    ['주석금액 항목 합계 = 손익계산서', `SUMPRODUCT(ABS('12_주석금액'!$E$5:$E$${NE}))=0`, `SUMPRODUCT(ABS('12_주석금액'!$E$5:$E$${NE}))`, '12_주석금액의 빨간 줄'],
    ['기간별: 전월 말 1118 당기순손익 = 1001 당기순이익', `ROUND('11_기간별손익'!D${qp['당기순손익']}-'11_기간별손익'!D${qp1['당기순이익']},0)=0`, `'11_기간별손익'!D${qp['당기순손익']}-'11_기간별손익'!D${qp1['당기순이익']}`, '91_조정내역 전월 말 열'],
    ['조정전표(권고코드) 줄의 코드 · 계정 정상', `COUNTIF(${J('N')},"확인")+COUNTIF(${J('N')},"미등록코드")=0`, `COUNTIF(${J('N')},"확인")+COUNTIF(${J('N')},"미등록코드")`, '92_분개장 N열 「확인 · 미등록코드」 줄의 라인텍스트 · 계정'],
    ['20_조정권고전표 대상 G/L 이 대상 항목과 맞음', `COUNTIF('20_조정권고전표'!$N$5:$N$${RE},"✘*")=0`, `COUNTIF('20_조정권고전표'!$N$5:$N$${RE},"✘*")`, '20_조정권고전표 노란 칸(대상 G/L)'],
  ];
  let cr = 5;
  const c1 = cr;
  for (const [lab, cond, val, fix] of checks) {
    cell(wsC, cr, 1, cr - 4); cell(wsC, cr, 2, lab);
    const c = cell(wsC, cr, 3, ok(cond), FONT_BOLD); c.alignment = { horizontal: 'center' };
    cell(wsC, cr, 4, f(val), GREEN, NUM); cell(wsC, cr, 5, fix, { ...FONT, size: 9 });
    cr++;
  }
  const c1e = cr - 1;
  cell(wsC, cr, 2, '1차 마감 조건 — 위 항목 모두 ✔', FONT_BOLD);
  const s1 = cell(wsC, cr, 3, f(`IF(COUNTIF(C${c1}:C${c1e},"✘")=0,"✔","✘")`), FONT_BOLD); s1.alignment = { horizontal: 'center' };
  for (const c of [2, 3, 4, 5]) wsC.getCell(cr, c).fill = FILL_TOTAL;
  cr += 2;
  header(wsC, cr, ['', `2차 마감(조정전표 반영 검증)${cfg.adjustFrom ? ` — ${startTxt}부터` : ''}`, '결과', '값', '고칠 곳']); cr++;
  const c2 = cr;
  const two: [string, string, string, string][] = [
    ['조정 권고 잔액 0(이번 기표 금액 모두 0)', `SUMPRODUCT(ABS(${A('J')}))=0`, `SUMPRODUCT(ABS(${A('J')}))`, '20_조정권고전표대로 기표 후 분개장 다시 받기'],
  ];
  if (opts.close1) {
    const s = opts.close1.summary;
    two.push(
      [`1118 영업손익 = 1차 마감 값(${s.op.cum.toLocaleString()})`, `ROUND('10_손익계산서'!C${pos['영업손익']}-(${s.op.cum}),0)=0`, `'10_손익계산서'!C${pos['영업손익']}-(${s.op.cum})`, '기표한 조정전표의 금액 · 계정 확인'],
      [`1118 당기순손익 = 1차 마감 값(${s.ni.cum.toLocaleString()})`, `ROUND('10_손익계산서'!C${pos['당기순손익']}-(${s.ni.cum}),0)=0`, `'10_손익계산서'!C${pos['당기순손익']}-(${s.ni.cum})`, '1차 마감 뒤 다른 전표가 들어왔는지 확인'],
    );
    for (const o of PL1118_ORDER) {
      if (o.sub) continue;
      const v = Math.round(s.pl1118.cum[o.key] ?? 0);
      two.push([`  ${o.label} = 1차 마감 값`, `ROUND('10_손익계산서'!C${pos[o.key]}-(${v}),0)=0`, `'10_손익계산서'!C${pos[o.key]}-(${v})`, '']);
    }
  }
  for (const [lab, cond, val, fix] of two) {
    cell(wsC, cr, 1, cr - c2 + 1); cell(wsC, cr, 2, lab);
    const c = cell(wsC, cr, 3, ok(cond), FONT_BOLD); c.alignment = { horizontal: 'center' };
    cell(wsC, cr, 4, f(val), GREEN, NUM); cell(wsC, cr, 5, fix, { ...FONT, size: 9 });
    cr++;
  }
  cell(wsC, cr, 2, '2차 마감 조건 — 1차 조건 ✔ + 위 항목 모두 ✔', FONT_BOLD);
  const s2 = cell(wsC, cr, 3, f(`IF(AND(C${c1e + 1}="✔",COUNTIF(C${c2}:C${cr - 1},"✘")=0),"✔","✘")`), FONT_BOLD); s2.alignment = { horizontal: 'center' };
  for (const c of [2, 3, 4, 5]) wsC.getCell(cr, c).fill = FILL_TOTAL;
  wsC.addConditionalFormatting({ ref: `C5:C${cr}`, rules: [{ type: 'expression', formulae: ['C5="✘"'], style: { fill: RED_FILL }, priority: 1 }] });

  // ── 00_읽는법 ──
  title(wsG, `${cfg.clientName} · K-IFRS 제1118호 월결산 (${res.year}년 ${res.month}월)`, '이 파일은 엑셀만으로 다시 계산 · 검증된다. 먼저 01_검증체크가 모두 ✔ 인지 본다.');
  setWidths(wsG, [26, 16, 22, 70]);
  const st = opts.close2 ? `2차 마감(조정전표 반영 확인) ${new Date(opts.close2.at).toLocaleDateString('ko-KR')} ${opts.close2.byName ?? ''}`
    : opts.close1 ? `1차 마감 ${new Date(opts.close1.at).toLocaleDateString('ko-KR')} ${opts.close1.byName ?? ''}` : '마감 전(진행 중)';
  const info: [string, unknown, boolean?][] = [
    ['회사', cfg.clientName],
    ['기준연도', res.year, true],
    ['기준월', res.month, true],
    ['전월(당월 계산 기준)', f('B7-1')],
    ['직전 분기 말 월', f('INT((B7-1)/3)*3')],
    ['누적 기간', period],
    ['원천 분개장', `${opts.fileName} · ${res.lineCount.toLocaleString()}줄(임시전표 ${res.tempCount}줄 제외)`],
    ['작성', `${new Date().toLocaleString('ko-KR')} · ${opts.byName}`],
    ['마감 상태', st],
    ['조정전표 기표 시작월', startTxt || '지정 없음'],
    ['판단 근거', cfg.source ?? ''],
    ['기준', 'K-IFRS 제1118호 문단 47~65(범주) · 69(영업손익) · 86 · B65(외환차이) · B70~B76(파생상품) · 24 · 41 · 42(통합 · 세분화)'],
  ];
  info.forEach(([k, v, num], i) => {
    const rr = 5 + i;
    cell(wsG, rr, 1, k, FONT_BOLD);
    const c = cell(wsG, rr, 2, v, num ? BLUE : FONT);
    if (typeof v === 'string' && v.length > 14) wsG.mergeCells(rr, 2, rr, 4);
    c.alignment = { wrapText: true, vertical: 'top' };
  });
  let gr = 5 + info.length + 1;
  header(wsG, gr, ['시트', '구분', '누가', '무엇을 보나']); gr++;
  const guide: [string, string, string, string][] = [
    ['01_검증체크', '먼저 · 확인', '모두', '이 파일만으로 결과가 맞는지 — 1차 마감 조건 · 2차 마감 조건이 ✔ 인지'],
    ['10_손익계산서', '보고', '결산 · 공시 담당', '1118 손익계산서(누적) · 1001 비교 · 영업손익 조정(1001 영업이익 → 1118 영업손익)'],
    ['11_기간별손익', '보고', '결산 담당', '당월 · 당분기 · 누적(같은 누적 분개장을 전기일로 잘라 다시 계산)'],
    ['12_주석금액', '보고', '공시 담당', '주석 #6 기타영업손익 · #7 투자 범주 · #8 재무 범주의 세부 금액'],
    ['20_조정권고전표', '권고 · 기표', '회계 담당(장부 기표)', '1118 기준으로 장부에 기표할 재분류 전표. 라인텍스트에 권고코드를 적어 기표한다. 노란 칸(대상 G/L)만 바꿀 수 있다.'],
    ['30_주의계정판단', '검토', '회계 담당 · 검토자', '투자 · 재무 거래가 섞인 줄의 판단(영업 유지 / 조정)과 근거'],
    ['90_시산표', '근거', '검토자', '분개장 손익 줄의 계정별 합계와 1118 표시항목'],
    ['91_조정내역', '근거', '검토자', '계리 · 판단 · 수동 조정 — 필요 − 이미 기표 = 반영. 노란 칸(계리 연간 금액)'],
    ['92_분개장', '근거(원천)', '검토자', '원천 분개장 전체 줄(임시전표 제외) + 판별 수식'],
    ['93_계정판단표', '근거(판단)', '검토자', '계정별 범주 판단. 노란 칸(회사 판단 범주)을 바꾸면 전체가 다시 계산된다'],
    ['94_BS속성', '근거(판단)', '검토자', 'BS 계정 속성(주의계정 판단용)'],
  ];
  for (const g of guide) { g.forEach((v, c) => { const x = cell(wsG, gr, c + 1, v, c === 0 ? FONT_BOLD : FONT); x.alignment = { wrapText: true, vertical: 'top' }; }); gr++; }
  gr++;
  header(wsG, gr, ['색', '', '', '뜻']); gr++;
  const legend: [string, typeof FONT, boolean, string][] = [
    ['노란 칸', FONT, true, '바꿀 수 있는 입력(바꾸면 모든 시트가 다시 계산)'],
    ['파란 글씨', BLUE, false, '원천 값(분개장 · 판단 기록)'],
    ['초록 글씨', GREEN, false, '다른 시트를 읽는 수식'],
    ['검정 글씨', FONT, false, '이 시트 안의 수식 · 설명'],
  ];
  for (const [k, ft, fill, v] of legend) { const c = cell(wsG, gr, 1, k, ft); if (fill) c.fill = FILL_INPUT; cell(wsG, gr, 4, v); gr++; }

  // 이 시트 B6 · B7 이 다른 시트의 기준(연도 · 월)이다 — 위 info 순서와 맞물려 있다.
  if (wsG.getCell('A6').value !== '기준연도' || wsG.getCell('A7').value !== '기준월') throw new Error('00_읽는법 기준 칸 위치가 바뀌었습니다');

  wb.calcProperties = { fullCalcOnLoad: true };
  return wb;
}
