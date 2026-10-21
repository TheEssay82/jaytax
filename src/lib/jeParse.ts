// 감사업무관리 › Journal Entry 시스템 — 회사 분개장을 표준 줄로 읽는다(사용자 2026-10-21). supabase 를 물지 않는다.
//
// 대상 ERP 는 더존(대부분)과 영림원(일부 상장사)뿐이다. SAP · ORACLE 거래처는 없다(사용자).
// 두 ERP 모두 내보낸 분개장에 작성자 · 승인자 · 입력일 · 부서가 없다 — 그 칸은 비워 두고, 그 칸이 필요한 시나리오는 「자료 없음」으로 판정한다.
//
// 더존(세원 FY2025 실물): 시트 하나, 1행 머리. 전표일자(글자 YYYY-MM-DD) · 전표번호(매일 00001부터, 5xxxx = 매입매출) ·
//   구분(차변 · 대변 · 입금 · 출금 · 결차 · 결대) · Code(계정 3자리) · 계정과목 · 차변 · 대변 · 거래처(이름만) · Code(관리항목, 거래처코드 아님) · 적요.
//   맨 끝에 SUBTOTAL 합계행이 있다 — 전표일자가 날짜가 아니면 건너뛴다(「감가상각누계액」 때문에 낱말로 거르면 안 된다).
// 영림원(나래 FY2025 실물): 1~2행 병합 머리 「구 분[기표] 년/월/일 · 번호 | 차 변 금액 · 계정과목 | 대 변 계정과목 · 금액 | 적요 |
//   거래처 코드 · 거래처명 | 구 분[결의] 년/월/일 · 번호 | PJT …」. 계정 칸은 「[51400]통신비」, 차변 계정 칸이 차 있으면 차변 줄.
//   같은 파일 「계정별원장」 시트에 계정마다 [ 전 기 이 월 ] 줄(기초) · 잔액(기말)이 있어 시산표를 다시 만들 수 있다.
//   분개장은 하위 계정(13101 …), 원장은 상위 계정(13100)으로 묶여 있다.

export type Erp = '더존' | '영림원';
export type VType = '일반' | '매입매출' | '입출금' | '결산';

export interface JeLine {
  seq: number;
  /** YYYY-MM-DD */ date: string;
  /** 그날의 전표번호(글자 그대로). 전표 = (date, no). */ no: string;
  acctCode: string;
  acctName: string;
  dr: number;
  cr: number;
  cpCode: string | null;
  cpName: string | null;
  memo: string;
  /** 원본 차대 구분 글자(더존 「결차」 등) */ side: string | null;
  vtype: VType;
  /** 영림원 결의일 · 결의번호 */ apprDate?: string | null;
  apprNo?: string | null;
}

export interface TbRow { acctCode: string; acctName: string; open: number; dr: number; cr: number; close: number }

export interface ParsedJournal {
  erp: Erp;
  sheet: string;
  lines: JeLine[];
  /** 영림원 계정별원장에서 다시 만든 시산표(기초 · 차변 · 대변 · 기말). 더존은 null. */
  tb: TbRow[] | null;
  skipped: number;
  /** 주민번호처럼 지운 칸 수 */ masked: number;
}

const t = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[,\s]/g, '');
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[()]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
};
/** 「2025-01-02」 「2025/01/02」 「20250102」 · 엑셀 날짜 일련번호 → YYYY-MM-DD. 날짜가 아니면 null. */
export function toDate(v: unknown): string | null {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = t(v);
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
/** 주민등록번호 꼴(앞 6 · 뒤 7)은 지운다 — 개인정보(사용자 결정: 올릴 때 지움). */
const RRN = /\b\d{6}-?[1-8]\d{6}\b/g;
function maskText(s: string, cnt: { n: number }): string {
  if (!RRN.test(s)) return s;
  RRN.lastIndex = 0;
  cnt.n++;
  return s.replace(RRN, (x) => `${x.slice(0, 6)}-*******`);
}

const norm = (s: unknown) => t(s).replace(/\s+/g, '');

/** 시트의 줄들을 보고 어떤 ERP 분개장인지 · 머리 줄이 어디인지. */
export function detectJournal(rows: unknown[][]): { erp: Erp; head: number } | null {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = rows[i].map(norm);
    if (r.includes('전표일자') && r.includes('전표번호') && r.includes('계정과목') && r.includes('차변') && r.includes('대변')) return { erp: '더존', head: i };
    if (r.some((x) => x.startsWith('구분[기표]')) && i + 1 < rows.length) {
      const r2 = rows[i + 1].map(norm);
      if (r2.includes('년/월/일') && r2.includes('계정과목')) return { erp: '영림원', head: i };
    }
  }
  return null;
}

