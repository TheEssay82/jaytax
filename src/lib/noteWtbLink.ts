// 주석 노란(당기) 칸을 **올해 정산표에 미리 연결**한다 — 중간감사 때 기말 주석 껍데기를 만들어 두려고(사용자 2026-10-05).
//
// 짝 찾는 법: 작년 감사보고서의 주석 숫자는 이월 정산표의 「전기」 열 숫자와 같다(이월이 작년 확정 숫자를 전기로 민다).
// 그래서 노란 칸의 **작년 값**과 같은 금액이 놓인 정산표 줄을 찾아, 그 줄의 **당기 칸**을 가리키는 수식을 넣는다.
// 정산표 이월의 「전기 금액으로 짝 찾기」와 같은 생각이다.
//
//   찾는 곳 ① 보고서BS·보고서PL — 「11기 | 10기」 열. 재무제표 줄이라 주석이 가리키는 자리다(사람도 주석을 여기 건다).
//          ② WBS·WPL·WMS — 계정 줄 하나, 자산 + 바로 아래 차감계정(순액), 과목 묶음 합(SUMIF).
//   ①에서 하나로 정해지면 ①, 아니면 ②에서 하나일 때만. 둘 이상이면 넣지 않는다(헛연결보다 빈칸이 낫다).
//
// 넣지 않는 칸: 기초 칸(작년 기초는 올해 정산표에 없다), 증감(취득·처분·상각…) 칸과 현금흐름 주석 —
// 흐름이 우연히 잔액과 같은 일이 많다(제이 매도가능증권 취득 = 기말 잔액). 단 손익(PL) 줄과는 흐름도 잇는다(상각비 ↔ 감가상각비).
// 천원 주석은 원으로 적혀 있으므로 정산표 값을 천원에서 반올림해 맞춘다.
import { colName, INDEX_SHEET, type SheetPlan, type SheetCell } from './noteSheet';
import { readLayout } from './wtbRoll';
import type { SheetData } from './xlsxRead';

export interface WtbSource {
  /** 작년(전기) 값 — 원 */ v: number;
  /** 당기 칸을 가리키는 수식(= 없이) */ f: string;
  /** 사람이 읽을 이름 「보고서BS 현금및현금성자산」 */ what: string;
  /** 보고서 시트(재무제표 줄)인가 */ rep: boolean;
  /** 손익 쪽인가 — 흐름 칸과도 이을 수 있다 */ pl: boolean;
}

export interface WtbLink { sheet: string; at: string; note: string; label: string; value: number; to: string; what: string }

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const colNum = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const FLOW = /기초|취득|처분|증가|감소|대체|상각|전입|환입|사용|배당|발행|상환|유입|유출|변동|손상|평가|인수|매각|재분류|신규|회수|지급|납부/;
const OPENING = /기초|전기초|당기초|(^|\D)0?1[.\-/]0?1(\D|$)|1월1일/;
/** 날짜·연도가 적힌 줄(자본변동 표의 「2024년 12월 31일」) — 어느 해 잔액인지 이월 뒤에 믿을 수 없다. */
const DATED = /(19|20)\d\d(년|[.\-/])/;
/** 차이 칸 — 「단수차이」 */
const DIFF = /차이/;
/** 잔액이 아닌 숫자를 다루는 주석 — 약정·우발·담보·보험 금액이 잔액과 우연히 같다(제이 출자약정 = 투자예수금). */
const SKIP_NOTE = /현금흐름|약정|우발|담보|보증|보험/;
const sq = (s: string) => s.replace(/\s+/g, '');

