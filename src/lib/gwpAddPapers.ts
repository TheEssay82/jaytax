// 올해 양식에는 있는데 조서 파일에 없는 조서 — 골라서 양식에서 넣는다(사용자 2026-09-30 에이치앤아비즈 「3000번대 넣기」).
//
// 작년 워크북에 3100~3700 시트가 아예 없던 회사(아비즈 FY25)는 이월해도 없다(이월은 「전기 그대로」가 기본이고 새 조서는 고를 때만).
// 이미 만든 판에서 빠진 조서를 찾아, 고른 것만 올해 양식에서 옮겨 심는다 — 머리는 표지·조서목록으로, 탭은 빨강(올해 아직 손 안 댐 — 새 조서도 빨강).
// 순수 모듈 — 판 바이트를 받아 새 바이트를 돌려준다.
import { strFromU8, strToU8 } from 'fflate';
import { readWorkbook } from './xlsxRead';
import { setCells } from './xlsxCells';
import { unzip, zip, transplantSheet, dropCalcChain, forceRecalc } from './xlsxTransplant';
import { setTabColor, blackenSheet, TAB } from './xlsxMark';
import { buildCatalog, type Catalog } from './gwpCatalog';
import { findPaperSheet } from './gwpWeb';
import { headLinker, renameSheetRefs } from './gwpRoll';
import { sortSheetsByCode } from './gwpOrder';
import type { TemplateCatalog } from './gwpTemplate';

const baseOf = (c: string) => c.replace(/\(.*$/, '');

export interface MissingPaper { code: string; name: string; file: string; /** 기본으로 고를까 — 3000번대(위험대응) */ suggested: boolean }

/**
 * 양식의 보이는 조서 가운데 이 판에 같은 번호의 시트가(숨김 포함) 하나도 없는 것. 조서 번호 순.
 * 기본 체크는 3000번대만 — 같은 번호대(3150-1·3650)를 일부러 숨겨 둔 조서(통제테스트 안 함)는 뺀다.
 * 8000번대는 고를 때만(8550 심리사항점검표 = 심리실 소관, 8400 = 별도 파일 — 사용자 2026-09-26).
 */
export function missingPapers(book: Catalog, tpl: TemplateCatalog): MissingPaper[] {
  const have = new Set(book.sheets.filter((s) => s.code).map((s) => baseOf(s.code!)));
  const hidden = book.sheets.filter((s) => s.code && s.hidden).map((s) => baseOf(s.code!));
  // 같은 조서의 딸림(숨긴 3150-1 → 3150)이나 숨긴 조서의 확장(숨긴 3650 → 3650A 신규). 3300A 는 3300 과 다른 조서다.
  const hiddenFamily = (b: string) => hidden.some((h) => h.startsWith(`${b}-`) || b.startsWith(h));
  const seen = new Set<string>();
  const out: MissingPaper[] = [];
  for (const t of tpl.sheets) {
    if (t.hidden || !t.code) continue;
    const b = baseOf(t.code);
    if (have.has(b) || seen.has(b)) continue;
    seen.add(b);
    out.push({ code: b, name: t.name, file: t.file, suggested: /^3\d{3}/.test(b) && !hiddenFamily(b) });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
}

/** 고른 조서를 양식에서 넣는다. tplFiles 는 readBundle 이 준 묶음 파일. */
export function addPapers(
  bookBytes: Uint8Array, pick: MissingPaper[], tplFiles: Record<string, Uint8Array>, reviewer: string,
): { bytes: Uint8Array; added: string[] } {
  const files = unzip(bookBytes);
  const added: { name: string; part: string; code: string; src: string }[] = [];
  const books = new Map<string, Record<string, Uint8Array>>();
  for (const p of pick) {
    if (!books.has(p.file)) books.set(p.file, unzip(tplFiles[p.file]));
    const r = transplantSheet(files, books.get(p.file)!, p.name, { hidden: false });
    added.push({ name: r.name, part: r.part, code: p.code, src: p.file });
  }
  if (!added.length) return { bytes: bookBytes, added: [] };
  // 양식 수식의 시트 이름 → 이 판의 시트 이름(같은 번호), 머리는 표지·조서목록으로.
  const sheets = readWorkbook(zip(files));
  const link = headLinker(sheets, buildCatalog(sheets));
  const tplSheets = new Map<string, ReturnType<typeof readWorkbook>>();
  for (const a of added) {
    if (!tplSheets.has(a.src)) tplSheets.set(a.src, readWorkbook(tplFiles[a.src]));
    const nameMap = new Map<string, string>();
    for (const t of tplSheets.get(a.src)!) {
      const mine = findPaperSheet(sheets, baseOf(t.name.replace(/\s/g, '')));
      if (mine && mine.name !== t.name) nameMap.set(t.name, mine.name);
    }
    let xml = renameSheetRefs(strFromU8(files[a.part]), nameMap);
    const tplData = tplSheets.get(a.src)!.find((s) => s.name === a.name);
    const head = tplData ? link(tplData, a.code, reviewer) : [];
    if (head.length) xml = setCells(xml, head);
    files[a.part] = strToU8(setTabColor(xml, TAB.red));
    blackenSheet(files, a.part);
  }
  sortSheetsByCode(files);
  dropCalcChain(files);
  forceRecalc(files);
  return { bytes: zip(files), added: added.map((a) => a.name) };
}
