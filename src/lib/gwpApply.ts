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
import { setTabColor, highlightCells, blackenSheet, tabColorOf, tabStateOf, unscaleThousands, TAB } from './xlsxMark';
import { findPaperSheet, pickSheet, textOf, type WebPaperDef } from './gwpWeb';
import { findTemplateSheet, type TemplateCatalog } from './gwpTemplate';
import { buildCatalog, codeOf } from './gwpCatalog';
import { compareSheets, headLinker, renameSheetRefs, MISSING_THRESHOLD } from './gwpRoll';
import { sortSheetsByCode } from './gwpOrder';

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
    // 보이는 시트가 있으면 그 가운데서만 고른다 — 숨긴 「2700A (소규모)」를 쓰고 보이던 일반 「2700A」를 숨기던 것(평안정공 v4, 2026-09-28).
    const all = sheets.filter((s) => baseOf(s.name) === code);
    const cands = all.some((s) => !s.hidden) ? all.filter((s) => !s.hidden) : all;
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

/** 빌린 판의 열쇠 — borrowed 맵에 이 열쇠로 판 바이트를 넣어 준다. */
export const borrowKey = (b: { engagementId: string; version: number }) => `${b.engagementId}#${b.version}`;

export function applyWebPapers(
  bookBytes: Uint8Array, items: ApplyItem[], template?: TemplateSource,
  /** 빌린 판(borrowKey → 바이트) — borrowOf 가 있는 조서(2120A)가 쓴다 */ borrowed?: Map<string, Uint8Array>,
): ApplyResult {
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
  // 빌린 시트(2120A — 작년 것이 빈 양식, 사용자 2026-09-30) — 이 판에 보이는 시트가 없으면 빌린 판에서 복사해 넣는다.
  // 금액·비고는 조서의 write 가 이 회사 값으로 덮거나 지운다(빌린 회사 숫자를 남기지 않는다). 머리는 이 회사 표지·조서목록으로.
  for (const { def, data } of items) {
    const b = def.borrowOf?.(data);
    if (!b) continue;
    // 보이는 시트가 이미 빌린 틀 모양이면(전에 넣었다 — 재확정) 그대로. 빈 양식이면 그 자리에 갈아끼운다 —
    // 소규모 감사는 빈 「2120A(소규모)」가 보이는 채로 있어, 전에는 옮겨 심지 않고 그 빈 시트에 쓰다 멈췄다(주원이노베이션 2026-10-01).
    const shown = readWorkbook(zip(files)).filter((s) => !s.hidden && baseOf(s.name) === def.sheetCode);
    const want = ((data as { rows?: { key: string; added?: boolean }[] }).rows ?? []).filter((x) => !x.added).map((x) => x.key);
    const fits = (s: SheetData) => {
      const have = new Set(((def.read(s) as { rows?: { key: string }[] }).rows ?? []).map((x) => x.key));
      return want.length > 0 && want.filter((k) => have.has(k)).length >= want.length * 0.8;
    };
    if (shown.some(fits)) continue;
    const bytes = borrowed?.get(borrowKey(b));
    if (!bytes) throw new Error(`${def.code} — 빌린 판(v${b.version})을 받지 못했습니다.`);
    const srcSheet = readWorkbook(bytes).find((s) => s.name === b.sheet);
    if (!srcSheet) throw new Error(`빌린 판에 「${b.sheet}」 시트가 없습니다.`);
    const r = transplantSheet(files, unzip(bytes), b.sheet, shown.length ? { as: shown[0].name, replace: true, hidden: false } : { as: def.sheetCode, hidden: false });
    const after = readWorkbook(zip(files));
    const head = headLinker(after, buildCatalog(after))(srcSheet, def.sheetCode, template?.reviewer ?? '');
    let xml = strFromU8(files[r.part]);
    if (head.length) xml = setCells(xml, head);
    files[r.part] = strToU8(setTabColor(xml, TAB.yellow));
    blackenSheet(files, r.part);
    prepared.added.push(r.name);
  }
  // 빌린 시트는 금액을 원 단위로 보이게 — 빌려 온 회사 서식이 「#,##0,」(천 단위 표시)여도(사용자 2026-09-30). 이미 넣은 판도 재확정 때 고쳐진다.
  for (const { def, data } of items) {
    if (!def.borrowOf?.(data)) continue;
    const s = readWorkbook(zip(files)).find((x) => !x.hidden && baseOf(x.name) === def.sheetCode);
    const e = s ? sheetEntries(files).find((x) => x.name === s.name) : null;
    if (e) unscaleThousands(files, e.part);
  }
  // 칸을 쓰기 전에 시트 XML 을 고칠 조서(줄 끼우기).
  for (const { def, data } of items) {
    if (!def.prepareXml) continue;
    const s0 = pickSheet(def, readWorkbook(zip(files)));
    const entry = s0 ? sheetEntries(files).find((x) => x.name === s0.name) : null;
    if (s0 && entry) files[entry.part] = strToU8(def.prepareXml(strFromU8(files[entry.part]), s0, data));
  }
  // 확정 판은 늘 조서 번호 순서로(사용자 2026-09-28) — 양식에서 새로 넣은 시트(2700A-4 등)뿐 아니라
  // 순서 정리 전에 만든 판(평안정공 v6)도 재확정 한 번으로 바로잡힌다. 이미 순서대로면 아무것도 안 한다.
  sortSheetsByCode(files);
  const sheets = readWorkbook(zip(files));
  // 올해 양식을 쓰는 조서(2301·2700A 묶음)는 반영할 때마다 글자를 검정으로 — 이미 갈아끼운 판(명진 v15)의 파란 글씨도 고친다.
  {
    const codes = new Set(items.filter(({ def }) => def.useTemplate).flatMap(({ def }) => [def.sheetCode, ...(def.companions ?? [])]));
    for (const s of sheets) {
      if (s.hidden || !codes.has(baseOf(s.name))) continue;
      const e = sheetEntries(files).find((x) => x.name === s.name);
      if (e) blackenSheet(files, e.part);
    }
  }
  const done: ApplyResult['done'] = [];
  const missing: string[] = [];
  for (const { def, data } of items) {
    const sheet = pickSheet(def, sheets);
    if (!sheet) { missing.push(def.code); continue; }
    const plan = def.writeBook ? def.writeBook(sheets, data) : [{ sheet: sheet.name, edits: def.write(sheet, data) }];
    // 양식 예시 문구가 그대로 남은 칸 — 지운다(쓰는 칸은 빼고).
    if (def.scrub && template && !def.writeBook) {
      const ts = findTemplateSheet(template.catalog, def.sheetCode);
      const tplData = ts ? readWorkbook(template.files[ts.file]).find((x) => x.name === ts.name) : undefined;
      if (tplData) {
        const mine = new Set(plan[0].edits.map((e) => e.ref));
        plan[0].edits.push(...def.scrub(sheet, tplData).filter((e) => !mine.has(e.ref)));
      }
    }
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