/** 정산표에서 짝 후보를 모은다. prevYear = 작년(이월 정산표의 전기 열 해). */
export function wtbSources(book: SheetData[], prevYear: number | null): WtbSource[] {
  const out: WtbSource[] = [];
  for (const sh of book) {
    const cell = (c: number, r: number) => sh.cells.get(`${colName(c)}${r}`);
    if (/^보고서/.test(sh.name)) {
      const terms = new Map<number, number>(); let hr = 0;
      for (const [ref, c] of sh.cells) {
        const m = /^\s*(?:제\s*)?(\d{1,3})\s*기\s*$/.exec(c.text ?? '');
        if (m) { terms.set(Number(m[1]), colNum(/^[A-Z]+/.exec(ref)![0])); hr = Math.max(hr, Number(/\d+$/.exec(ref)![0])); }
      }
      if (terms.size < 2) continue;
      const cur = Math.max(...terms.keys()); const cc = terms.get(cur)!, pc = terms.get(cur - 1);
      if (pc == null) continue;
      const pl = /PL|손익/.test(sh.name);
      for (const [ref, c] of sh.cells) {
        const r = Number(/\d+$/.exec(ref)![0]);
        if (colNum(/^[A-Z]+/.exec(ref)![0]) !== pc || r <= hr || !c.num) continue;
        const lab = Array.from({ length: Math.min(pc, cc) - 1 }, (_, k) => cell(k + 1, r)?.text ?? '').join(' ').replace(/\s+/g, ' ').trim();
        out.push({ v: c.num, f: `${q(sh.name)}!${colName(cc)}${r}`, what: `${sh.name} ${lab}`.trim(), rep: true, pl });
      }
      continue;
    }
    const L = readLayout(sh); if (!L) continue;
    const pc = prevYear != null ? L.history.get(prevYear) : undefined;
    if (pc == null) continue;
    const pl = L.kind !== 'BS';
    const num = (r: number) => cell(pc, r)?.num ?? 0;
    const txt = (c: number | null, r: number) => (c == null ? '' : (cell(c, r)?.text ?? '').trim());
    const adj = (r: number) => `${q(sh.name)}!${colName(L.adj)}${r}`;
    const groups = new Map<string, number[]>();
    L.accounts.forEach((r, i) => {
      const v = num(r);
      if (v) out.push({ v, f: adj(r), what: `${sh.name} ${txt(L.acct, r)}`, rep: false, pl });
      const r2 = L.accounts[i + 1];                                   // 자산 + 바로 아래 차감계정
      if (r2 != null && /누계액|충당금|손상차손|현재가치할인|국고보조금/.test(txt(L.acct, r2)) && !/누계액|충당금/.test(txt(L.acct, r))) {
        const s = v + num(r2);
        if (s) out.push({ v: s, f: `${adj(r)}+${adj(r2)}`, what: `${sh.name} ${txt(L.acct, r)} − ${txt(L.acct, r2)}`, rep: false, pl });
      }
      const g = txt(L.fsli, r); if (g) groups.set(g, [...(groups.get(g) ?? []), r]);
    });
    if (L.fsli != null) {
      const fc = colName(L.fsli), ac = colName(L.adj);
      for (const [g, rows] of groups) {
        if (rows.length < 2) continue;
        const v = rows.reduce((s, r) => s + num(r), 0);
        if (v) out.push({ v, f: `SUMIF(${q(sh.name)}!${fc}:${fc},"${g.replace(/"/g, '""')}",${q(sh.name)}!${ac}:${ac})`, what: `${sh.name} 과목 「${g}」 합`, rep: false, pl });
      }
    }
  }
  return out;
}

/**
 * rolled = 이월한 배치(노란 칸이 당기), plain = 이월하지 않은 배치(같은 자리에 작년 값). 자리는 둘이 같다(noteLink 참고).
 * 이미 수식이 든 노란 칸(표준주석엑셀에서 이어받은 것)은 건드리지 않는다.
 */