function douzone(rows: unknown[][], head: number, cnt: { n: number }): { lines: JeLine[]; skipped: number } {
  const h = rows[head].map(norm);
  const at = (name: string, from = 0) => h.indexOf(name, from);
  const cDate = at('전표일자'), cNo = at('전표번호'), cSide = at('구분'), cName = at('계정과목');
  // 계정코드 = 「계정과목」 바로 앞의 Code(또는 계정코드), 거래처코드는 쓰지 않는다(실물의 두 번째 Code 는 관리항목).
  const cCode = h[cName - 1] && /^(code|코드|계정코드)$/i.test(h[cName - 1]) ? cName - 1 : at('계정코드');
  const cDr = at('차변'), cCr = at('대변'), cCp = at('거래처'), cMemo = at('적요');
  const lines: JeLine[] = [];
  let skipped = 0;
  for (const r of rows.slice(head + 1)) {
    const date = toDate(r[cDate]);
    if (!date) { if (r.some((x) => t(x))) skipped++; continue; }
    const no = t(r[cNo]);
    const side = cSide >= 0 ? t(r[cSide]) : null;
    const vtype: VType = side && /^결/.test(side) ? '결산' : side && /^(입금|출금)$/.test(side) ? '입출금' : /^5\d{4}$/.test(no) ? '매입매출' : '일반';
    lines.push({
      seq: lines.length + 1, date, no,
      acctCode: cCode >= 0 ? t(r[cCode]) : '', acctName: t(r[cName]),
      dr: num(r[cDr]), cr: num(r[cCr]),
      cpCode: null, cpName: cCp >= 0 ? (maskText(t(r[cCp]), cnt) || null) : null,
      memo: cMemo >= 0 ? maskText(t(r[cMemo]), cnt) : '',
      side, vtype,
    });
  }
  return { lines, skipped };
}

const ACCT = /^\[(\w+)\]\s*(.*)$/;
function younglimwon(rows: unknown[][], head: number, cnt: { n: number }): { lines: JeLine[]; skipped: number } {
  // 두 줄 머리를 이어 붙인다: 위 줄(병합이라 왼쪽 값을 이어 씀) + 아랫줄.
  const top = rows[head].map(norm), sub = rows[head + 1].map(norm);
  let carry = '';
  const name = sub.map((s, i) => { if (top[i]) carry = top[i]; return `${top[i] || carry}|${s}`; });
  const at = (re: RegExp) => name.findIndex((x) => re.test(x));
  const cDate = at(/^구분\[기표\]\|년\/월\/일$/), cNo = at(/^구분\[기표\]\|번호$/);
  const cDrAmt = at(/^차변\|금액$/), cDrAcct = at(/^차변\|계정과목$/), cCrAcct = at(/^대변\|계정과목$/), cCrAmt = at(/^대변\|금액$/);
  const cMemo = at(/^적요/), cCpCode = at(/^거래처\|코드$/), cCpName = at(/^거래처\|거래처명$/);
  const cADate = at(/^구분\[결의\]\|년\/월\/일$/), cANo = at(/^구분\[결의\]\|번호$/);
  const lines: JeLine[] = [];
  let skipped = 0;
  for (const r of rows.slice(head + 2)) {
    const date = toDate(r[cDate]);
    if (!date) { if (r.some((x) => t(x))) skipped++; continue; }
    const drAcct = t(r[cDrAcct]), crAcct = t(r[cCrAcct]);
    const acct = drAcct || crAcct;
    const m = ACCT.exec(acct);
    lines.push({
      seq: lines.length + 1, date, no: t(r[cNo]),
      acctCode: m ? m[1] : '', acctName: m ? m[2].trim() : acct,
      dr: num(r[cDrAmt]), cr: num(r[cCrAmt]),
      cpCode: cCpCode >= 0 ? (t(r[cCpCode]) || null) : null,
      cpName: cCpName >= 0 ? (maskText(t(r[cCpName]), cnt) || null) : null,
      memo: cMemo >= 0 ? maskText(t(r[cMemo]), cnt) : '',
      side: drAcct ? '차변' : '대변', vtype: '일반',
      apprDate: cADate >= 0 ? toDate(r[cADate]) : null, apprNo: cANo >= 0 ? (t(r[cANo]) || null) : null,
    });
  }
  return { lines, skipped };
}

/** 영림원 「계정별원장」 시트 → 계정별 기초 · 차변 · 대변 · 기말. 잔액 부호는 원장 그대로(계정의 정상 방향이 +). */
export function readLedgerTb(rows: unknown[][]): TbRow[] | null {
  const hi = rows.findIndex((r) => { const n = r.map(norm); return n.includes('계정코드') && n.includes('차변') && n.includes('대변') && n.includes('잔액'); });
  if (hi < 0) return null;
  const h = rows[hi].map(norm);
  const cCode = h.indexOf('계정코드'), cName = h.indexOf('계정명'), cMemo = h.findIndex((x) => x.startsWith('적요')), cDr = h.indexOf('차변'), cCr = h.indexOf('대변'), cBal = h.indexOf('잔액');
  const m = new Map<string, TbRow & { last: number; hasOpen: boolean }>();
  for (const r of rows.slice(hi + 1)) {
    const code = t(r[cCode]);
    if (!code || !/^\w+$/.test(code)) continue;
    const row = m.get(code) ?? { acctCode: code, acctName: t(r[cName]), open: 0, dr: 0, cr: 0, close: 0, last: 0, hasOpen: false };
    if (/전\s*기\s*이\s*월/.test(t(r[cMemo]))) { row.open = num(r[cBal]); row.hasOpen = true; }
    else { row.dr += num(r[cDr]); row.cr += num(r[cCr]); }
    row.close = num(r[cBal]);
    m.set(code, row);
  }
  return [...m.values()].map(({ acctCode, acctName, open, dr, cr, close }) => ({ acctCode, acctName, open, dr, cr, close }));
}

