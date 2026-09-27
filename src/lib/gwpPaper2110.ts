// 웹 조서 2110 감사계획의 수립 — 1차 확정(중간감사 전).
//
// 이 조서는 값이 칸이 아니라 **A열 글자 안에** 들어 있다(명진 FY25 실측):
//   「감사계획: 2025.4.14」 「(1) 감사목적과범위：일반( V), 임의( )」 「국문( 10 부), 영문( -부)」
//   「-상기 파악한 내용의 기재 : 해당사항없음 -또는 별도의 조서에서 검토 : 조서번호 ( 2110A)」
// 그래서 글자의 문구 부분은 그대로 두고 **값 부분만** 바꿔 쓴다. 수행자는 F열.
import type { SheetData } from './xlsxRead';
import type { CellEdit } from './xlsxCells';
import { normLabel, textOf, colOf, rowOf, findHeader, type WebPaperDef } from './gwpWeb';

export interface TeamItem { label: string; performer: string; text: string; ref: string }
export interface LineValue { label: string; value: string }
export interface Paper2110 {
  /** (감사팀의 구성) 1~3 — 수행자, 파악한 내용, 별도 조서번호 */ team: TeamItem[];
  /** 「1 주요감사계약 내용의 확인」 수행자 */ contractPerformer: string;
  scope: '일반' | '임의' | '';
  /** 감사계획·중간감사·재고 실사입회·조회절차·기말감사 */ schedule: LineValue[];
  /** 본사·공장/지점 */ sites: LineValue[];
  reportDue: string;
  copiesKo: string;
  copiesEn: string;
}

const SCHEDULE = ['감사계획', '중간감사', '재고 실사입회', '조회절차', '기말감사'];
const SITES = ['본사', '공장/지점'];

type Line = { row: number; ref: string; text: string };
function linesA(sheet: SheetData): Line[] {
  const out: Line[] = [];
  for (const [ref, v] of sheet.cells) if (colOf(ref) === 'A' && v.formula == null && textOf(v)) out.push({ row: rowOf(ref), ref, text: textOf(v) });
  return out.sort((a, b) => a.row - b.row);
}
/** 「라벨: 값」 줄 — 라벨 뒤 첫 콜론까지를 머리로 본다. */
const COLON = /[:：]/;
function splitLabel(text: string, label: string): { head: string; value: string } | null {
  const t = text.replace(/^\s+/, '');
  if (!normLabel(t).startsWith(normLabel(label))) return null;
  const m = COLON.exec(t);
  if (!m) return null;
  return { head: t.slice(0, m.index + 1), value: t.slice(m.index + 1).trim() };
}
const TEAM_RE = /(기재\s*[:：])([\s\S]*?)(-\s*또는\s*별도의\s*조서에서\s*검토\s*[:：]\s*조서번호\s*\()([\s\S]*?)(\))/;

function findLine(lines: Line[], label: string, after = 0): Line | null {
  return lines.find((l) => l.row > after && splitLabel(l.text, label)) ?? null;
}

