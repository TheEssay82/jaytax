// 일반조서 **초도 조립** — 전기 파일이 없는 회사(초도 외감)의 당기 워크북을 표준양식만으로 짓는다.
//
// 사무소 파일의 모양을 그대로 따른다(명진 FY25, 2026-09-15): 앞에 「조서표지(공통사항)」·「조서목록」,
// 그 뒤에 조서 시트가 코드 차례로. 조서 시트는 양식 묶음에서 그대로 이식하고(xlsxTransplant), 머리의
// 회사명·결산일은 표지로, 작성자·일자는 조서목록의 그 조서 줄로 링크한다(이월과 같은 규칙).
//
// 표지·목록 두 장은 우리가 짓는다(xlsxInject) — 묶음에는 K-IFRS 용 표지가 없다(소규모만 「01 조서파일」).
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { injectSheets } from './xlsxInject';
import { readWorkbook } from './xlsxRead';
import { type SheetPlan, type SheetCell } from './noteSheet';
import { MINIMAL_STYLES } from './xlsxStyles';
import { sectionOf, isoDate } from './gwpCatalog';
import { type TemplateCatalog, type TemplateSheet } from './gwpTemplate';
import { transplantSheet, dropCalcChain, forceRecalc } from './xlsxTransplant';
import { headRefs, headEdits } from './gwpRoll';
import { setCells } from './xlsxCells';

export const COVER_SHEET = '조서표지(공통사항)';
export const INDEX_SHEET_NAME = '조서목록';

export interface AssembleOptions {
  company: string;
  /** 「2026-12-31」 */ closing: string;
  /** 「제1기 2026년 1월 1일 ～ 2026년 12월 31일」 */ period: string;
  basis: string;
  firmName?: string;
  /** 초도감사인가 — 표지의 수임구분 */ firstYear?: boolean;
}

/** 시트가 하나도 없는 빈 워크북. injectSheets 가 시트를 얹을 수 있는 최소 뼈대다. */
export function emptyWorkbook(): Uint8Array {
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '</Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + `<Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
      + ` xmlns:r="${R}"><sheets></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + `<Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(MINIMAL_STYLES),
  }, { level: 6 });
}

/** 표지 — 명진 실물 배치(A2 감사인명 · A7 감사조서철 · A10~A17 항목/B 값). */
export function coverPlan(o: AssembleOptions): SheetPlan {
  const c: SheetCell[] = [
    { row: 2, col: 1, text: `감사인명 : ${o.firmName ?? '인덕회계법인'}`, kind: 'label' },
    { row: 7, col: 1, text: '감 사 조 서 철', kind: 'title' },
    { row: 8, col: 1, text: `(${o.basis})`, kind: 'label' },
    { row: 10, col: 1, text: '조서구분', kind: 'label' }, { row: 10, col: 2, text: '당기조서', kind: 'text' },
    { row: 11, col: 1, text: '수임구분', kind: 'label' }, { row: 11, col: 2, text: o.firstYear === false ? '계속감사' : '초도감사', kind: 'text' },
    { row: 12, col: 1, text: '업무내용', kind: 'label' }, { row: 12, col: 2, text: '재무제표감사', kind: 'text' },
    { row: 13, col: 1, text: '보존기간(감사종료시점부터 8년)', kind: 'label' },
    { row: 14, col: 1, text: '회 사 명', kind: 'label' }, { row: 14, col: 2, text: o.company, kind: 'input' },
    { row: 15, col: 1, text: '결산일', kind: 'label' }, { row: 15, col: 2, text: o.closing, kind: 'input' },
    { row: 16, col: 1, text: '대상기간', kind: 'label' }, { row: 16, col: 2, text: o.period, kind: 'input' },
    { row: 17, col: 1, text: '감사보고서일', kind: 'label' }, { row: 17, col: 2, text: '', kind: 'input' },
    { row: 18, col: 1, text: '주 소', kind: 'label' }, { row: 18, col: 2, text: '', kind: 'input' },
    { row: 19, col: 1, text: '전화번호', kind: 'label' }, { row: 19, col: 2, text: '', kind: 'input' },
    { row: 20, col: 1, text: '팩스번호', kind: 'label' }, { row: 20, col: 2, text: '', kind: 'input' },
    { row: 21, col: 1, text: '조 서 내 용', kind: 'label' }, { row: 21, col: 3, text: '감 사 담 당 자', kind: 'label' },
    { row: 22, col: 3, text: '구 분', kind: 'head' }, { row: 22, col: 4, text: '성 명', kind: 'head' }, { row: 22, col: 5, text: '서 명', kind: 'head' },
  ];
  return { name: COVER_SHEET, cells: c, lastRow: 22, tables: [] };
}

export interface IndexEntry { code: string; title: string; row: number }

/**
 * 조서목록 — 사무소 배치 그대로: B 조서명 · C 수행여부 · D 작성자 · E 작성일, 7행부터 묶음 머리와 줄.
 * 어느 코드가 몇 행인지 돌려준다 — 조서 머리의 링크가 이 행을 가리킨다.
 */