/** 워크북(SheetJS 꼴)에서 분개장을 찾아 읽는다. */
export function parseJournalWorkbook(wb: { SheetNames: string[]; Sheets: Record<string, unknown> }, toRows: (sheet: unknown) => unknown[][]): ParsedJournal {
  const cnt = { n: 0 };
  for (const sheet of wb.SheetNames) {
    const rows = toRows(wb.Sheets[sheet]);
    const d = detectJournal(rows);
    if (!d) continue;
    const { lines, skipped } = d.erp === '더존' ? douzone(rows, d.head, cnt) : younglimwon(rows, d.head, cnt);
    if (!lines.length) continue;
    let tb: TbRow[] | null = null;
    if (d.erp === '영림원') {
      const ls = wb.SheetNames.find((s) => /계정별원장/.test(s));
      if (ls) tb = readLedgerTb(toRows(wb.Sheets[ls]));
    }
    return { erp: d.erp, sheet, lines, tb, skipped, masked: cnt.n };
  }
  throw new Error('분개장을 찾지 못했습니다 — 더존(전표일자 · 전표번호 · 계정과목 · 차변 · 대변) 또는 영림원(구 분[기표] 두 줄 머리) 형식이어야 합니다.');
}

/** 영림원 분개장의 하위 계정(13101)을 원장의 상위 계정(13100)으로 — 원장 코드에 없으면 앞 3자리 + 00. */
export function parentCode(code: string, tbCodes: Set<string>): string {
  if (tbCodes.has(code) || code.length !== 5) return code;
  const p = `${code.slice(0, 3)}00`;
  return tbCodes.has(p) ? p : code;
}

/**
 * 회사 제시 잔액표(기초 · 기말) — 앱이 내려 준 양식이나 비슷한 표. 머리 낱말로 칸을 찾는다:
 * 계정코드 · 계정명(과목) · 전기말(기초) · 당기말(기말) · 묶음 · 차대(차/대). 더존 회사는 재무상태표 금액을 이 양식에 붙여 넣는다.
 */
export interface BalanceInRow { acctCode: string; acctName: string; open: number; close: number; group: string | null; side: 1 | -1 | null }
export function parseBalanceRows(rows: unknown[][]): BalanceInRow[] {
  const hi = rows.findIndex((r) => { const n = r.map(norm); return n.some((x) => /^(계정명|계정과목|과목)$/.test(x)) && n.some((x) => /전기|기초/.test(x)) && n.some((x) => /당기|기말/.test(x)); });
  if (hi < 0) throw new Error('잔액표 머리(계정명 · 전기말(기초) · 당기말(기말))를 찾지 못했습니다 — 앱에서 내려받은 양식을 써 주세요.');
  const h = rows[hi].map(norm);
  const cCode = h.findIndex((x) => /^(계정코드|코드|code)$/i.test(x)), cName = h.findIndex((x) => /^(계정명|계정과목|과목)$/.test(x));
  // 「전기말(기초)」에도 「기말」이 들어 있다 — 당기 칸은 전기 칸이 아닌 것 중에서 찾는다.
  const cOpen = h.findIndex((x) => /전기|기초/.test(x)), cClose = h.findIndex((x, i) => i !== cOpen && !/전기/.test(x) && /당기|기말/.test(x));
  const cGrp = h.findIndex((x) => /^묶음/.test(x)), cSide = h.findIndex((x) => /^차대|^잔액방향/.test(x));
  const out: BalanceInRow[] = [];
  for (const r of rows.slice(hi + 1)) {
    const name = t(r[cName]);
    if (!name || /^(합계|총계|자산총계|부채총계|자본총계|부채와자본총계)$/.test(name.replace(/\s/g, ''))) continue;
    const s = cSide >= 0 ? t(r[cSide]) : '';
    out.push({
      acctCode: cCode >= 0 ? t(r[cCode]) : '', acctName: name,
      open: num(r[cOpen]), close: num(r[cClose]),
      group: cGrp >= 0 ? (t(r[cGrp]) || null) : null,
      side: /^차/.test(s) ? 1 : /^대/.test(s) ? -1 : null,
    });
  }
  return out;
}
