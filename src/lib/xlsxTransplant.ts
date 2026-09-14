// 워크북 사이에 **시트 한 장을 이식한다** — 한공회 표준양식의 조서 시트를 회사 조서 워크북에 넣기 위해.
//
// 왜 어려운가: 시트 XML 은 워크북의 서식표(styles.xml)와 공유문자열표(sharedStrings.xml)를 **번호로**
// 가리킨다. 다른 워크북에 그대로 옮기면 번호가 엉뚱한 서식·엉뚱한 글자를 가리킨다. 그래서
//   1) 글자는 인라인 문자열(inlineStr)로 바꿔 넣고(서식 있는 글자 조각 <r> 도 그대로 살린다),
//   2) 그 시트가 쓰는 서식(글꼴·채우기·테두리·숫자꼴·셀서식·조건부서식)만 대상 서식표 **뒤에 덧붙여**
//      번호를 바꿔 단다. 같은 것이 이미 있으면 그 번호를 쓴다(styles 가 무한정 불지 않게).
// 엑셀 라이브러리를 쓰지 않는 까닭은 주석·DSD 와 같다 — 명진 정산표를 exceljs 로 왕복시키면 정의된 이름
// 4,880개가 337개로 줄었다(2026-09-12). 회사 조서 워크북도 같은 종류의 파일이다.
//
// 버리는 것: 그림·도형·주석 상자·표 개체·확장 요소·외부 링크 수식(값만 남긴다). 조서 양식에는 글과
// 표·체크칸·드롭다운·병합·조건부서식이 전부라 이것으로 충분하다(2026-09-15 실물 확인).
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WS_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';

export interface Unzipped { files: Record<string, Uint8Array> }

function esc(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function unesc(s: string): string {
  return (s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
/** 태그 사이 공백만 지운 꼴 — 같은 서식인지 볼 때 쓴다. */
const key = (s: string) => s.replace(/>\s+</g, '><').trim();

// ── 워크북 뼈대 읽기 ─────────────────────────────────────────────
export interface SheetEntry { name: string; sheetId: number; rId: string; state?: string; part: string; raw: string }

/** workbook.xml 의 시트 목록 — 이름·번호·관계·부품 경로. */
export function sheetEntries(files: Record<string, Uint8Array>): SheetEntry[] {
  const wb = strFromU8(files['xl/workbook.xml'] ?? new Uint8Array());
  const rels = strFromU8(files['xl/_rels/workbook.xml.rels'] ?? new Uint8Array());
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/>/g)) {
    const id = /\bId="([^"]*)"/.exec(m[1])?.[1];
    const to = /\bTarget="([^"]*)"/.exec(m[1])?.[1];
    if (id && to) target.set(id, to.startsWith('/') ? to.slice(1) : `xl/${to}`);
  }
  const out: SheetEntry[] = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*?)\/>/g)) {
    const a = m[1];
    const rId = /\br:id="([^"]*)"/.exec(a)?.[1] ?? '';
    out.push({
      name: unesc(/\bname="([^"]*)"/.exec(a)?.[1] ?? ''),
      sheetId: Number(/\bsheetId="(\d+)"/.exec(a)?.[1] ?? 0),
      rId,
      state: /\bstate="([^"]*)"/.exec(a)?.[1],
      part: target.get(rId) ?? '',
      raw: m[0],
    });
  }
  return out;
}

// ── 서식표 ──────────────────────────────────────────────────────
interface Styles {
  numFmts: Map<number, string>;
  fonts: string[];
  fills: string[];
  borders: string[];
  cellXfs: string[];
  dxfs: string[];
}

