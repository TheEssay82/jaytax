// 웹 조서 — JAYTAX 화면에서 쓰고 [확인]하면 엑셀 판에 써 넣는 일반조서. 순수 모듈(조서 정의·칸 찾기).
//
// 사용자 2026-09-27: 「일반조서 작성 절차를 편리하게」. 조서마다 정본은 한 곳 —
//   🌐 웹 조서(JAYTAX 가 정본) · 📎 엑셀로 넘긴 조서(1차는 웹, 별도조서를 붙이려고 넘기면 엑셀이 정본) · 📄 엑셀 조서.
// 칸은 주소가 아니라 **문구로 찾는다** — 양식 연도가 바뀌어 줄이 밀려도 맞게 들어간다.
import type { SheetData, CellValue } from './xlsxRead';
import type { CellEdit } from './xlsxCells';
import { codeOf } from './gwpCatalog';
import type { StageNo } from './gwpStage';

export interface WebPaperDef<T = unknown> {
  /** 웹 조서 열쇠 — gwp_paper.code */ code: string;
  title: string;
  stage: StageNo;
  /** 한 줄 설명(무엇을 채우는가) */ note: string;
  /** 워크북에서 이 조서의 시트 — 조서 코드(「2110A」). 「2110A(소규모)」도 같은 조서다. */ sheetCode: string;
  /** 비어 있는 입력 */ empty(): T;
  /** 같은 코드의 시트가 여럿일 때 이 조서의 시트를 고른다(없으면 보이는 첫 시트) */ pick?(sheets: SheetData[]): SheetData | null;
  /** 반영할 때 함께 올해 양식으로 맞출 조서(2700A 요약표처럼 수식으로 이 조서를 읽는 것) */ companions?: string[];
  /** 워크북 시트(작년 값·지금 판)에서 화면 값을 읽는다. 옛 모양 시트도 읽는다. */ read(sheet: SheetData): T;
  /** 화면 값 → 이 시트에 쓸 칸. 같은 값이어도 돌려준다 — 바뀐 칸만 고르는 것은 반영(gwpApply)이 한다. */ write(sheet: SheetData, data: T): CellEdit[];
}

// ── 칸 찾기 ──────────────────────────────────────────────
/** 문구 비교용 — 공백·기호를 뺀다. 「1)현금및현금성자산,장단기금융상품」 */
export const normLabel = (s: string | undefined) => (s ?? '').replace(/[\s·․:：]/g, '');

export function textOf(v: CellValue | undefined): string {
  if (!v) return '';
  if (v.text != null) return v.text.trim();
  if (v.num != null) return String(v.num);
  return '';
}
export const colOf = (ref: string) => /^([A-Z]+)/.exec(ref)![1];
export const rowOf = (ref: string) => Number(/(\d+)$/.exec(ref)![1]);

/** 워크북에서 조서 시트를 고른다 — 보이는 시트 우선. 없으면 null. */
export function findPaperSheet(sheets: SheetData[], code: string): SheetData | null {
  const hits = sheets.filter((s) => (codeOf(s.name) ?? '').replace(/\(.*$/, '') === code);
  return hits.find((s) => !s.hidden) ?? hits[0] ?? null;
}

/** 조서 정의로 시트를 고른다. */
export function pickSheet(def: { sheetCode: string; pick?(sheets: SheetData[]): SheetData | null }, sheets: SheetData[]): SheetData | null {
  return def.pick?.(sheets) ?? findPaperSheet(sheets, def.sheetCode);
}

/** 머리 줄 — 이 문구들이 한 줄에 모두 있는 첫 줄과 각 문구의 열. */
export function findHeader(sheet: SheetData, labels: string[], maxRow = 40): { row: number; cols: Record<string, string> } | null {
  const byRow = new Map<number, Map<string, string>>();
  for (const [ref, v] of sheet.cells) {
    const r = rowOf(ref);
    if (r > maxRow || !v.text) continue;
    (byRow.get(r) ?? byRow.set(r, new Map()).get(r)!).set(normLabel(v.text), colOf(ref));
  }
  for (const r of [...byRow.keys()].sort((a, b) => a - b)) {
    const m = byRow.get(r)!;
    const cols: Record<string, string> = {};
    for (const l of labels) {
      const hit = [...m.entries()].find(([t]) => t === normLabel(l));
      if (!hit) break;
      cols[l] = hit[1];
    }
    if (Object.keys(cols).length === labels.length) return { row: r, cols };
  }
  return null;
}

/** 머리 줄 아래, 라벨 열에 글자가 있는 줄들(순서대로). */
export function labelRows(sheet: SheetData, afterRow: number, labelCol = 'A'): { row: number; label: string }[] {
  const out: { row: number; label: string }[] = [];
  for (const [ref, v] of sheet.cells) {
    if (colOf(ref) !== labelCol) continue;
    const r = rowOf(ref);
    const t = textOf(v);
    if (r > afterRow && t && v.formula == null) out.push({ row: r, label: t });
  }
  return out.sort((a, b) => a.row - b.row);
}

/** 라벨(문구)로 줄을 찾는다. 같은 라벨이 둘이면 첫째. */
export function rowByLabel(sheet: SheetData, label: string, afterRow = 0, labelCol = 'A'): number | null {
  const want = normLabel(label);
  return labelRows(sheet, afterRow, labelCol).find((x) => normLabel(x.label) === want)?.row ?? null;
}
