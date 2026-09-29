// 웹 조서 2110 감사계획의 수립 — 1차 확정(중간감사 전).
//
// 두 모양을 읽고 쓴다.
//  ① 소규모(명진 FY25 실측) — 값이 **A열 글자 안에** 있다:
//     「감사계획: 2025.4.14」 「(1) 감사목적과범위：일반( V), 임의( )」 「국문( 10 부), 영문( -부)」
//     「-상기 파악한 내용의 기재 : 해당사항없음 -또는 별도의 조서에서 검토 : 조서번호 ( 2110A)」
//     글자의 문구 부분은 그대로 두고 **값 부분만** 바꿔 쓴다. 수행자는 F열.
//  ② 일반·K-IFRS(2026 양식·알티스트 실측, 2026-09-28) — A열은 「감사계획:」 까지, **값은 B열**
//     (날짜는 날짜 칸, 실사장소는 2100A 링크일 수 있다). 항목의 조서번호 F · 수행자 G · 비고 H.
// 줄마다 A열 콜론 뒤에 값이 있으면 ①, 없으면 ② 로 본다.
import type { SheetData, CellValue } from './xlsxRead';
import { excelSerial, type CellEdit } from './xlsxCells';
import { isoDate } from './gwpCatalog';
import { normLabel, textOf, colOf, rowOf, findHeader, type WebPaperDef } from './gwpWeb';

export interface TeamItem { label: string; performer: string; text: string; ref: string }
export interface LineValue { label: string; value: string }
export interface Paper2110 {
  /** (감사팀의 구성) 항목 — 수행자, 파악한 내용(①기재 줄 · ②비고), 별도 조서번호 */ team: TeamItem[];
  /** 「1 주요감사계약 내용의 확인」 수행자 */ contractPerformer: string;
  /** ① 일반( V)·임의( ) */ scope: '일반' | '임의' | '';
  /** ② 감사목적과 범위 글(「일반비상장」·「유가증권상장」) — ①이면 없음 */ scopeText?: string;
  /** ② 연결재무제표 감사 여부(여·부) */ consolidated?: string;
  /** 감사계획·중간감사·재고 실사입회·조회절차·기말감사(②는 연결감사까지) */ schedule: LineValue[];
  /** 본사·공장/지점 */ sites: LineValue[];
  reportDue: string;
  copiesKo: string;
  copiesEn: string;
}

const SCHEDULE = ['감사계획', '중간감사', '재고 실사입회', '조회절차', '기말감사', '연결감사'];
const SITES = ['본사', '공장/지점'];

type Line = { row: number; ref: string; text: string };
function linesA(sheet: SheetData): Line[] {
  const out: Line[] = [];
  for (const [ref, v] of sheet.cells) if (colOf(ref) === 'A' && v.formula == null && textOf(v)) out.push({ row: rowOf(ref), ref, text: textOf(v) });
  return out.sort((a, b) => a.row - b.row);
}
/** 「라벨: 값」 줄 — 첫 콜론까지를 머리로 본다. */
const COLON = /[:：]/;
function splitAt(text: string): { head: string; value: string } | null {
  const t = text.replace(/^\s+/, '');
  const m = COLON.exec(t);
  if (!m) return null;
  return { head: t.slice(0, m.index + 1), value: t.slice(m.index + 1).trim() };
}
function splitLabel(text: string, label: string): { head: string; value: string } | null {
  return normLabel(text).startsWith(normLabel(label)) ? splitAt(text) : null;
}
const TEAM_RE = /(기재\s*[:：])([\s\S]*?)(-\s*또는\s*별도의\s*조서에서\s*검토\s*[:：]\s*조서번호\s*\()([\s\S]*?)(\))/;

function findLine(lines: Line[], label: string, after = 0): Line | null {
  return lines.find((l) => l.row > after && splitLabel(l.text, label)) ?? null;
}
const has = (lines: Line[], word: string, after = 0) => lines.find((l) => l.row > after && normLabel(l.text).includes(normLabel(word))) ?? null;

/** B열 값 — 날짜 칸은 2026-01-05 로. */
function cellValue(v: CellValue | undefined): string {
  if (!v) return '';
  if (v.num != null && !v.text) return isoDate(v) || String(v.num);
  return textOf(v);
}

