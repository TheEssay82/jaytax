// 정산표 검증표 — 만들 정산표(WBS·WPL)의 합계를 수식대로 계산해 회사 재무제표와 맞춰 본다(사용자 2026-10-28
// 「특정 계정을 (-)로 읽는 것도 중요하지만 WBS·WPL 의 검증값을 확인해서 미리 보여주는 기능도 필요」).
//   ① WBS 차대       회사제시 열 자산총계 = 부채및자본총계
//   ② WBS ↔ 회사 BS  자산·부채·자본총계
//   ③ WPL ↔ 회사 PL  매출총이익·영업이익·당기순이익
//   ④ WBS ↔ WPL      이익잉여금 증감(회사제시 − 전기) = WPL 당기순이익
// 정산표 파일의 칸 값(캐시)은 엑셀이 다시 계산하기 전 옛 숫자일 수 있어 쓰지 않는다 — SUM·사칙연산을 직접 계산한다.
import type { SheetData } from './xlsxRead';
import { colName, colNum } from './xlsxCols';
import { readLayout, type TableLayout, type TbLine } from './wtbRoll';

export interface WtbCheck {
  group: string;
  label: string;
  /** 정산표 값 */ ours: number | null;
  /** 맞춰 볼 값 */ theirs: number | null;
  /** 맞춰 볼 값의 출처 */ basis: string;
  ok: boolean | null;
  note?: string;
}
export interface WtbCheckResult { checks: WtbCheck[]; /** 전기와 부호가 반대인 계정 줄 — 어긋날 때 먼저 볼 곳 */ flipped: string[] }

