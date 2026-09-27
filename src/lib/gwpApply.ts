// 웹 조서를 엑셀 판에 써 넣는다. 순수 모듈 — 판 파일 바이트를 받아 새 바이트를 돌려준다(올리기는 부르는 쪽).
//
// 바뀐 칸만 쓰고 노랗게 칠한다. 탭은 사무소 관행대로(사용자 2026-09-27):
//   바뀐 칸이 있으면 🟡 노랑(수정함), 확인했는데 바뀐 것이 없으면 🟢 초록(새로 넣을 내용 없음).
import { strFromU8, strToU8 } from 'fflate';
import { readWorkbook, type CellValue } from './xlsxRead';
import { setCells, type CellEdit } from './xlsxCells';
import { sheetEntries, dropCalcChain, forceRecalc, unzip, zip } from './xlsxTransplant';
import { setTabColor, highlightCells, TAB } from './xlsxMark';
import { findPaperSheet, textOf, type WebPaperDef } from './gwpWeb';

export interface ApplyItem {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  def: WebPaperDef<any>;
  data: unknown;
}
export interface ApplyResult {
  bytes: Uint8Array;
  done: { code: string; sheet: string; changed: number }[];
  /** 워크북에 시트가 없는 조서 */ missing: string[];
}

/** 이 칸에 이 값을 쓰면 바뀌는가. */
export function changes(cur: CellValue | undefined, e: CellEdit): boolean {
  if (e.clear) return !!cur && (cur.formula != null || cur.num != null || !!textOf(cur));
  if (e.formula != null) return cur?.formula !== e.formula;
  if (e.num != null) return cur?.formula != null || cur?.num !== e.num;
  if (e.text != null) return cur?.formula != null || textOf(cur) !== e.text.trim() || cur?.num != null;
  return false;
}

export function applyWebPapers(bookBytes: Uint8Array, items: ApplyItem[]): ApplyResult {
  const files = unzip(bookBytes);
  const sheets = readWorkbook(bookBytes);
  const done: ApplyResult['done'] = [];
  const missing: string[] = [];
  for (const { def, data } of items) {
    const sheet = findPaperSheet(sheets, def.sheetCode);
    if (!sheet) { missing.push(def.code); continue; }
    const entry = sheetEntries(files).find((x) => x.name === sheet.name);
    if (!entry) { missing.push(def.code); continue; }
    const edits = def.write(sheet, data).filter((e) => changes(sheet.cells.get(e.ref), e));
    let xml = strFromU8(files[entry.part]);
    if (edits.length) xml = setCells(xml, edits);
    xml = setTabColor(xml, edits.length ? TAB.yellow : TAB.green);
    files[entry.part] = strToU8(xml);
    if (edits.length) highlightCells(files, entry.part, edits.map((e) => e.ref));
    done.push({ code: def.code, sheet: sheet.name, changed: edits.length });
  }
  dropCalcChain(files);
  forceRecalc(files);
  return { bytes: zip(files), done, missing };
}