export function indexPlan(entries: { code: string; title: string }[], company: string): { plan: SheetPlan; rows: IndexEntry[] } {
  const c: SheetCell[] = [
    { row: 2, col: 2, text: '일반조서목록(General File Index)', kind: 'title' },
    { row: 5, col: 2, text: '회 사 명 :', kind: 'label' }, { row: 5, col: 3, text: company, kind: 'text' },
    { row: 7, col: 2, text: '조서명', kind: 'head' }, { row: 7, col: 3, text: '수 행 여 부', kind: 'head' },
    { row: 7, col: 4, text: '작 성 자', kind: 'head' }, { row: 7, col: 5, text: '작 성 일', kind: 'head' },
  ];
  const rows: IndexEntry[] = [];
  const order = ['감사계약', '위험평가', '위험에 대한 대응', '그룹감사', '감사완결', '내부회계관리제도', '기타'];
  const num: Record<string, string> = { 감사계약: '1000', 위험평가: '2000', '위험에 대한 대응': '3000', 그룹감사: '7000', 감사완결: '8000', 내부회계관리제도: '9000' };
  let r = 8;
  for (const sec of order) {
    const list = entries.filter((e) => sectionOf(e.code) === sec);
    if (!list.length) continue;
    c.push({ row: r, col: 2, text: num[sec] ? `${sec}(${num[sec]})` : sec, kind: 'label' });
    r += 1;
    for (const e of list) {
      c.push({ row: r, col: 2, text: `${e.code} ${e.title}`.trim(), kind: 'text' });
      c.push({ row: r, col: 3, text: '', kind: 'input' });
      c.push({ row: r, col: 4, text: '', kind: 'input' });
      c.push({ row: r, col: 5, text: '', kind: 'input' });
      rows.push({ code: e.code, title: e.title, row: r });
      r += 1;
    }
    r += 1;
  }
  c.push({ row: r + 1, col: 2, text: '(주) 본 목록은 예시적으로 열거된 것이므로 필요시 추가하여야 함.', kind: 'para' });
  return { plan: { name: INDEX_SHEET_NAME, cells: c, lastRow: r + 1, tables: [] }, rows };
}

/** 조서 제목 — 시트 1~3행의 「2301  감사위험의 평가 (기준서 315)」에서 코드를 뗀 것. 없으면 시트 이름. */
export function titleOf(cells: Map<string, { text?: string }>, code: string, name: string): string {
  for (const ref of ['A1', 'A2', 'A3', 'B1', 'B2', 'B3']) {
    const t = (cells.get(ref)?.text ?? '').trim();
    const base = code.replace(/\(.*$/, '');
    if (t.startsWith(base)) return t.slice(base.length).replace(/^[\s:：.-]+/, '').replace(/\s+/g, ' ').trim() || name;
  }
  return name;
}

export interface AssembleReport {
  added: { code: string; name: string; file: string }[];
  skipped: { name: string; why: string }[];
}

/** 표준양식만으로 당기 워크북을 짓는다. 코드가 같은 시트가 여럿이면 보이는 첫 것만. */
export function assembleWorkbook(
  tpl: TemplateCatalog, tplFiles: Record<string, Uint8Array>, opts: AssembleOptions,
): { bytes: Uint8Array; report: AssembleReport } {
  const report: AssembleReport = { added: [], skipped: [] };
  const seen = new Set<string>();
  const picked: TemplateSheet[] = [];
  for (const s of tpl.sheets) {
    if (!s.code) continue;
    if (s.hidden) { report.skipped.push({ name: s.name, why: '양식에서 숨긴 시트' }); continue; }
    if (seen.has(s.code)) { report.skipped.push({ name: s.name, why: '같은 코드가 이미 있음' }); continue; }
    seen.add(s.code);
    picked.push(s);
  }
  picked.sort((a, b) => a.code!.localeCompare(b.code!, 'en', { numeric: true }));

  const sheetCache = new Map<string, ReturnType<typeof readWorkbook>>();
  const filesCache = new Map<string, Record<string, Uint8Array>>();
  const sheetsOf = (file: string) => { if (!sheetCache.has(file)) sheetCache.set(file, readWorkbook(tplFiles[file])); return sheetCache.get(file)!; };
  const filesOf = (file: string) => { if (!filesCache.has(file)) filesCache.set(file, unzipSync(tplFiles[file])); return filesCache.get(file)!; };

  const entries = picked.map((s) => {
    const data = sheetsOf(s.file).find((x) => x.name === s.name);
    return { code: s.code!, title: data ? titleOf(data.cells, s.code!, s.name) : s.name };
  });
  const idx = indexPlan(entries, opts.company);
  const base = injectSheets(emptyWorkbook(), [coverPlan(opts), idx.plan]);
  const files = unzipSync(base);
  const rowOf = new Map(idx.rows.map((r) => [r.code, r.row]));

  for (const s of picked) {
    const data = sheetsOf(s.file).find((x) => x.name === s.name);
    if (!data) { report.skipped.push({ name: s.name, why: '양식 파일에서 읽지 못함' }); continue; }
    const r = transplantSheet(files, filesOf(s.file), s.name);
    const edits = headEdits(headRefs(data), COVER_SHEET, INDEX_SHEET_NAME, rowOf.get(s.code!) ?? null, '');
    if (edits.length) files[r.part] = strToU8(setCells(strFromU8(files[r.part]), edits));
    report.added.push({ code: s.code!, name: s.name, file: s.file });
  }
  dropCalcChain(files);
  forceRecalc(files);
  return { bytes: zipSync(files, { level: 6 }), report };
}

export { isoDate };