const norm = (s: string | undefined) => (s ?? '').replace(/[\s.·/]/g, '');
const bare = (s: string | undefined) => norm((s ?? '').replace(/^\s*([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+|[IVX]+\s*\.)\.?\s*/, ''));

/** 칸 계산기 — 숫자, 칸·범위 참조(다른 시트 포함), + − × ÷, SUM·ROUND·ABS. 모르는 함수면 null. */
export function makeEval(book: SheetData[]) {
  const byName = new Map(book.map((s) => [s.name, s]));
  const memo = new Map<string, number | null>();
  const busy = new Set<string>();
  const cell = (sheet: string, ref: string): number | null => {
    const key = `${sheet}!${ref}`;
    if (memo.has(key)) return memo.get(key)!;
    const v = byName.get(sheet)?.cells.get(ref);
    let out: number | null;
    if (!v) out = 0;
    else if (!v.formula) out = v.num ?? 0;
    else if (busy.has(key)) out = null;
    else { busy.add(key); out = formula(v.formula, sheet); busy.delete(key); }
    memo.set(key, out);
    return out;
  };
  const formula = (f: string, sheet: string): number | null => {
    const toks = f.match(/'[^']+'!\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?|[^\s!(),+\-*/:'"=<>&^]+!\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?|\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?|\d+(?:\.\d+)?%?|[A-Z][A-Z0-9.]*(?=\()|[()+\-*/,]|\S/g) ?? [];
    let i = 0;
    const fail = () => { throw new Error('모름'); };
    const range = (t: string): number[] => {
      const bang = t.lastIndexOf('!');
      const sh = bang >= 0 ? t.slice(0, bang).replace(/^'|'$/g, '') : sheet;
      const [a, b] = t.slice(bang + 1).replace(/\$/g, '').split(':');
      const ca = colNum(a.replace(/\d+/, '')), ra = Number(a.replace(/[A-Z]+/, ''));
      const cb = b ? colNum(b.replace(/\d+/, '')) : ca, rb = b ? Number(b.replace(/[A-Z]+/, '')) : ra;
      const out: number[] = [];
      for (let c = Math.min(ca, cb); c <= Math.max(ca, cb); c++) for (let r = Math.min(ra, rb); r <= Math.max(ra, rb); r++) {
        const x = cell(sh, `${colName(c)}${r}`); if (x == null) fail(); out.push(x!);
      }
      return out;
    };
    const isRef = (t: string) => /(^|!)\$?[A-Z]{1,3}\$?\d+(:\$?[A-Z]{1,3}\$?\d+)?$/.test(t);
    const args = (): number[][] => {
      const out: number[][] = [];
      if (toks[i] === ')') { i++; return out; }
      for (;;) {
        const t = toks[i];
        if (t && isRef(t) && (toks[i + 1] === ',' || toks[i + 1] === ')')) { i++; out.push(range(t)); } else out.push([expr()]);
        const sep = toks[i++];
        if (sep === ')') return out;
        if (sep !== ',') fail();
      }
    };
    const factor = (): number => {
      const t = toks[i++];
      if (t == null) fail();
      if (t === '+') return factor();
      if (t === '-') return -factor();
      if (t === '(') { const v = expr(); if (toks[i++] !== ')') fail(); return v; }
      if (/^\d/.test(t)) return t.endsWith('%') ? Number(t.slice(0, -1)) / 100 : Number(t);
      if (toks[i] === '(' && /^[A-Z]/.test(t) && !isRef(t)) {
        i++;
        const a = args();
        const flat = a.flat();
        if (t === 'SUM') return flat.reduce((x, y) => x + y, 0);
        if (t === 'ABS') return Math.abs(flat[0]);
        if (t === 'ROUND') { const p = 10 ** (a[1]?.[0] ?? 0); return Math.round(a[0][0] * p) / p; }
        fail();
      }
      if (isRef(t)) { const v = range(t); if (v.length !== 1) fail(); return v[0]; }
      return fail() as never;
    };
    const term = (): number => { let v = factor(); while (toks[i] === '*' || toks[i] === '/') { const op = toks[i++]; const w = factor(); v = op === '*' ? v * w : v / w; } return v; };
    const expr = (): number => { let v = term(); while (toks[i] === '+' || toks[i] === '-') { const op = toks[i++]; const w = term(); v = op === '+' ? v + w : v - w; } return v; };
    try { const v = expr(); return i === toks.length && Number.isFinite(v) ? v : null; } catch { return null; }
  };
  return cell;
}

/** 표 머리글(B열 「자산총계」「Ⅹ.당기순이익」) 줄 — 맞는 것 가운데 마지막. */
function rowOfHead(sh: SheetData, L: TableLayout, re: RegExp): number {
  let found = 0;
  for (let r = L.dateRow + 1; r <= L.last; r++) {
    const t = bare(sh.cells.get(`${colName(L.headCol)}${r}`)?.text) || bare(sh.cells.get(`${colName(L.acct)}${r}`)?.text);
    if (re.test(t)) found = r;
  }
  return found;
}

/**
 * 검증표. book = 만들 정산표(이월·기말 갱신 결과), tb = 회사 자료 줄(합계 줄 포함), prevYear = 작년(전기 열의 해).
 */
export function wtbChecks(book: SheetData[], tb: TbLine[], prevYear: number): WtbCheckResult {
  const ev = makeEval(book);
  const checks: WtbCheck[] = [];
  const flipped: string[] = [];
  const tables = book.map((sh) => ({ sh, L: readLayout(sh) })).filter((x): x is { sh: SheetData; L: TableLayout } => !!x.L);
  const wbs = tables.find((t) => t.L.kind === 'BS'), wpl = tables.find((t) => t.L.kind === 'PL');
  const at = (t: { sh: SheetData; L: TableLayout }, col: number, r: number) => (r ? ev(t.sh.name, `${colName(col)}${r}`) : null);
  const push = (group: string, label: string, ours: number | null, theirs: number | null, basis: string, note?: string) =>
    checks.push({ group, label, ours, theirs, basis, ok: ours == null || theirs == null ? null : Math.abs(Math.round(ours) - Math.round(theirs)) < 1, note });

  // 회사 자료 쪽 — 시산표면 계정 합으로, 재무제표면 적힌 합계(없으면 계정 합)로.
  const hasTb = tb.some((t) => t.src === 'TB');
  const lines = tb.filter((t) => !t.subtotal);
  const sum = (sec: TbLine['section']) => lines.filter((t) => t.section === sec && (hasTb ? t.src === 'TB' : t.src === 'BS' || t.src === 'PL')).reduce((a, t) => a + t.bal, 0);
  const ni = -lines.filter((t) => t.section === '손익').reduce((a, t) => a + t.bal, 0);
  const printed = (re: RegExp, sec: TbLine['section'][]) => {
    const t = [...tb].reverse().find((x) => x.subtotal && sec.includes(x.section) && re.test(bare(x.name)));
    if (!t) return null;
    if (t.section === '손익') return /손실$/.test(bare(t.name)) && t.bal > 0 ? -t.bal : t.bal;
    return t.section === '자산' ? t.bal : -t.bal;
  };
  const src = hasTb ? '시산표 계정 합' : '회사 재무상태표';

  if (wbs) {
    const C = wbs.L.cur;
    const rA = rowOfHead(wbs.sh, wbs.L, /^자산총계$/), rL = rowOfHead(wbs.sh, wbs.L, /^부채총계$/), rE = rowOfHead(wbs.sh, wbs.L, /^자본총계$/), rLE = rowOfHead(wbs.sh, wbs.L, /^부채(와|및)?자본총계$/);
    const A = at(wbs, C, rA), Lb = at(wbs, C, rL), E = at(wbs, C, rE);
    const LE = rLE ? at(wbs, C, rLE) : Lb != null && E != null ? Lb + E : null;
    push('① WBS 차대', '자산총계 = 부채및자본총계', A, LE, 'WBS 회사제시 열');
    const pA = printed(/^자산총계$/, ['자산']), pL = printed(/^부채총계$/, ['부채']), pE = printed(/^자본총계$/, ['자본']);
    const cA = hasTb || pA == null ? sum('자산') : pA;
    const cL = hasTb || pL == null ? -sum('부채') : pL;
    const cE = hasTb ? -sum('자본') + ni : pE ?? -sum('자본');
    push('② WBS ↔ 회사 재무상태표', '자산총계', A, cA, hasTb || pA == null ? `${src}(계정 합)` : src);
    push('② WBS ↔ 회사 재무상태표', '부채총계', Lb, cL, hasTb || pL == null ? `${src}(계정 합)` : src);
    push('② WBS ↔ 회사 재무상태표', '자본총계', E, cE, hasTb ? '시산표 계정 합 + 당기순이익' : pE == null ? `${src}(계정 합)` : src);
  }

  let wplNi: number | null = null;
  if (wpl) {
    const C = wpl.L.cur;
    for (const [label, re, pre] of [
      ['매출총이익', /^매출총(이익|손실|손익)$/, /^매출총(이익|손실|손익)$/],
      ['영업이익', /^영업(이익|손실|손익)$/, /^영업(이익|손실|손익)$/],
      ['당기순이익', /^당기순(이익|손실|손익)$/, /^당기순(이익|손실|손익)$/],
    ] as const) {
      const v = at(wpl, C, rowOfHead(wpl.sh, wpl.L, re));
      if (label === '당기순이익') wplNi = v;
      const p = hasTb ? null : printed(pre, ['손익']);
      if (label !== '당기순이익' && p == null) continue;     // 시산표엔 중간 이익이 없다
      push('③ WPL ↔ 회사 손익계산서', label, v, p ?? ni, p != null ? '회사 손익계산서' : '회사 자료 손익 계정 합');
    }
  }

  if (wbs && wpl) {
    const pc = wbs.L.history.get(prevYear);
    const re = wbs.L.accounts.filter((r) => /이익잉여금|결손금/.test(bare(wbs.sh.cells.get(`${colName(wbs.L.acct)}${r}`)?.text) + bare(wbs.sh.cells.get(`${colName(wbs.L.headCol)}${r}`)?.text)));
    if (pc != null && re.length) {
      let d: number | null = 0;
      for (const r of re) { const a = at(wbs, wbs.L.cur, r), b = at(wbs, pc, r); d = d == null || a == null || b == null ? null : d + a - b; }
      push('④ WBS ↔ WPL', '이익잉여금 증감 = 당기순이익', d, wplNi, 'WPL 회사제시 당기순이익', '배당 · 적립금 같은 처분이 있었으면 그만큼 차이 납니다');
    }
  }

  // 전기와 부호가 반대인 줄 — 차감 계정을 거꾸로 읽었을 때 여기 뜬다(매출할인 +2억 ← 전기 −2.4억).
  for (const t of [wbs, wpl]) {
    if (!t) continue;
    const pc = t.L.history.get(prevYear);
    if (pc == null) continue;
    for (const r of t.L.accounts) {
      const a = t.sh.cells.get(`${colName(t.L.cur)}${r}`), b = t.sh.cells.get(`${colName(pc)}${r}`);
      if (a?.formula || b?.formula || !a?.num || !b?.num || Math.sign(a.num) === Math.sign(b.num)) continue;
      const name = (t.sh.cells.get(`${colName(t.L.acct)}${r}`)?.text ?? t.sh.cells.get(`${colName(t.L.headCol)}${r}`)?.text ?? '').trim();
      flipped.push(`${t.L.sheet} ${r}행 ${name} ${a.num.toLocaleString('ko-KR')} (전기 ${b.num.toLocaleString('ko-KR')})`);
    }
  }
  return { checks, flipped };
}
