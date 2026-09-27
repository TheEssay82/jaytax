// 웹 조서를 엑셀 판에 써 넣는다. 순수 모듈 — 판 파일 바이트를 받아 새 바이트를 돌려준다(올리기는 부르는 쪽).
//
// 바뀐 칸만 쓰고 노랗게 칠한다. 탭은 사무소 관행대로(사용자 2026-09-27):
//   바뀐 칸이 있으면 🟡 노랑(수정함), 확인했는데 바뀐 것이 없으면 🟢 초록(새로 넣을 내용 없음).
//
// 웹 조서는 **올해 양식 시트에 쓴다**(설계서 14.2). 회사 시트가 옛 모양이면(명진 2700A-2(소규모)) 반영할 때
// 올해 양식 시트로 갈아끼우고(이름·자리는 회사 것), 없으면(2700A-4) 새로 넣고, 짝이 없어진 옛 시트는 숨긴다.
// 작년 값은 갈아끼우기 전에 화면으로 먼저 읽어 두었다(조서 정의의 read 가 옛 모양도 읽는다).
import { strFromU8, strToU8 } from 'fflate';
import { readWorkbook, type CellValue, type SheetData } from './xlsxRead';
import { setCells, type CellEdit } from './xlsxCells';
import { sheetEntries, dropCalcChain, forceRecalc, unzip, zip, transplantSheet, setSheetHidden } from './xlsxTransplant';
import { setTabColor, highlightCells, blackenSheet, tabColorOf, tabStateOf, TAB } from './xlsxMark';
import { findPaperSheet, pickSheet, textOf, type WebPaperDef } from './gwpWeb';
import { findTemplateSheet, type TemplateCatalog } from './gwpTemplate';
import { buildCatalog, codeOf } from './gwpCatalog';
import { compareSheets, headLinker, renameSheetRefs, MISSING_THRESHOLD } from './gwpRoll';

export interface ApplyItem {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  def: WebPaperDef<any>;
  data: unknown;
}
export interface TemplateSource {
  catalog: TemplateCatalog;
  /** readBundle 이 준 묶음 안 파일들 */ files: Record<string, Uint8Array>;
  /** 새로 넣는 시트 머리의 검토자 */ reviewer: string;
}
export interface Prepared {
  /** 올해 양식으로 갈아끼운 시트 */ replaced: string[];
  /** 새로 넣은 시트 */ added: string[];
  /** 짝이 없어져 숨긴 옛 시트 */ hidden: string[];
}
export interface ApplyResult {
  bytes: Uint8Array;
  done: { code: string; sheet: string; changed: number }[];
  /** 워크북에 시트가 없는 조서 */ missing: string[];
  prepared: Prepared;
}

/** 이 칸에 이 값을 쓰면 바뀌는가. */
export function changes(cur: CellValue | undefined, e: CellEdit): boolean {
  if (e.clear) return !!cur && (cur.formula != null || cur.num != null || !!textOf(cur));
  if (e.formula != null) return cur?.formula !== e.formula;
  if (e.num != null) return cur?.formula != null || cur?.num !== e.num;
  if (e.text != null) return cur?.formula != null || textOf(cur) !== e.text.trim() || cur?.num != null;
  return false;
}

