// 웹 조서 2110A 업무분장표 — 감사 절차마다 담당자. 1차 확정(중간감사 전).
// 사용자 2026-09-27: 「한번 고정해두면 다음해부터는 변할 가능성이 없어서 확인용도」 — 작년 값을 그대로 보이고 [확인]이면 끝.
//
// 열은 머리 줄 그대로 가져온다(2026-09-28 알티스트 검증) —
//   명진(소규모): 중간감사 · 기말감사 · 검토
//   알티스트·윤성: 1분기검토 · 반기검토 · 3분기검토 · 중간감사 · 기말감사 · 1차검토 · 2차검토
import type { SheetData } from './xlsxRead';
import type { CellEdit } from './xlsxCells';
import { colOf, labelRows, normLabel, rowOf, textOf, type WebPaperDef } from './gwpWeb';

export interface AssignRow {
  label: string;
  /** 소제목 줄(「(2) 위험평가」 — 아래에 1) 2) … 가 오고 담당자 칸이 비었다) */ heading?: boolean;
  /** cols 순서대로 담당자 */ vals: string[];
}
export interface Paper2110A {
  /** 머리 줄의 열 이름(「중간감사」·「1차검토」…) */ cols: string[];
  rows: AssignRow[];
}

/** 옛 저장 모양(mid·fin·rev) → 지금 모양. 명진 1차 확정 때 저장한 것. */
export function norm2110A(d: unknown): Paper2110A {
  const x = (d ?? {}) as { cols?: string[]; rows?: (Partial<AssignRow> & { mid?: string; fin?: string; rev?: string })[] };
  if (x.cols) return x as Paper2110A;
  return {
    cols: ['중간감사', '기말감사', '검토'],
    rows: (x.rows ?? []).map((r) => ({ label: r.label ?? '', heading: r.heading, vals: [r.mid ?? '', r.fin ?? '', r.rev ?? ''] })),
  };
}

/** 머리 줄 — 「중간감사」·「기말감사」가 함께 있는 줄. 라벨(A)열 오른쪽의 글자 칸이 열이다. */
function header(sheet: SheetData): { row: number; cols: { name: string; col: string }[] } | null {
  const byRow = new Map<number, { name: string; col: string }[]>();
  for (const [ref, v] of sheet.cells) {
    const r = rowOf(ref);
    if (r > 40 || !v.text || colOf(ref) === 'A') continue;
    (byRow.get(r) ?? byRow.set(r, []).get(r)!).push({ name: normLabel(v.text), col: colOf(ref) });
  }
  const colNo = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  for (const r of [...byRow.keys()].sort((a, b) => a - b)) {
    const cols = byRow.get(r)!;
    if (cols.some((c) => c.name === '중간감사') && cols.some((c) => c.name === '기말감사')) {
      return { row: r, cols: cols.sort((a, b) => colNo(a.col) - colNo(b.col)) };
    }
  }
  return null;
}

/** 검토자(파트너) 열 — 「검토」·「1차검토」·「2차검토」. 분기·반기 검토(용역)는 아니다. */
export const isReviewCol = (name: string) => /^(\d차)?검토$/.test(name);
/** 분기·반기 검토 열(용역) — 대개 업무 영역이 아니다. */
const isInterimCol = (name: string) => /^(\d분기|반기)검토$/.test(name);

// ── 소규모 → 일반·K-IFRS(사용자 2026-09-30 에이치앤아비즈 「줄이 밀려 생긴 오류」)
// 소규모 양식은 열이 「중간감사 · 기말감사 · 검토」 셋이고(D·E·F), 일반은 「1분기검토 · 반기검토 · 3분기검토 · 중간감사 · 기말감사 · 1차검토 · 2차검토」(C~I).
// 칸 자리로 옮기면 중간감사 값이 반기검토에 들어간다 — 열 이름으로 짝짓는다. 검토 → 1차·2차검토 둘 다(알티스트 관행: 둘 다 파트너).
// 줄 이름도 양식마다 조금 다르다 — 번호를 떼고 맞추고, 안 맞으면 아래 짝으로.
const ROW_ALIAS: [RegExp, RegExp][] = [
  [/^감사계획의수립$/, /^전반감사계획의수립$/],
  [/^통제테스트$/, /^위험에대한대응$/],
  [/^통제환경/, /^통제환경/],
];
const bare = (label: string) => normLabel(label).replace(/^(\(\d+\)|\d+\))/, '');
const FROM_SMALL: Record<string, string[]> = { 중간감사: ['중간감사'], 기말감사: ['기말감사'], 검토: ['1차검토', '2차검토'] };