/** 같은 이름의 하위 태그가 겹쳐 들어가지 않는 항목들만 다룬다(font 안에 font 없음). */
function itemsOf(xml: string, wrap: string, tag: string): string[] {
  const m = new RegExp(`<${wrap}\\b[^>]*>([\\s\\S]*?)</${wrap}>`).exec(xml);
  if (!m) return [];
  return m[1].match(new RegExp(`<${tag}\\b[^>]*/>|<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'g')) ?? [];
}

export function parseStyles(xml: string): Styles {
  const numFmts = new Map<number, string>();
  for (const it of itemsOf(xml, 'numFmts', 'numFmt')) {
    const id = Number(/numFmtId="(\d+)"/.exec(it)?.[1] ?? -1);
    const code = /formatCode="([^"]*)"/.exec(it)?.[1] ?? '';
    if (id >= 0) numFmts.set(id, code);
  }
  return {
    numFmts,
    fonts: itemsOf(xml, 'fonts', 'font'),
    fills: itemsOf(xml, 'fills', 'fill'),
    borders: itemsOf(xml, 'borders', 'border'),
    cellXfs: itemsOf(xml, 'cellXfs', 'xf'),
    dxfs: itemsOf(xml, 'dxfs', 'dxf'),
  };
}

/** 묶음의 닫는 태그 앞에 항목을 덧붙이고 count 를 올린다. 묶음이 없으면 만든다. */
function appendItems(xml: string, wrap: string, items: string[], makeBefore: RegExp): string {
  if (!items.length) return xml;
  const open = new RegExp(`<${wrap}\\b([^>]*)>`);
  const m = open.exec(xml);
  if (!m) {
    const at = xml.search(makeBefore);
    const block = `<${wrap} count="${items.length}">${items.join('')}</${wrap}>`;
    return at < 0 ? xml.replace('</styleSheet>', `${block}</styleSheet>`) : xml.slice(0, at) + block + xml.slice(at);
  }
  const close = `</${wrap}>`;
  const at = xml.indexOf(close, m.index);
  const countM = /count="(\d+)"/.exec(m[0]);
  const had = countM ? Number(countM[1]) : 0;
  const head = countM ? m[0].replace(/count="\d+"/, `count="${had + items.length}"`) : m[0];
  return xml.slice(0, m.index) + head + xml.slice(m.index + m[0].length, at) + items.join('') + xml.slice(at);
}

/**
 * 원본 시트가 쓰는 서식을 대상 서식표에 옮겨 넣고 **번호표**를 돌려준다.
 *
 * 대상에 같은 글꼴·채우기·테두리가 있으면 그 번호를 쓴다. 채우기 0·1 은 규격상 고정(없음·회색무늬)이라
 * 그대로 둔다. 셀서식(xf)은 바꾼 번호로 다시 지어 대상 뒤에 붙인다.
 */
export function mergeStyles(
  targetXml: string, source: Styles, usedXf: Set<number>, usedDxf: Set<number>,
): { xml: string; xfMap: Map<number, number>; dxfMap: Map<number, number> } {
  const tgt = parseStyles(targetXml);
  const index = (list: string[]) => new Map(list.map((s, i) => [key(s), i] as const));
  const idx = { fonts: index(tgt.fonts), fills: index(tgt.fills), borders: index(tgt.borders), cellXfs: index(tgt.cellXfs), dxfs: index(tgt.dxfs) };
  const add = { fonts: [] as string[], fills: [] as string[], borders: [] as string[], cellXfs: [] as string[], dxfs: [] as string[], numFmts: [] as string[] };
  const count = { fonts: tgt.fonts.length, fills: tgt.fills.length, borders: tgt.borders.length, cellXfs: tgt.cellXfs.length, dxfs: tgt.dxfs.length };

  function place(kind: 'fonts' | 'fills' | 'borders' | 'cellXfs' | 'dxfs', item: string): number {
    const k = key(item);
    const had = idx[kind].get(k);
    if (had != null) return had;
    const n = count[kind];
    idx[kind].set(k, n);
    add[kind].push(item);
    count[kind] += 1;
    return n;
  }

  // 숫자꼴 — 164 이상은 사용자 정의라 번호가 파일마다 다르다. 같은 formatCode 가 있으면 그 번호를 쓴다.
  const byCode = new Map([...tgt.numFmts].map(([id, code]) => [code, id] as const));
  let nextFmt = Math.max(163, ...tgt.numFmts.keys()) + 1;
  const fmtMap = new Map<number, number>();
  function numFmt(id: number): number {
    if (id < 164) return id;
    const had = fmtMap.get(id);
    if (had != null) return had;
    const code = source.numFmts.get(id);
    if (code == null) { fmtMap.set(id, 0); return 0; }
    let n = byCode.get(code);
    if (n == null) {
      n = nextFmt;
      nextFmt += 1;
      byCode.set(code, n);
      add.numFmts.push(`<numFmt numFmtId="${n}" formatCode="${code}"/>`);
    }
    fmtMap.set(id, n);
    return n;
  }

  const xfMap = new Map<number, number>();
  for (const old of [...usedXf].sort((a, b) => a - b)) {
    const raw = source.cellXfs[old];
    if (raw == null) { xfMap.set(old, 0); continue; }
    const at = (name: string) => Number(new RegExp(`\\b${name}="(\\d+)"`).exec(raw)?.[1] ?? 0);
    const fontId = place('fonts', source.fonts[at('fontId')] ?? source.fonts[0] ?? '<font/>');
    const fillSrc = at('fillId');
    const fillId = fillSrc <= 1 ? fillSrc : place('fills', source.fills[fillSrc] ?? '<fill><patternFill patternType="none"/></fill>');
    const borderId = place('borders', source.borders[at('borderId')] ?? source.borders[0] ?? '<border/>');
    const fmt = numFmt(at('numFmtId'));
    let xf = raw
      .replace(/\bfontId="\d+"/, `fontId="${fontId}"`)
      .replace(/\bfillId="\d+"/, `fillId="${fillId}"`)
      .replace(/\bborderId="\d+"/, `borderId="${borderId}"`)
      .replace(/\bnumFmtId="\d+"/, `numFmtId="${fmt}"`)
      .replace(/\bxfId="\d+"/, 'xfId="0"');
    if (!/\bxfId=/.test(xf)) xf = xf.replace(/<xf\b/, '<xf xfId="0"');
    xfMap.set(old, place('cellXfs', xf));
  }

  const dxfMap = new Map<number, number>();
  for (const old of usedDxf) {
    const raw = source.dxfs[old];
    dxfMap.set(old, raw == null ? 0 : place('dxfs', raw));
  }

  let xml = targetXml;
  xml = appendItems(xml, 'numFmts', add.numFmts, /<fonts\b/);
  xml = appendItems(xml, 'fonts', add.fonts, /<fills\b/);
  xml = appendItems(xml, 'fills', add.fills, /<borders\b/);
  xml = appendItems(xml, 'borders', add.borders, /<cellStyleXfs\b/);
  xml = appendItems(xml, 'cellXfs', add.cellXfs, /<cellStyles\b/);
  xml = appendItems(xml, 'dxfs', add.dxfs, /<tableStyles\b|<colors\b|<extLst\b/);
  return { xml, xfMap, dxfMap };
}

// ── 시트 XML 손질 ────────────────────────────────────────────────
/** sharedStrings 의 <si> 속을 차례로. 발음 조각(rPh)은 뺀다. */
export function sharedItems(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) {
    out.push((m[1] ?? '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<phoneticPr\b[^>]*\/>/g, ''));
  }
  return out;
}

/** 시트 XML 이 쓰는 셀서식 번호들(칸·행·열). */
export function usedStyleIds(sheetXml: string): { xf: Set<number>; dxf: Set<number> } {
  const xf = new Set<number>();
  for (const m of sheetXml.matchAll(/<c\b[^>]*\bs="(\d+)"/g)) xf.add(Number(m[1]));
  for (const m of sheetXml.matchAll(/<row\b[^>]*\bs="(\d+)"/g)) xf.add(Number(m[1]));
  for (const m of sheetXml.matchAll(/<col\b[^>]*\bstyle="(\d+)"/g)) xf.add(Number(m[1]));
  const dxf = new Set<number>();
  for (const m of sheetXml.matchAll(/\bdxfId="(\d+)"/g)) dxf.add(Number(m[1]));
  return { xf, dxf };
}

/**
 * 시트 XML 을 대상 워크북에 맞게 고친다 — 글자 인라인 · 서식 번호 교체 · 못 가져가는 것 제거.
 */
export function rewriteSheet(
  sheetXml: string, shared: string[], xfMap: Map<number, number>, dxfMap: Map<number, number>,
): string {
  let xml = sheetXml;
  const xfOf = (n: string) => String(xfMap.get(Number(n)) ?? 0);

  // 칸 — 공유문자열은 인라인으로, 서식 번호는 바꾼 것으로, 외부 링크 수식은 값만.
  xml = xml.replace(/<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g, (_m, attrs: string, tail: string, body?: string) => {
    let a = attrs.replace(/\bs="(\d+)"/, (_s, n: string) => `s="${xfOf(n)}"`);
    let b = body ?? '';
    if (/\bt="s"/.test(a)) {
      const n = Number(/<v>(\d+)<\/v>/.exec(b)?.[1] ?? -1);
      const si = shared[n];
      a = a.replace(/\bt="s"/, 't="inlineStr"');
      b = si == null ? '' : `<is>${si}</is>`;
      if (si == null) a = a.replace(/\s*\bt="inlineStr"/, '');
    }
    if (/<f\b[^>]*>[^<]*\[\d+\]/.test(b)) {
      // 다른 파일을 가리키는 수식([1]Sheet!A1) — 대상 워크북에는 그 파일이 없다. 값만 남긴다.
      b = b.replace(/<f\b[^>]*>[\s\S]*?<\/f>|<f\b[^>]*\/>/g, '');
    }
    if (!b && tail === '/>') return `<c${a}/>`;
    return b ? `<c${a}>${b}</c>` : `<c${a}/>`;
  });
  xml = xml.replace(/<row\b([^>]*?)\bs="(\d+)"/g, (_m, pre: string, n: string) => `<row${pre}s="${xfOf(n)}"`);
  xml = xml.replace(/<col\b([^>]*?)\bstyle="(\d+)"/g, (_m, pre: string, n: string) => `<col${pre}style="${xfOf(n)}"`);
  xml = xml.replace(/\bdxfId="(\d+)"/g, (_m, n: string) => `dxfId="${dxfMap.get(Number(n)) ?? 0}"`);

  // 다른 부품을 가리키는 것들 — 관계(rels)가 함께 오지 않으므로 뺀다.
  xml = xml
    .replace(/<legacyDrawing\b[^>]*\/>/g, '')
    .replace(/<legacyDrawingHF\b[^>]*\/>/g, '')
    .replace(/<drawing\b[^>]*\/>/g, '')
    .replace(/<picture\b[^>]*\/>/g, '')
    .replace(/<oleObjects\b[\s\S]*?<\/oleObjects>/g, '')
    .replace(/<controls\b[\s\S]*?<\/controls>/g, '')
    .replace(/<tableParts\b[\s\S]*?<\/tableParts>/g, '')
    .replace(/<tableParts\b[^>]*\/>/g, '')
    .replace(/<extLst\b[\s\S]*?<\/extLst>/g, '')
    .replace(/<pageSetup\b([^>]*?)\s+r:id="[^"]*"/g, '<pageSetup$1')
    .replace(/<hyperlink\b[^>]*\br:id="[^"]*"[^>]*\/>/g, '')
    .replace(/<hyperlinks>\s*<\/hyperlinks>/g, '')
    .replace(/\btabSelected="1"/g, '')
    .replace(/<sheetPr\b([^>]*?)\s+codeName="[^"]*"/g, '<sheetPr$1');
  return xml;
}

// ── 이식 ────────────────────────────────────────────────────────
export interface TransplantOptions {
  /** 대상에서 쓸 시트 이름. 없으면 원본 이름 그대로. */ as?: string;
  /** 같은 이름의 시트가 있으면 **그 자리에 갈아끼운다**(부품은 지운다). 없으면 뒤에 붙인다. */ replace?: boolean;
  /** 숨김 여부. 없으면 갈아끼울 때는 원래 상태, 새로 붙일 때는 보임. */ hidden?: boolean;
}

export interface TransplantResult { files: Record<string, Uint8Array>; part: string; name: string }

/**
 * `source` 워크북의 `sheetName` 시트를 `target` 워크북(풀어 둔 것)에 넣는다. 대상은 제자리에서 고친다.
 *
 * 여러 장을 넣을 때는 대상을 한 번만 풀고 이 함수를 거듭 부른 뒤 `zipSync` 한다.
 */
export function transplantSheet(
  target: Record<string, Uint8Array>, source: Record<string, Uint8Array>, sheetName: string,
  opts: TransplantOptions = {},
): TransplantResult {
  const src = sheetEntries(source).find((s) => s.name === sheetName);
  if (!src || !source[src.part]) throw new Error(`원본에 「${sheetName}」 시트가 없습니다.`);
  const srcXml = strFromU8(source[src.part]);
  const shared = source['xl/sharedStrings.xml'] ? sharedItems(strFromU8(source['xl/sharedStrings.xml'])) : [];
  const srcStyles = parseStyles(source['xl/styles.xml'] ? strFromU8(source['xl/styles.xml']) : '');
  const used = usedStyleIds(srcXml);

  const tStylesXml = target['xl/styles.xml'] ? strFromU8(target['xl/styles.xml']) : MINIMAL_STYLES;
  const merged = mergeStyles(tStylesXml, srcStyles, used.xf, used.dxf);
  target['xl/styles.xml'] = strToU8(merged.xml);
  const sheetXml = rewriteSheet(srcXml, shared, merged.xfMap, merged.dxfMap);

  let workbook = strFromU8(target['xl/workbook.xml']);
  let rels = strFromU8(target['xl/_rels/workbook.xml.rels']);
  let types = strFromU8(target['[Content_Types].xml']);
  const name = opts.as ?? sheetName;
  const entries = sheetEntries(target);
  const old = entries.find((e) => e.name === name);

  // 부품 이름·번호 — 겹치지 않게.
  let n = 1;
  while (target[`xl/worksheets/gwp${n}.xml`]) n += 1;
  const part = `xl/worksheets/gwp${n}.xml`;
  const usedRIds = [...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  const rId = `rId${Math.max(0, ...usedRIds) + 1}`;

  let sheetId: number;
  let state = opts.hidden === true ? ' state="hidden"' : '';
  if (old && opts.replace) {
    // 옛 부품과 그 관계·종류 등록을 지운다. 자리(차례)와 번호는 그대로 물려받는다.
    delete target[old.part];
    const oldRels = old.part.replace(/worksheets\/([^/]+)$/, 'worksheets/_rels/$1.rels');
    delete target[oldRels];
    rels = rels.replace(new RegExp(`<Relationship\\b[^>]*\\bId="${old.rId}"[^>]*/>`), '');
    types = types.replace(new RegExp(`<Override\\b[^>]*PartName="/${old.part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*/>`), '');
    sheetId = old.sheetId;
    if (opts.hidden == null && old.state) state = ` state="${old.state}"`;
    workbook = workbook.replace(old.raw, `<sheet name="${esc(name)}" sheetId="${sheetId}"${state} r:id="${rId}"/>`);
  } else {
    if (old) throw new Error(`대상에 「${name}」 시트가 이미 있습니다.`);
    sheetId = Math.max(0, ...entries.map((e) => e.sheetId)) + 1;
    workbook = workbook.replace('</sheets>', `<sheet name="${esc(name)}" sheetId="${sheetId}"${state} r:id="${rId}"/></sheets>`);
  }
  rels = rels.replace('</Relationships>',
    `<Relationship Id="${rId}" Type="${R_NS}/worksheet" Target="${part.replace('xl/', '')}"/></Relationships>`);
  types = types.replace('</Types>', `<Override PartName="/${part}" ContentType="${WS_TYPE}"/></Types>`);

  target[part] = strToU8(sheetXml);
  target['xl/workbook.xml'] = strToU8(workbook);
  target['xl/_rels/workbook.xml.rels'] = strToU8(rels);
  target['[Content_Types].xml'] = strToU8(types);
  return { files: target, part, name };
}

/** 계산 순서 캐시를 지운다 — 시트가 바뀌면 어긋난다. 엑셀이 열 때 다시 만든다. */
export function dropCalcChain(files: Record<string, Uint8Array>): void {
  delete files['xl/calcChain.xml'];
  if (files['[Content_Types].xml']) {
    files['[Content_Types].xml'] = strToU8(
      strFromU8(files['[Content_Types].xml']).replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/g, ''),
    );
  }
  if (files['xl/_rels/workbook.xml.rels']) {
    files['xl/_rels/workbook.xml.rels'] = strToU8(
      strFromU8(files['xl/_rels/workbook.xml.rels']).replace(/<Relationship[^>]*calcChain\.xml"[^>]*\/>/g, ''),
    );
  }
}

/**
 * 열 때 **전부 다시 계산**하게 한다 — 옮겨 온 시트의 수식(`='8100'!B4`)은 원본 파일의 값을 캐시로
 * 들고 있어, 다시 계산하기 전에는 엉뚱한 값(0)이 보인다.
 */
export function forceRecalc(files: Record<string, Uint8Array>): void {
  let wb = strFromU8(files['xl/workbook.xml']);
  if (/<calcPr\b/.test(wb)) {
    wb = wb.replace(/<calcPr\b([^>]*?)\s*fullCalcOnLoad="[^"]*"/, '<calcPr$1').replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"');
  } else {
    wb = wb.replace('</sheets>', '</sheets><calcPr fullCalcOnLoad="1"/>');
  }
  files['xl/workbook.xml'] = strToU8(wb);
}

/** 시트의 숨김을 바꾼다. */
export function setSheetHidden(files: Record<string, Uint8Array>, name: string, hidden: boolean): boolean {
  const e = sheetEntries(files).find((s) => s.name === name);
  if (!e) return false;
  let raw = e.raw.replace(/\s+state="[^"]*"/, '');
  if (hidden) raw = raw.replace(/\/>$/, ' state="hidden"/>');
  files['xl/workbook.xml'] = strToU8(strFromU8(files['xl/workbook.xml']).replace(e.raw, raw));
  return true;
}

export function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new Error('엑셀 파일이 아닌 것 같습니다(ZIP 형식이 아닙니다).');
  return unzipSync(bytes);
}
export function zip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files, { level: 6 });
}

export const MINIMAL_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill>'
  + '<fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
  + '</styleSheet>';