const baseOf = (name: string) => (codeOf(name) ?? '').replace(/\(.*$/, '');

/** 시트가 올해 양식 모양인가 — 양식 문구가 거의 다 있다. */
export function isTemplateShape(tplData: SheetData, sheet: SheetData): boolean {
  const c = compareSheets(tplData, sheet);
  return c.total === 0 || c.missing.length / c.total <= MISSING_THRESHOLD;
}

/**
 * 이 조서 코드들의 시트를 올해 양식 모양으로 맞춘다. files 를 제자리에서 고친다.
 * 회사 시트가 여럿이면(명진 2700A-1(적용지침)·2700A-1(소규모)) 양식에 가장 가까운 것을 쓰고 나머지는 숨긴다.
 */
export function prepareTemplateSheets(files: Record<string, Uint8Array>, codes: string[], src: TemplateSource): Prepared {
  const out: Prepared = { replaced: [], added: [], hidden: [] };
  const tplBooks = new Map<string, { files: Record<string, Uint8Array>; sheets: SheetData[] }>();
  const tplBook = (file: string) => {
    if (!tplBooks.has(file)) tplBooks.set(file, { files: unzip(src.files[file]), sheets: readWorkbook(src.files[file]) });
    return tplBooks.get(file)!;
  };
  const touched: { part: string; tplData: SheetData; code: string }[] = [];
  for (const code of codes) {
    const ts = findTemplateSheet(src.catalog, code);
    if (!ts) continue;
    const tb = tplBook(ts.file);
    const tplData = tb.sheets.find((s) => s.name === ts.name);
    if (!tplData) continue;
    const sheets = readWorkbook(zip(files));
    const cands = sheets.filter((s) => baseOf(s.name) === code);
    const scored = cands.map((s) => ({ s, c: compareSheets(tplData, s) }))
      .sort((a, b) => a.c.missing.length / Math.max(1, a.c.total) - b.c.missing.length / Math.max(1, b.c.total));
    const best = scored[0]?.s;
    for (const o of scored.slice(1)) if (!o.s.hidden) { setSheetHidden(files, o.s.name, true); out.hidden.push(o.s.name); }
    if (best && isTemplateShape(tplData, best)) continue;
    const r = best
      ? transplantSheet(files, tb.files, ts.name, { as: best.name, replace: true, hidden: false })
      : transplantSheet(files, tb.files, ts.name, { hidden: false });
    (best ? out.replaced : out.added).push(r.name);
    touched.push({ part: r.part, tplData, code });
  }
  if (!touched.length) return out;
  // 양식 수식의 시트 이름(2700A-2(감사계획단계))을 회사 시트 이름(2700A-2(소규모))으로, 머리는 표지·조서목록으로.
  const sheets = readWorkbook(zip(files));
  const nameMap = new Map<string, string>();
  for (const t of src.catalog.sheets) {
    if (!t.code) continue;
    const mine = findPaperSheet(sheets, t.code.replace(/\(.*$/, ''));
    if (mine) nameMap.set(t.name, mine.name);
  }
  const link = headLinker(sheets, buildCatalog(sheets));
  for (const t of touched) {
    let xml = renameSheetRefs(strFromU8(files[t.part]), nameMap);
    const head = link(t.tplData, t.code, src.reviewer);
    if (head.length) xml = setCells(xml, head);
    files[t.part] = strToU8(setTabColor(xml, TAB.yellow));
    blackenSheet(files, t.part);                                  // 양식의 파란 글씨 → 검정(사용자 2026-09-28)
  }
  return out;
}

export function applyWebPapers(bookBytes: Uint8Array, items: ApplyItem[], template?: TemplateSource): ApplyResult {
  const files = unzip(bookBytes);
  const prepared: Prepared = template
    ? prepareTemplateSheets(files, [...new Set(items.filter(({ def }) => def.useTemplate).flatMap(({ def }) => [def.sheetCode, ...(def.companions ?? [])]))], template)
    : { replaced: [], added: [], hidden: [] };
  // 올해 양식으로 맞춘 조서의 옛 짝(2302)은 숨긴다.
  if (template) {
    const retire = new Set(items.filter(({ def }) => def.useTemplate).flatMap(({ def }) => def.retire ?? []));
    for (const s of readWorkbook(zip(files))) {
      if (!s.hidden && retire.has(baseOf(s.name))) { setSheetHidden(files, s.name, true); prepared.hidden.push(s.name); }
    }
  }
  // 칸을 쓰기 전에 시트 XML 을 고칠 조서(줄 끼우기).
  for (const { def, data } of items) {
    if (!def.prepareXml) continue;
    const s0 = pickSheet(def, readWorkbook(zip(files)));
    const entry = s0 ? sheetEntries(files).find((x) => x.name === s0.name) : null;
    if (s0 && entry) files[entry.part] = strToU8(def.prepareXml(strFromU8(files[entry.part]), s0, data));
  }
  const sheets = readWorkbook(zip(files));
  const done: ApplyResult['done'] = [];
  const missing: string[] = [];
  for (const { def, data } of items) {
    const sheet = pickSheet(def, sheets);
    if (!sheet) { missing.push(def.code); continue; }
    const plan = def.writeBook ? def.writeBook(sheets, data) : [{ sheet: sheet.name, edits: def.write(sheet, data) }];
    let changed = 0;
    for (const p of plan) {
      const sd = sheets.find((x) => x.name === p.sheet);
      const entry = sheetEntries(files).find((x) => x.name === p.sheet);
      if (!sd || !entry) continue;
      const edits = p.edits.filter((e) => changes(sd.cells.get(e.ref), e));
      let xml = strFromU8(files[entry.part]);
      if (edits.length) xml = setCells(xml, edits);
      // 바뀐 칸이 있으면 노랑. 없으면 — 손 안 댄(빨강·색 없음) 시트만 초록으로. 이미 노랑(올해 수정함)은 그대로 둔다.
      const was = tabStateOf(tabColorOf(xml));
      if (edits.length) xml = setTabColor(xml, TAB.yellow);
      else if (was !== 'yellow' && was !== 'green') xml = setTabColor(xml, TAB.green);
      files[entry.part] = strToU8(xml);
      if (edits.length) highlightCells(files, entry.part, edits.map((e) => e.ref));
      changed += edits.length;
    }
    done.push({ code: def.code, sheet: plan.map((p) => p.sheet).join(' · '), changed });
  }
  dropCalcChain(files);
  forceRecalc(files);
  return { bytes: zip(files), done, missing, prepared };
}