/** 작년 소규모 2110A(읽은 값) → 올해 일반 2110A 시트의 줄·열 모양. */
export function from2110ASmall(small: Paper2110A, general: Paper2110A): Paper2110A {
  const src = small.rows.filter((r) => !r.heading && r.vals.some((v) => v));
  const pick = (label: string) => {
    const b = bare(label);
    const hit = src.find((r) => bare(r.label) === b);
    if (hit) return hit;
    for (const [a, g] of ROW_ALIAS) if (g.test(b)) { const h = src.find((r) => a.test(bare(r.label))); if (h) return h; }
    return undefined;
  };
  const rows = general.rows.map((r) => {
    if (r.heading) return r;
    const s = pick(r.label);
    const vals = general.cols.map((name, k) => {
      if (!s) return r.vals[k] ?? '';
      const from = small.cols.findIndex((c) => (FROM_SMALL[c] ?? []).includes(name));
      return from >= 0 ? s.vals[from] ?? '' : '';
    });
    return { ...r, vals };
  });
  return fillInterimNA({ cols: general.cols, rows });
}

/** 분기·반기 검토 열이 통째로 비었으면 N/A(사용자 2026-09-30 「대부분 업무영역이 아닙니다. N/A 로 띄우는 것이 맞습니다」). */
export function fillInterimNA(d: Paper2110A): Paper2110A {
  const idx = d.cols.map((c, k) => (isInterimCol(c) ? k : -1)).filter((k) => k >= 0);
  const empty = idx.filter((k) => d.rows.every((r) => r.heading || !(r.vals[k] ?? '').trim()));
  if (!empty.length) return d;
  // 담당자가 적힌 줄만 — 소제목(「(3) 계정별 입증감사절차」)·빈 번호 줄(「7)」)은 그대로 비워 둔다.
  const filled = (r: AssignRow) => r.vals.some((v, k) => !idx.includes(k) && v.trim());
  return { ...d, rows: d.rows.map((r) => (r.heading || !filled(r) ? r : { ...r, vals: r.vals.map((v, k) => (empty.includes(k) ? 'N/A' : v)) })) };
}

/** 일반 2110A 가 소규모에서 칸 자리로 잘못 옮겨졌나 — 1차·2차검토가 다 비었고 소규모 짝이 있다. */
function migratedWrong(general: Paper2110A): boolean {
  const rev = general.cols.map((c, k) => (/^\d차검토$/.test(c) ? k : -1)).filter((k) => k >= 0);
  return rev.length > 0 && general.rows.every((r) => rev.every((k) => !(r.vals[k] ?? '').trim()));
}

export const PAPER_2110A: WebPaperDef<Paper2110A> = {
  code: '2110A',
  title: '업무분장표',
  stage: 1,
  sheetCode: '2110A',
  note: '감사 절차마다 담당자(중간감사·기말감사·검토 …). 해마다 거의 같다 — 작년 값을 확인만 하면 된다.',
  empty: () => ({ cols: [], rows: [] }),
  // 보이는 2110A 가 일반 양식인데 소규모에서 칸 자리로 옮겨진 판(에이치앤아비즈 v1)이면 숨긴 「2110A(소규모)」에서 열 이름으로 다시 짓는다.
  readBook(sheets: SheetData[]): Paper2110A {
    const mine = sheets.filter((s) => /^2110A/.test(s.name.replace(/\s/g, '')));
    const general = mine.find((s) => !s.hidden && !/소규모/.test(s.name)) ?? mine.find((s) => !s.hidden) ?? mine[0];
    if (!general) return { cols: [], rows: [] };
    const g = PAPER_2110A.read(general);
    const small = mine.find((s) => s !== general && /소규모/.test(s.name));
    if (small && g.cols.includes('1차검토') && migratedWrong(g)) return from2110ASmall(PAPER_2110A.read(small), g);
    return g.cols.includes('1차검토') ? fillInterimNA(g) : g;
  },
  read(sheet: SheetData): Paper2110A {
    const h = header(sheet);
    if (!h) return { cols: [], rows: [] };
    const rows = labelRows(sheet, h.row);
    return {
      cols: h.cols.map((c) => c.name),
      rows: rows.map((r, i) => {
        const vals = h.cols.map((c) => textOf(sheet.cells.get(`${c.col}${r.row}`)));
        const heading = vals.every((v) => !v) && /^\(\d+\)/.test(r.label.trim()) && /^\d+\)/.test((rows[i + 1]?.label ?? '').trim());
        return heading ? { label: r.label, heading: true, vals: vals.map(() => '') } : { label: r.label, vals };
      }),
    };
  },
  write(sheet: SheetData, data: Paper2110A): CellEdit[] {
    const h = header(sheet);
    if (!h) throw new Error('2110A 시트에서 「중간감사 · 기말감사」 머리 줄을 찾지 못했습니다.');
    const d = norm2110A(data);
    const colOfName = new Map(h.cols.map((c) => [c.name, c.col]));
    const byLabel = new Map(labelRows(sheet, h.row).map((r) => [normLabel(r.label), r.row]));
    const edits: CellEdit[] = [];
    for (const r of d.rows) {
      if (r.heading) continue;
      const row = byLabel.get(normLabel(r.label));
      if (!row) continue;
      d.cols.forEach((name, k) => {
        const col = colOfName.get(name);
        if (!col) return;
        const v = (r.vals[k] ?? '').trim();
        edits.push(v ? { ref: `${col}${row}`, text: v } : { ref: `${col}${row}`, clear: true });
      });
    }
    return edits;
  },
};