function layout(sheet: SheetData) {
  const lines = linesA(sheet);
  const h = findHeader(sheet, ['항 목', '수행자']);
  const perfCol = h?.cols['수행자'] ?? 'F';
  const hx = findHeader(sheet, ['항 목', '조서번호', '수행자', '비고']);
  const refCol = hx?.cols['조서번호'] ?? null, noteCol = hx?.cols['비고'] ?? null;
  const teamHead = lines.find((l) => normLabel(l.text).includes('(감사팀의구성)'));
  const team: { item: Line; detail: Line | null }[] = [];
  if (teamHead) {
    for (const l of lines.filter((x) => x.row > teamHead.row)) {
      const t = l.text.trim();
      if (/^\([^\d)]/.test(t)) break;                         // 다음 묶음 「(업무의 지휘/감독 …)」
      if (!/^\d+\s*[.\s]/.test(t)) continue;
      const d = lines.find((x) => x.row > l.row && x.row <= l.row + 2 && TEAM_RE.test(x.text)) ?? null;
      team.push({ item: l, detail: d });
    }
  }
  const contract = lines.find((l) => /^1\s*주요감사계약/.test(l.text.replace(/\s+/g, ' ').trim())) ?? null;
  const scope = has(lines, '감사목적과범위');
  const consol = has(lines, '연결재무제표감사여부');
  const sched = has(lines, '감사일정');
  const siteHead = has(lines, '실사장소');
  const due = has(lines, '감사보고서제출예정일');
  const copies = lines.find((l) => /국문\s*\(/.test(l.text)) ?? null;       // ① 「국문( 10 부), 영문( -부)」
  const ko = copies ? null : lines.find((l) => normLabel(l.text) === '국문') ?? null;   // ② 「국문」 | B 「30부」
  const en = copies ? null : lines.find((l) => normLabel(l.text) === '영문') ?? null;
  return {
    perfCol, refCol, noteCol, team, contract, scope, consol, copies, ko, en, due,
    schedule: SCHEDULE.map((lab) => ({ lab, line: findLine(lines, lab, sched?.row ?? 0) })),
    sites: SITES.map((lab) => ({ lab, line: findLine(lines, lab, siteHead?.row ?? 0) })),
  };
}

/** 한 줄의 값 — A열 콜론 뒤(①) 또는 B열(②). */
function lineValue(sheet: SheetData, ln: Line | null): { value: string; inB: boolean } {
  if (!ln) return { value: '', inB: false };
  const a = splitAt(ln.text)?.value ?? '';
  const b = sheet.cells.get(`B${ln.row}`);
  if (a || !b) return { value: a, inB: false };
  return { value: cellValue(b), inB: true };
}
const bCell = (ref: string, v: string): CellEdit => {
  const t = v.trim();
  const n = excelSerial(t);
  return !t ? { ref, clear: true } : n != null ? { ref, num: n } : { ref, text: t };
};
const copiesOf = (s: string) => s.replace(/\s*부$/, '').trim();

// ── 소규모 → 일반(사용자 2026-09-30 에이치앤아비즈 「2110(소규모)가 있는데 왜 자동복사되지 않았을까」)
// 소규모는 값이 A열 글자 안(①), 일반은 B·G·H 열(②)이라 칸 짝짓기로는 두 칸만 옮겨졌고, 나머지는 양식 **예시 문구**(유가증권상장·
// 2020년 9월·서초구 XXX·김품감)가 남았다. 보이는 일반 2110 이 아직 양식 그대로면 숨긴 「2110(소규모)」에서 값을 가져온다.
const EXAMPLE_MARK = /XXX|20X1|김품감/;
const teamKey = (label: string) => {
  const t = normLabel(label);
  return /적격성|역량/.test(t) ? 'comp' : /품질관리검토자/.test(t) ? 'eqr' : /업무수행이사/.test(t) ? 'lead' : /전문가/.test(t) ? 'expert' : /내부감사인|서비스조직/.test(t) ? 'internal' : t;
};
const nextYear = (s: string) => s.replace(/20(\d\d)/g, (_m, y: string) => `20${String(Number(y) + 1).padStart(2, '0')}`);
/** 결산연도에 하는 일정(계획·중간·실사) — 나머지(조회·기말·연결·보고서)는 이듬해. */
const IN_FY = new Set(['감사계획', '중간감사', '재고 실사입회']);

/** 표지의 결산일(B15 날짜 칸, 없으면 B16 대상기간 끝) → 결산연도. */
export function closingYear(sheets: SheetData[]): number | null {
  const c = sheets.find((s) => normLabel(s.name).includes('조서표지'));
  const b15 = c?.cells.get('B15');
  if (b15?.num != null) return new Date(Date.UTC(1899, 11, 30) + b15.num * 86400000).getUTCFullYear();
  const m = /(20\d\d)\D*$/.exec(textOf(c?.cells.get('B16')));
  return m ? Number(m[1]) : null;
}

/**
 * 일반 2110(양식 그대로) + 작년 소규모 2110 → 일반 모양의 올해 값.
 * 날짜는 결산연도(fy)에 맞춘다 — 한 해 올리기로 하면 이월 때 이미 올라간 결산일(2025.12.31 → 2026.12.31)이 또 올라갔다(아비즈).
 */
export function from2110Small(small: Paper2110, general: Paper2110, fy: number | null = null): Paper2110 {
  const setYear = (v: string, y: number) => (fy == null ? nextYear(v) : v.replace(/20\d\d/g, String(y)));
  return {
    ...general,
    team: general.team.map((g) => {
      const s = small.team.find((x) => teamKey(x.label) === teamKey(g.label));
      // 조서번호 칸에 숫자가 없으면(칸 자리로 옮겨 들어간 수행자 이름 「정우철」) 버린다.
      const ref = /\d/.test(g.ref) ? g.ref : '';
      return s ? { ...g, ref, performer: s.performer, text: s.text } : { ...g, ref, performer: '', text: '' };
    }),
    contractPerformer: small.contractPerformer || '',
    scope: small.scope,
    scopeText: small.scope === '임의' ? '임의감사' : '일반외감',
    consolidated: '부',
    schedule: general.schedule.map((g) => ({
      label: g.label,
      value: g.label === '연결감사' ? 'N/A' : setYear(small.schedule.find((x) => x.label === g.label)?.value ?? '', (fy ?? 0) + (IN_FY.has(g.label) ? 0 : 1)),
    })),
    sites: general.sites.map((g) => ({ label: g.label, value: small.sites.find((x) => x.label === g.label)?.value ?? '' })),
    reportDue: setYear(small.reportDue, (fy ?? 0) + 1),
    copiesKo: small.copiesKo, copiesEn: small.copiesEn,
  };
}

/**
 * 올해 양식 2110 의 **예시 문구** — 칸 열 + 글자. 회사 시트에서 같은 열에 글자 그대로 남은 칸만 지운다(사용자 2026-09-30 「(가)」).
 *   · 비고(H) 열의 예시 · 계약 확인 묶음의 B열 예시 값(유가증권상장·2020년 9월·서초구 XXX)
 *   · 「2 회사에 대한 이해 및 감사위험에 대한 예비적 평가」 ~ 「3 통제테스트 계획」 사이의 예시 줄(「- …」·「1) …」·(사례n)과 그 다음 줄)
 */
export function examples2110(tpl: SheetData): { col: string; text: string }[] {
  const lines = linesA(tpl);
  const out: { col: string; text: string }[] = [];
  const hx = findHeader(tpl, ['항 목', '조서번호', '수행자', '비고']);
  if (hx?.cols['비고']) {
    const nc = hx.cols['비고'];
    for (const [ref, v] of tpl.cells) if (colOf(ref) === nc && rowOf(ref) > hx.row && v.formula == null && textOf(v) && normLabel(textOf(v)) !== '비고') out.push({ col: nc, text: textOf(v) });
  }
  const from = has(lines, '감사목적과범위'), to = has(lines, '감사보고서제출예정일');
  if (from && to) {
    for (const [ref, v] of tpl.cells) {
      const r = rowOf(ref);
      if (colOf(ref) === 'B' && r >= from.row && r <= to.row + 3 && v.formula == null && textOf(v)) out.push({ col: 'B', text: textOf(v) });
    }
  }
  const s = lines.find((l) => /^2\s*회사에\s*대한\s*이해/.test(l.text.trim()));
  const e = lines.find((l) => s && l.row > s.row && /^3\s*통제테스트/.test(l.text.trim()));
  if (s && e) {
    // 양식의 예시 줄 일부는 다른 양식 파일로 걸린 수식(「- 경기 회복에 따라…」 = '[13]2100A'!A144)이다 — 옮겨 심을 때 글자로 바뀌므로 수식 칸의 글자도 본다.
    const withF: Line[] = [];
    for (const [ref, v] of tpl.cells) if (colOf(ref) === 'A' && textOf(v)) withF.push({ row: rowOf(ref), ref, text: textOf(v) });
    withF.sort((a, b) => a.row - b.row);
    let afterCase = false;
    for (const l of withF.filter((x) => x.row > s.row && x.row < e.row)) {
      const t = l.text.trim();
      if (/^\(사례\s*\d+\)/.test(t)) { out.push({ col: 'A', text: l.text }); afterCase = true; continue; }
      if (/^-\s*\S/.test(t) || /^\d+\)\s*\S/.test(t) || afterCase) out.push({ col: 'A', text: l.text });
      afterCase = false;
    }
  }
  return out;
}