export function linkToWtb(rolled: SheetPlan[], plain: SheetPlan[], src: WtbSource[]):
  { plans: SheetPlan[]; links: WtbLink[]; ambiguous: number } {
  const links: WtbLink[] = []; let ambiguous = 0;
  const plans = rolled.map((p, i) => {
    const pl = plain[i];
    if (!pl || SKIP_NOTE.test(p.note ?? p.name)) return p;
    const was = new Map(pl.cells.map((c) => [`${c.row}:${c.col}`, c]));
    const label = new Map<number, string>();
    for (const c of p.cells) if (c.col === 3 && c.kind !== 'input' && c.text) label.set(c.row, c.text.trim());
    const heads = p.cells.filter((c) => c.kind === 'head');
    const headOf = (c: SheetCell) => heads.filter((h) => h.col === c.col && h.row < c.row).map((h) => h.text).join(' ');
    const cells = p.cells.map((c) => {
      if (c.kind !== 'input' || c.formula != null) return c;
      const v = was.get(`${c.row}:${c.col}`)?.num;
      if (v == null || Math.abs(v) < 10000) return c;
      const lab = label.get(c.row) ?? '', head = headOf(c);
      const L = sq(lab), Hd = sq(head);
      if (OPENING.test(L) || /기초/.test(Hd) || DATED.test(L) || DIFF.test(Hd)) return c;
      const flow = FLOW.test(L) || FLOW.test(Hd);
      const k = v % 1000 === 0 ? 1000 : 1;
      const hit = src.filter((s) => (!flow || s.pl) && Math.round(Math.abs(s.v) / k) * k === Math.abs(v));
      const uniq = (xs: WtbSource[]) => [...new Map(xs.map((x) => [x.f, x])).values()];
      const rep = uniq(hit.filter((s) => s.rep));
      const pick = rep.length ? rep : uniq(hit);
      if (pick.length !== 1) { if (pick.length > 1) ambiguous++; return c; }
      const s = pick[0];
      const f = Math.sign(s.v) === Math.sign(v) ? s.f : `-(${s.f})`;
      links.push({ sheet: p.name, at: `${colName(c.col)}${c.row}`, note: p.note ?? p.name, label: [lab, head].filter(Boolean).join(' · '), value: v, to: f, what: s.what });
      return { ...c, formula: f, kind: 'linked' as const };
    });
    return { ...p, cells };
  });
  return { plans, links, ambiguous };
}

/** 「정산표 연결」 확인 시트 — 무엇을 어디에 이었는지. 칸을 누르면 그 주석 칸으로 간다. */
export function linkListSheet(links: WtbLink[], name = '정산표연결'): SheetPlan {
  const cells: SheetCell[] = [
    { row: 1, col: 2, text: '◀ 주석목록', kind: 'link', link: INDEX_SHEET },
    { row: 2, col: 2, text: '정산표연결', kind: 'title' },
    { row: 3, col: 2, text: `작년 금액이 같은 정산표 줄을 찾아 당기 칸에 수식을 걸었습니다(${links.length}칸, 파란 칸). 틀린 짝은 그 칸을 지우고 노란 칸처럼 채우십시오.`, kind: 'para' },
    ...['주석', '칸', '항목', '작년 값', '연결한 정산표 줄', '수식'].map((t, k) => ({ row: 5, col: 2 + k, text: t, kind: 'head' as const })),
  ];
  links.forEach((l, i) => {
    const r = 6 + i;
    cells.push(
      { row: r, col: 2, text: l.note, kind: 'text' },
      { row: r, col: 3, text: l.at, kind: 'link', link: l.sheet, linkAt: l.at },
      { row: r, col: 4, text: l.label, kind: 'text' },
      { row: r, col: 5, text: '', num: l.value, kind: 'num' },
      { row: r, col: 6, text: l.what, kind: 'text' },
      { row: r, col: 7, text: `=${l.to}`, kind: 'text' },
    );
  });
  return { name, cells, lastRow: 5 + links.length };
}

/**
 * 정산표에 붙어 있는 **옛 작업 시트** 후보 — 정산표 표(WBS·WPL·WMS)·보고서·자본변동표·현금흐름표·A500 이 아니고,
 * 남은 시트의 수식이 가리키지 않는 시트. refBy 가 있으면 지울 수 없다(그 시트가 #REF! 가 된다).
 */
export function leftoverSheets(book: SheetData[], drop: Set<string> = new Set()): { name: string; refBy: string[]; core: boolean }[] {
  const core = (sh: SheetData) => /^(보고서|SCE|SCF|WCF|A500|WBS|WPL|WMS)/i.test(sh.name) || !!readLayout(sh);
  return book.map((sh) => {
    const refBy = book.filter((o) => o.name !== sh.name && !drop.has(o.name)).filter((o) => [...o.cells.values()].some((c) =>
      c.formula && (c.formula.includes(`${q(sh.name)}!`) || new RegExp(`(^|[^A-Za-z0-9_가-힣.'])${sh.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}!`).test(c.formula)))).map((o) => o.name);
    return { name: sh.name, refBy, core: core(sh) };
  });
}
