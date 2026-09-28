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

export const PAPER_2110A: WebPaperDef<Paper2110A> = {
  code: '2110A',
  title: '업무분장표',
  stage: 1,
  sheetCode: '2110A',
  note: '감사 절차마다 담당자(중간감사·기말감사·검토 …). 해마다 거의 같다 — 작년 값을 확인만 하면 된다.',
  empty: () => ({ cols: [], rows: [] }),
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
