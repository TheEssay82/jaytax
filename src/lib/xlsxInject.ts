// 이미 있는 엑셀 파일에 **시트만 얹는다.** 나머지는 한 바이트도 건드리지 않는다.
//
// 왜 이렇게까지 하는가: 엑셀 라이브러리로 정산표를 읽어 다시 쓰면 **파일이 망가진다.**
// 명진 정산표(551KB)를 exceljs 로 왕복시켜 봤더니(2026-09-12) —
//   · 시트 28장 → 16장 (숨은 시트 12장 전멸)
//   · 정의된 이름 4,880개 → 337개
//   · 파일 551KB → 95KB
// 감사조서를 그렇게 망가뜨릴 수는 없다.
//
// xlsx 는 ZIP 이므로, 원본 항목은 그대로 옮겨 담고 **새 시트 부품만 더한다.**
// 손대는 곳은 네 군데뿐이다:
//   1) xl/worksheets/…xml   새로 만든다
//   2) xl/workbook.xml      <sheets> 에 한 줄
//   3) xl/_rels/workbook.xml.rels  관계 한 줄
//   4) [Content_Types].xml  부품 종류 한 줄
// 그리고 xl/calcChain.xml 은 **지운다** — 수식 계산 순서를 적어 둔 캐시라, 시트가 늘면
// 어긋날 수 있다. 없으면 엑셀이 열 때 알아서 다시 만든다.
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import type { SheetPlan } from './noteSheet';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WS_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';

function esc(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 1=A, 2=B, … 27=AA */
export function colName(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** 시트 배치 하나를 워크시트 XML 로. 글자는 inlineStr 로 넣어 sharedStrings 를 건드리지 않는다. */
export function sheetXml(plan: SheetPlan): string {
  const byRow = new Map<number, SheetPlan['cells']>();
  for (const c of plan.cells) {
    if (!byRow.has(c.row)) byRow.set(c.row, []);
    byRow.get(c.row)!.push(c);
  }
  const rows = [...byRow.keys()].sort((a, b) => a - b).map((r) => {
    const cells = byRow.get(r)!.sort((a, b) => a.col - b.col).map((c) => {
      const ref = `${colName(c.col)}${r}`;
      if (c.num != null) return `<c r="${ref}"><v>${c.num}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(c.text)}</t></is></c>`;
    }).join('');
    return `<row r="${r}">${cells}</row>`;
  }).join('');
  // A열(자리표)은 숨기고, C열은 글이 길어 넉넉히 준다.
  const cols = '<cols>'
    + '<col min="1" max="1" width="12" hidden="1"/>'
    + '<col min="2" max="2" width="10" customWidth="1"/>'
    + '<col min="3" max="3" width="58" customWidth="1"/>'
    + '<col min="4" max="14" width="16" customWidth="1"/>'
    + '</cols>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="${NS}" xmlns:r="${R_NS}">${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

/** 이미 있는 xlsx 에 시트들을 더한 새 파일을 만든다. 원본 항목은 그대로 옮겨 담는다. */
export function injectSheets(src: Uint8Array, plans: SheetPlan[]): Uint8Array {
  const files = unzipSync(src);
  const get = (n: string) => (files[n] ? strFromU8(files[n]) : '');

  let workbook = get('xl/workbook.xml');
  let rels = get('xl/_rels/workbook.xml.rels');
  let types = get('[Content_Types].xml');
  if (!workbook || !rels || !types) throw new Error('엑셀 파일 구조를 알아보지 못했습니다.');

  // 겹치지 않는 번호 고르기
  const usedSheetIds = [...workbook.matchAll(/sheetId="(\d+)"/g)].map((m) => Number(m[1]));
  const usedRIds = [...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  const usedFiles = new Set(Object.keys(files));
  let nextSheetId = Math.max(0, ...usedSheetIds) + 1;
  let nextRId = Math.max(0, ...usedRIds) + 1;
  let nextFile = 1;

  const addedSheets: string[] = [];
  const addedRels: string[] = [];
  const addedTypes: string[] = [];
  const existing = new Set([...workbook.matchAll(/<sheet[^>]*name="([^"]*)"/g)].map((m) => m[1]));

  for (const plan of plans) {
    let name = plan.name;
    let n = 2;
    while (existing.has(name)) { name = `${plan.name.slice(0, 28)}(${n})`; n += 1; }
    existing.add(name);

    while (usedFiles.has(`xl/worksheets/note${nextFile}.xml`)) nextFile += 1;
    const path = `xl/worksheets/note${nextFile}.xml`;
    usedFiles.add(path);
    nextFile += 1;

    files[path] = strToU8(sheetXml(plan));
    addedSheets.push(`<sheet name="${esc(name)}" sheetId="${nextSheetId}" r:id="rId${nextRId}"/>`);
    addedRels.push(`<Relationship Id="rId${nextRId}" Type="${R_NS}/worksheet" Target="${path.replace('xl/', '')}"/>`);
    addedTypes.push(`<Override PartName="/${path}" ContentType="${WS_TYPE}"/>`);
    nextSheetId += 1;
    nextRId += 1;
  }

  workbook = workbook.replace('</sheets>', `${addedSheets.join('')}</sheets>`);
  rels = rels.replace('</Relationships>', `${addedRels.join('')}</Relationships>`);
  types = types.replace('</Types>', `${addedTypes.join('')}</Types>`);

  files['xl/workbook.xml'] = strToU8(workbook);
  files['xl/_rels/workbook.xml.rels'] = strToU8(rels);
  files['[Content_Types].xml'] = strToU8(types);

  // 계산 순서 캐시는 지운다 — 엑셀이 열 때 다시 만든다.
  delete files['xl/calcChain.xml'];
  files['[Content_Types].xml'] = strToU8(
    strFromU8(files['[Content_Types].xml']).replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/g, ''),
  );
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    strFromU8(files['xl/_rels/workbook.xml.rels']).replace(/<Relationship[^>]*calcChain\.xml"[^>]*\/>/g, ''),
  );

  return zipSync(files, { level: 6 });
}