export const PAPER_2110: WebPaperDef<Paper2110> = {
  code: '2110', title: '감사계획의 수립', stage: 1, sheetCode: '2110',
  note: '감사팀 구성·감사일정·실사장소·보고서 예정일. 일정은 단계 보드에도 보인다.',
  empty: () => ({ team: [], contractPerformer: '', scope: '일반', schedule: SCHEDULE.slice(0, 5).map((label) => ({ label, value: '' })), sites: SITES.map((label) => ({ label, value: '' })), reportDue: '', copiesKo: '', copiesEn: '' }),
  readBook(sheets) {
    const mine = sheets.filter((s) => /^2110(\(소규모\))?$/.test(s.name.replace(/\s/g, '')));
    const general = mine.find((s) => !s.hidden && !/소규모/.test(s.name)) ?? mine.find((s) => !s.hidden) ?? mine[0];
    if (!general) return PAPER_2110.empty();
    const g = PAPER_2110.read(general);
    const small = mine.find((s) => s !== general && /소규모/.test(s.name));
    const stillTemplate = [...general.cells.values()].some((v) => EXAMPLE_MARK.test(textOf(v)));
    return small && stillTemplate ? from2110Small(PAPER_2110.read(small), g, closingYear(sheets)) : g;
  },
  scrub(sheet, tpl) {
    // 아직 양식 예시가 남은 시트만 — 회사가 손본 시트의 짧은 값(「10부」·「여」)이 우연히 예시와 같아도 지우지 않게.
    if (![...sheet.cells.values()].some((v) => EXAMPLE_MARK.test(textOf(v)))) return [];
    const ex = examples2110(tpl);
    if (!ex.length) return [];
    const key = new Set(ex.map((x) => `${x.col}|${x.text.trim()}`));
    const e: CellEdit[] = [];
    for (const [ref, v] of sheet.cells) if (v.formula == null && key.has(`${colOf(ref)}|${textOf(v)}`)) e.push({ ref, clear: true });
    // 조서번호 열의 숫자 없는 글자 — 소규모의 수행자 열(F)이 칸 자리로 들어와 남은 이름(「정우철」).
    const hx = findHeader(sheet, ['항 목', '조서번호', '수행자', '비고']);
    const rc = hx?.cols['조서번호'];
    if (rc) for (const [ref, v] of sheet.cells) if (colOf(ref) === rc && rowOf(ref) > hx!.row && v.formula == null && textOf(v) && !/\d/.test(textOf(v)) && normLabel(textOf(v)) !== '조서번호') e.push({ ref, clear: true });
    return e;
  },
  read(sheet) {
    const L = layout(sheet);
    const at = (col: string | null, row: number) => (col ? textOf(sheet.cells.get(`${col}${row}`)) : '');
    const scopeText = L.scope?.text ?? '';
    const marked = (w: string) => new RegExp(`${w}\\s*\\(\\s*[VvOo✓√]\\s*\\)`).test(scopeText);
    const scopeB = /일반\s*\(/.test(scopeText) ? null : lineValue(sheet, L.scope);
    const d: Paper2110 = {
      team: L.team.map(({ item, detail }) => {
        const m = detail ? TEAM_RE.exec(detail.text) : null;
        return detail
          ? { label: item.text, performer: at(L.perfCol, item.row), text: (m?.[2] ?? '').trim(), ref: (m?.[4] ?? '').trim() }
          : { label: item.text, performer: at(L.perfCol, item.row), text: at(L.noteCol, item.row), ref: at(L.refCol, item.row) };
      }),
      contractPerformer: L.contract ? at(L.perfCol, L.contract.row) : '',
      scope: marked('일반') ? '일반' : marked('임의') ? '임의' : '',
      schedule: L.schedule.filter(({ lab, line }) => line || lab !== '연결감사').map(({ lab, line }) => ({ label: lab, value: lineValue(sheet, line).value })),
      sites: L.sites.map(({ lab, line }) => ({ label: lab, value: lineValue(sheet, line).value })),
      reportDue: lineValue(sheet, L.due).value,
      copiesKo: L.copies ? /국문\s*\(\s*([^)]*?)\s*부?\s*\)/.exec(L.copies.text)?.[1]?.replace(/부$/, '').trim() ?? '' : copiesOf(L.ko ? cellValue(sheet.cells.get(`B${L.ko.row}`)) : ''),
      copiesEn: L.copies ? /영문\s*\(\s*([^)]*?)\s*부?\s*\)/.exec(L.copies.text)?.[1]?.replace(/부$/, '').trim() ?? '' : copiesOf(L.en ? cellValue(sheet.cells.get(`B${L.en.row}`)) : ''),
    };
    if (scopeB?.inB) d.scopeText = scopeB.value;
    if (L.consol) d.consolidated = lineValue(sheet, L.consol).value;
    return d;
  },
  write(sheet, d) {
    const L = layout(sheet);
    // 값이 바뀐 줄만 다시 쓴다 — 글자 줄은 줄바꿈·괄호 속 공백이 제각각이라 그대로 두면 원래 글자가 남는다.
    const was = PAPER_2110.read(sheet);
    const e: CellEdit[] = [];
    const put = (col: string | null, row: number, v: string, old: string) => {
      if (!col || v.trim() === old.trim()) return;
      const ref = `${col}${row}`;
      e.push(v.trim() ? { ref, text: v.trim() } : { ref, clear: true });
    };
    L.team.forEach(({ item, detail }, i) => {
      const t = d.team[i];
      const w = was.team[i];
      if (!t || !w) return;
      put(L.perfCol, item.row, t.performer, w.performer);
      if (detail) {
        if (t.text.trim() !== w.text || t.ref.trim() !== w.ref) {
          // 「기재 : …」 뒤 줄바꿈은 원래대로 둔다.
          e.push({ ref: detail.ref, text: detail.text.replace(TEAM_RE, (_m, a: string, b: string, c: string, _d, z: string) => {
            const tail = /\n/.test(b) ? /\s*$/.exec(b)![0] : ' ';
            return `${a} ${t.text.trim()}${tail}${c} ${t.ref.trim()} ${z}`;
          }) });
        }
      } else {
        put(L.noteCol, item.row, t.text, w.text);
        put(L.refCol, item.row, t.ref, w.ref);
      }
    });
    if (L.contract) put(L.perfCol, L.contract.row, d.contractPerformer, was.contractPerformer);
    if (L.scope && d.scopeText == null && d.scope !== was.scope) {
      e.push({ ref: L.scope.ref, text: L.scope.text
        .replace(/일반\s*\([^)]*\)/, `일반(${d.scope === '일반' ? ' V' : ' '})`)
        .replace(/임의\s*\([^)]*\)/, `임의(${d.scope === '임의' ? ' V' : ' '})`) });
    }
    // 한 줄 — ①이면 A열 글자의 콜론 뒤, ②면 B열(날짜는 날짜 칸으로).
    const line = (ln: Line | null, v: string | undefined) => {
      if (!ln || v == null) return;
      const cur = lineValue(sheet, ln);
      if (cur.value === v.trim()) return;
      if (cur.inB || (!cur.value && !splitAt(ln.text)?.value && sheet.cells.has(`B${ln.row}`))) { e.push(bCell(`B${ln.row}`, v)); return; }
      const sp = splitAt(ln.text);
      if (sp) e.push({ ref: ln.ref, text: `${sp.head} ${v.trim()}`.trimEnd() });
    };
    if (d.scopeText != null) line(L.scope, d.scopeText);
    if (d.consolidated != null) line(L.consol, d.consolidated);
    L.schedule.forEach(({ lab, line: ln }) => line(ln, d.schedule.find((x) => x.label === lab)?.value));
    L.sites.forEach(({ lab, line: ln }) => line(ln, d.sites.find((x) => x.label === lab)?.value ?? ''));
    line(L.due, d.reportDue);
    if (L.copies && (d.copiesKo.trim() !== was.copiesKo || d.copiesEn.trim() !== was.copiesEn)) {
      e.push({ ref: L.copies.ref, text: L.copies.text
        .replace(/국문\s*\([^)]*\)/, `국문( ${d.copiesKo.trim() || ' '} 부)`)
        .replace(/영문\s*\([^)]*\)/, `영문( ${d.copiesEn.trim() || ' '} 부)`) });
    }
    const copyB = (ln: Line | null, v: string, old: string) => {
      if (!ln || copiesOf(v) === old) return;
      const t = copiesOf(v);
      e.push(!t ? { ref: `B${ln.row}`, clear: true } : { ref: `B${ln.row}`, text: /^\d+$/.test(t) ? `${t}부` : t });
    };
    copyB(L.ko, d.copiesKo, was.copiesKo);
    copyB(L.en, d.copiesEn, was.copiesEn);
    return e;
  },
};
