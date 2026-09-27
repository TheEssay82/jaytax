// 웹 조서 2110A 업무분장표 — 감사 절차마다 중간감사·기말감사·검토 담당자. 1차 확정(중간감사 전).
// 사용자 2026-09-27: 「한번 고정해두면 다음해부터는 변할 가능성이 없어서 확인용도」 — 작년 값을 그대로 보이고 [확인]이면 끝.
import type { SheetData } from './xlsxRead';
import type { CellEdit } from './xlsxCells';
import { findHeader, labelRows, normLabel, textOf, type WebPaperDef } from './gwpWeb';

export interface AssignRow {
  label: string;
  /** 소제목 줄(「(2) 위험평가」 — 아래에 1) 2) … 가 온다). 담당자 칸이 없다. */ heading?: boolean;
  mid: string;
  fin: string;
  rev: string;
}
export interface Paper2110A { rows: AssignRow[] }

const HEAD = ['중간감사', '기말감사', '검토'];

/** 「(2) 위험평가」 다음 줄이 「1) …」이면 소제목. */
function isHeading(label: string, next: string | undefined): boolean {
  return /^\(\d+\)/.test(label.trim()) && /^\d+\)/.test((next ?? '').trim());
}

export const PAPER_2110A: WebPaperDef<Paper2110A> = {
  code: '2110A',
  title: '업무분장표',
  stage: 1,
  sheetCode: '2110A',
  note: '감사 절차마다 중간감사·기말감사·검토 담당자. 해마다 거의 같다 — 작년 값을 확인만 하면 된다.',
  empty: () => ({ rows: [] }),
  read(sheet: SheetData): Paper2110A {
    const h = findHeader(sheet, HEAD);
    if (!h) return { rows: [] };
    const rows = labelRows(sheet, h.row);
    return {
      rows: rows.map((r, i) => {
        const heading = isHeading(r.label, rows[i + 1]?.label);
        const cell = (k: string) => textOf(sheet.cells.get(`${h.cols[k]}${r.row}`));
        return heading
          ? { label: r.label, heading: true, mid: '', fin: '', rev: '' }
          : { label: r.label, mid: cell('중간감사'), fin: cell('기말감사'), rev: cell('검토') };
      }),
    };
  },
  write(sheet: SheetData, data: Paper2110A): CellEdit[] {
    const h = findHeader(sheet, HEAD);
    if (!h) throw new Error('2110A 시트에서 「중간감사 · 기말감사 · 검토」 머리 줄을 찾지 못했습니다.');
    const byLabel = new Map(labelRows(sheet, h.row).map((r) => [normLabel(r.label), r.row]));
    const edits: CellEdit[] = [];
    for (const r of data.rows) {
      if (r.heading) continue;
      const row = byLabel.get(normLabel(r.label));
      if (!row) continue;
      for (const [k, v] of [['중간감사', r.mid], ['기말감사', r.fin], ['검토', r.rev]] as const) {
        const ref = `${h.cols[k]}${row}`;
        edits.push(v.trim() ? { ref, text: v.trim() } : { ref, clear: true });
      }
    }
    return edits;
  },
};