function layout(sheet: SheetData) {
  const lines = linesA(sheet);
  const perfCol = findHeader(sheet, ['항 목', '수행자'])?.cols['수행자'] ?? 'F';
  const teamHead = lines.find((l) => normLabel(l.text).includes('(감사팀의구성)'));
  const team: { item: Line; detail: Line | null }[] = [];
  if (teamHead) {
    for (const l of lines.filter((x) => x.row > teamHead.row && /^\d\s*\./.test(x.text))) {
      if (team.length >= 3) break;
      const d = lines.find((x) => x.row > l.row && x.row <= l.row + 2 && TEAM_RE.test(x.text)) ?? null;
      team.push({ item: l, detail: d });
    }
  }
  const contract = lines.find((l) => /^1\s*주요감사계약/.test(l.text.replace(/\s+/g, ' ').trim())) ?? null;
  const scope = lines.find((l) => normLabel(l.text).includes('감사목적과범위')) ?? null;
  const sched = findLine(lines, '(2)감사일정') ?? findLine(lines, '(2) 감사일정');
  const siteHead = findLine(lines, '(3) 실사장소');
  const due = findLine(lines, '(4) 감사보고서 제출 예정일');
  const copies = lines.find((l) => /국문\s*\(/.test(l.text)) ?? null;
  return {
    perfCol, team, contract, scope, copies, due,
    schedule: SCHEDULE.map((lab) => ({ lab, line: findLine(lines, lab, sched?.row ?? 0) })),
    sites: SITES.map((lab) => ({ lab, line: findLine(lines, lab, siteHead?.row ?? 0) })),
  };
}

export const PAPER_2110: WebPaperDef<Paper2110> = {
  code: '2110', title: '감사계획의 수립', stage: 1, sheetCode: '2110',
  note: '감사팀 구성·감사일정·실사장소·보고서 예정일. 일정은 단계 보드에도 보인다.',
  empty: () => ({ team: [], contractPerformer: '', scope: '일반', schedule: SCHEDULE.map((label) => ({ label, value: '' })), sites: SITES.map((label) => ({ label, value: '' })), reportDue: '', copiesKo: '', copiesEn: '' }),
  read(sheet) {
    const L = layout(sheet);
    const perf = (row: number) => textOf(sheet.cells.get(`${L.perfCol}${row}`));
    const scopeText = L.scope?.text ?? '';
    const marked = (w: string) => new RegExp(`${w}\\s*\\(\\s*[VvOo✓√]\\s*\\)`).test(scopeText);
    return {
      team: L.team.map(({ item, detail }) => {
        const m = detail ? TEAM_RE.exec(detail.text) : null;
        return { label: item.text, performer: perf(item.row), text: (m?.[2] ?? '').trim(), ref: (m?.[4] ?? '').trim() };
      }),
      contractPerformer: L.contract ? perf(L.contract.row) : '',
      scope: marked('일반') ? '일반' : marked('임의') ? '임의' : '',
      schedule: L.schedule.map(({ lab, line }) => ({ label: lab, value: line ? splitLabel(line.text, lab)!.value : '' })),
      sites: L.sites.map(({ lab, line }) => ({ label: lab, value: line ? splitLabel(line.text, lab)!.value : '' })),
      reportDue: L.due ? splitLabel(L.due.text, '(4) 감사보고서 제출 예정일')!.value : '',
      copiesKo: /국문\s*\(\s*([^)]*?)\s*부?\s*\)/.exec(L.copies?.text ?? '')?.[1]?.replace(/부$/, '').trim() ?? '',
      copiesEn: /영문\s*\(\s*([^)]*?)\s*부?\s*\)/.exec(L.copies?.text ?? '')?.[1]?.replace(/부$/, '').trim() ?? '',
    };
  },
  write(sheet, d) {
    const L = layout(sheet);
    // 값이 바뀐 줄만 다시 쓴다 — 글자 줄은 줄바꿈·괄호 속 공백이 제각각이라 그대로 두면 원래 글자가 남는다.
    const was = PAPER_2110.read(sheet);
    const e: CellEdit[] = [];
    const perf = (row: number, v: string) => { const ref = `${L.perfCol}${row}`; e.push(v.trim() ? { ref, text: v.trim() } : { ref, clear: true }); };
    L.team.forEach(({ item, detail }, i) => {
      const t = d.team[i];
      if (!t) return;
      perf(item.row, t.performer);
      const w = was.team[i];
      if (detail && (t.text.trim() !== w?.text || t.ref.trim() !== w?.ref)) {
        // 「기재 : …」 뒤 줄바꿈은 원래대로 둔다.
        e.push({ ref: detail.ref, text: detail.text.replace(TEAM_RE, (_m, a: string, b: string, c: string, _d, z: string) => {
          const tail = /\n/.test(b) ? /\s*$/.exec(b)![0] : ' ';
          return `${a} ${t.text.trim()}${tail}${c} ${t.ref.trim()} ${z}`;
        }) });
      }
    });
    if (L.contract) perf(L.contract.row, d.contractPerformer);
    if (L.scope && d.scope !== was.scope) {
      e.push({ ref: L.scope.ref, text: L.scope.text
        .replace(/일반\s*\([^)]*\)/, `일반(${d.scope === '일반' ? ' V' : ' '})`)
        .replace(/임의\s*\([^)]*\)/, `임의(${d.scope === '임의' ? ' V' : ' '})`) });
    }
    const line = (ln: { text: string; ref: string } | null, lab: string, v: string) => {
      if (!ln) return;
      if (splitLabel(ln.text, lab)?.value === v.trim()) return;
      const s = splitLabel(ln.text, lab);
      if (s) e.push({ ref: ln.ref, text: `${s.head} ${v.trim()}`.trimEnd() });
    };
    L.schedule.forEach(({ lab, line: ln }) => line(ln, lab, d.schedule.find((x) => x.label === lab)?.value ?? ''));
    L.sites.forEach(({ lab, line: ln }) => line(ln, lab, d.sites.find((x) => x.label === lab)?.value ?? ''));
    line(L.due, '(4) 감사보고서 제출 예정일', d.reportDue);
    if (L.copies && (d.copiesKo.trim() !== was.copiesKo || d.copiesEn.trim() !== was.copiesEn)) {
      e.push({ ref: L.copies.ref, text: L.copies.text
        .replace(/국문\s*\([^)]*\)/, `국문( ${d.copiesKo.trim() || ' '} 부)`)
        .replace(/영문\s*\([^)]*\)/, `영문( ${d.copiesEn.trim() || ' '} 부)`) });
    }
    return e;
  },
};
