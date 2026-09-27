// 엑셀에 표시를 한다 — 시트 탭 색과 칸 바탕색. 엑셀 라이브러리 없이 ZIP 안 XML 을 고친다(DSD·일반조서와 같은 원칙).
//
// 일반조서 사무소 관행(사용자 2026-09-27):
//   탭 빨강 = 올해 아직 손대지 않은 시트 · 노랑 = 수정한 시트 · 초록 = 확인했고 새로 넣을 것이 없는 시트.
//   시트 안에서 바뀐 칸은 노란 바탕으로 표시한다.
import { strFromU8, strToU8 } from 'fflate';

export const TAB = { red: 'FFFF0000', yellow: 'FFFFFF00', green: 'FF00B050' } as const;
export const CELL_YELLOW = 'FFFFFF00';

/** 탭 색 → 사무소 관행의 뜻. 모르는 색이면 null. 색이 조금 달라도(연두·주황) 가까운 쪽으로 본다. */
export type TabState = 'red' | 'yellow' | 'green';
export function tabStateOf(rgb: string | null | undefined): TabState | null {
  const m = /^(?:[0-9A-F]{2})?([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i.exec((rgb ?? '').trim());
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  if (r > 180 && g < 110 && b < 110) return 'red';
  if (r > 180 && g > 170 && b < 120) return 'yellow';
  if (g > 120 && r < 170 && b < 170) return 'green';
  return null;
}

/** 시트 XML 에서 탭 색(rgb)을 읽는다. 테마 색은 「theme:N」. 없으면 null. */
export function tabColorOf(sheetXml: string): string | null {
  const pr = /<sheetPr\b[^>]*?(?:\/>|>([\s\S]*?)<\/sheetPr>)/.exec(sheetXml);
  const inner = pr?.[1] ?? '';
  const tc = /<tabColor\b([^>]*?)\/>/.exec(inner);
  if (!tc) return null;
  const rgb = /\brgb="([^"]+)"/.exec(tc[1])?.[1];
  if (rgb) return rgb.toUpperCase();
  const theme = /\btheme="([^"]+)"/.exec(tc[1])?.[1];
  return theme != null ? `theme:${theme}` : null;
}

/** 시트 XML 의 탭 색을 바꾼다. sheetPr 은 worksheet 의 첫 자식, tabColor 는 sheetPr 의 첫 자식이어야 한다. */
export function setTabColor(sheetXml: string, rgb: string): string {
  const tag = `<tabColor rgb="${rgb}"/>`;
  const self = /<sheetPr\b([^>]*?)\/>/.exec(sheetXml);
  if (self) return sheetXml.replace(self[0], `<sheetPr${self[1]}>${tag}</sheetPr>`);
  const open = /<sheetPr\b([^>]*)>([\s\S]*?)<\/sheetPr>/.exec(sheetXml);
  if (open) {
    const inner = open[2].replace(/<tabColor\b[^>]*?\/>/, '');
    return sheetXml.replace(open[0], `<sheetPr${open[1]}>${tag}${inner}</sheetPr>`);
  }
  const ws = /<worksheet\b[^>]*>/.exec(sheetXml);
  if (!ws) return sheetXml;
  return sheetXml.slice(0, ws.index + ws[0].length) + `<sheetPr>${tag}</sheetPr>` + sheetXml.slice(ws.index + ws[0].length);
}

// ── 칸 바탕색 ─────────────────────────────────────────────
/** 한 통합문서 안에서 같은 바탕색·같은 원래 서식이면 새 서식을 한 번만 만든다. */
const cache = new WeakMap<Record<string, Uint8Array>, Map<string, { fillId: number; xf: Map<number, number> }>>();

const XF_RE = /<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g;

function ensureFill(files: Record<string, Uint8Array>, rgb: string): { fillId: number; xf: Map<number, number> } {
  let perFile = cache.get(files);
  if (!perFile) { perFile = new Map(); cache.set(files, perFile); }
  const hit = perFile.get(rgb);
  if (hit) return hit;
  const path = 'xl/styles.xml';
  let xml = strFromU8(files[path]);
  const fills = /<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(xml);
  if (!fills) throw new Error('styles.xml 에 fills 가 없습니다.');
  const n = [...fills[1].matchAll(/<fill\b[\s\S]*?(?:<\/fill>|\/>)/g)].length;
  const add = `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
  const newFills = `<fills count="${n + 1}">${fills[1]}${add}</fills>`;
  xml = xml.replace(fills[0], newFills);
  files[path] = strToU8(xml);
  const entry = { fillId: n, xf: new Map<number, number>() };
  perFile.set(rgb, entry);
  return entry;
}

// ── 글자색 검정 ───────────────────────────────────────────
// 사용자 2026-09-28: 「전체적으로 폰트색까지 변경할 필요는 없어. 폰트색은 검정색으로 — 눈이 아픈 시트가 많아」.
// 한공회 양식은 입력 칸이 파란 글씨다. 시스템이 칠하는 칸과 새로 넣은 양식 시트의 글자는 검정으로 둔다.
const FONT_RE = /<font\b[^>]*?(?:\/>|>[\s\S]*?<\/font>)/g;
/** 이 글꼴이 검정(또는 기본)인가 — 색이 없거나, 검정 rgb, 테마 1(본문 어두운색), 색인 8·64(검정·자동). */
export function isBlackFont(font: string): boolean {
  const c = /<color\b([^>]*?)\/>/.exec(font)?.[1];
  if (!c) return true;
  const rgb = /\brgb="([0-9A-Fa-f]{6,8})"/.exec(c)?.[1];
  if (rgb) return /000000$/i.test(rgb);
  const theme = /\btheme="(\d+)"/.exec(c)?.[1];
  if (theme != null) return theme === '1' && !/\btint=/.test(c);
  const idx = /\bindexed="(\d+)"/.exec(c)?.[1];
  if (idx != null) return idx === '8' || idx === '64';
  return /\bauto="1"/.test(c);
}
const blackCache = new WeakMap<Record<string, Uint8Array>, Map<number, number>>();
/** fontId 번 글꼴을 검정으로 본뜬 글꼴 번호(이미 검정이면 그대로). */
function blackFontId(files: Record<string, Uint8Array>, fontId: number): number {
  let per = blackCache.get(files);
  if (!per) { per = new Map(); blackCache.set(files, per); }
  const hit = per.get(fontId);
  if (hit != null) return hit;
  const path = 'xl/styles.xml';
  let xml = strFromU8(files[path]);
  const fonts = /<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(xml);
  const list = fonts ? [...fonts[1].matchAll(FONT_RE)].map((m) => m[0]) : [];
  const base = list[fontId];
  if (!fonts || !base || isBlackFont(base)) { per.set(fontId, fontId); return fontId; }
  const black = /<color\b[^>]*?\/>/.test(base)
    ? base.replace(/<color\b[^>]*?\/>/, '<color rgb="FF000000"/>')
    : base.replace(/<\/font>$/, '<color rgb="FF000000"/></font>');
  const id = list.length;
  xml = xml.replace(fonts[0], `<fonts count="${id + 1}">${fonts[1]}${black}</fonts>`);
  files[path] = strToU8(xml);
  per.set(fontId, id);
  return id;
}

/** 원래 서식(cellXfs 의 k 번)에 바탕색을 바꾸고(fill) 글자를 검정으로 한 서식을 만들어 번호를 돌려준다. */
function xfWithFill(files: Record<string, Uint8Array>, entry: { fillId: number | null; xf: Map<number, number> }, k: number): number {
  const hit = entry.xf.get(k);
  if (hit != null) return hit;
  const path = 'xl/styles.xml';
  let xml = strFromU8(files[path]);
  const cx = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  if (!cx) throw new Error('styles.xml 에 cellXfs 가 없습니다.');
  const xfs = [...cx[1].matchAll(XF_RE)].map((m) => m[0]);
  const base = xfs[k] ?? xfs[0];
  const open = /^<xf\b([^>]*?)(\/?)>/.exec(base)!;
  const fontId = Number(/\bfontId="(\d+)"/.exec(open[1])?.[1] ?? '0');
  const black = blackFontId(files, fontId);
  // 글꼴만 바꿀 때(fill 없음) 이미 검정이면 새 서식을 만들지 않는다.
  if (entry.fillId == null && black === fontId) { entry.xf.set(k, k); return k; }
  xml = strFromU8(files[path]);                                 // blackFontId 가 styles 를 고쳤을 수 있다
  const cx2 = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)!;
  const xfs2 = [...cx2[1].matchAll(XF_RE)].map((m) => m[0]);
  let attrs = open[1].replace(/\s*\bfontId="[^"]*"/, '').replace(/\s*\bapplyFont="[^"]*"/, '');
  attrs += ` fontId="${black}"${black !== fontId ? ' applyFont="1"' : ''}`;
  if (entry.fillId != null) {
    attrs = attrs.replace(/\s*\bfillId="[^"]*"/, '').replace(/\s*\bapplyFill="[^"]*"/, '');
    attrs += ` fillId="${entry.fillId}" applyFill="1"`;
  }
  const clone = base.replace(open[0], `<xf${attrs}${open[2]}>`);
  const id = xfs2.length;
  xml = xml.replace(cx2[0], `<cellXfs count="${id + 1}">${cx2[1]}${clone}</cellXfs>`);
  files[path] = strToU8(xml);
  entry.xf.set(k, id);
  return id;
}

/** 시트의 모든 칸 글자를 검정으로 — 새로 넣거나 갈아끼운 양식 시트. 바탕색·테두리 등은 그대로. */
const blackXfCache = new WeakMap<Record<string, Uint8Array>, { fillId: null; xf: Map<number, number> }>();
export function blackenSheet(files: Record<string, Uint8Array>, sheetPart: string): number {
  if (!files['xl/styles.xml'] || !files[sheetPart]) return 0;
  let entry = blackXfCache.get(files);
  if (!entry) { entry = { fillId: null, xf: new Map() }; blackXfCache.set(files, entry); }
  let n = 0;
  const xml = strFromU8(files[sheetPart]).replace(/(<c\b[^>]*?\bs=")(\d+)(")/g, (m, a: string, s: string, z: string) => {
    const ns = xfWithFill(files, entry!, Number(s));
    if (ns === Number(s)) return m;
    n += 1;
    return `${a}${ns}${z}`;
  });
  files[sheetPart] = strToU8(xml);
  return n;
}

/**
 * 시트의 칸들에 바탕색을 칠하고 글자는 검정으로 둔다. 값·수식은 건드리지 않고 서식 번호만 바꾼다.
 * 칸이 없으면(값을 비운 칸 등) 빈 칸을 만들어 칠한다 — 「여기를 채우세요」가 보이게.
 */
export function highlightCells(files: Record<string, Uint8Array>, sheetPart: string, refs: string[], rgb = CELL_YELLOW): number {
  if (!refs.length || !files['xl/styles.xml']) return 0;
  const entry = ensureFill(files, rgb);
  let xml = strFromU8(files[sheetPart]);
  let done = 0;
  for (const ref of new Set(refs)) {
    const cellRe = new RegExp(`<c\\b([^>]*?)\\br="${ref}"([^>]*?)(\\/>|>)`);
    let m = cellRe.exec(xml);
    if (!m) {
      xml = insertEmptyCell(xml, ref);
      m = cellRe.exec(xml);
      if (!m) continue;
    }
    const whole = m[0];
    const s = Number(/\bs="(\d+)"/.exec(whole)?.[1] ?? '0');
    const ns = xfWithFill(files, entry, s);
    const next = /\bs="\d+"/.test(whole) ? whole.replace(/\bs="\d+"/, `s="${ns}"`) : whole.replace(/^<c\b/, `<c s="${ns}"`);
    xml = xml.replace(whole, next);
    done += 1;
  }
  files[sheetPart] = strToU8(xml);
  return done;
}

function colNum(col: string): number { let n = 0; for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }

/** 행·칸 순서를 지키며 빈 칸 하나를 끼운다. */
function insertEmptyCell(xml: string, ref: string): string {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return xml;
  const [col, row] = [m[1], Number(m[2])];
  const sd = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>|<sheetData\s*\/>/.exec(xml);
  if (!sd) return xml;
  let body = sd[1] ?? '';
  const rowRe = new RegExp(`<row\\b[^>]*\\br="${row}"[^>]*?(?:/>|>[\\s\\S]*?</row>)`);
  const rm = rowRe.exec(body);
  const cell = `<c r="${ref}"/>`;
  if (!rm) {
    const after = [...body.matchAll(/<row\b[^>]*\br="(\d+)"/g)].find((r) => Number(r[1]) > row);
    const at = after ? after.index! : body.length;
    body = body.slice(0, at) + `<row r="${row}">${cell}</row>` + body.slice(at);
  } else {
    let rowXml = rm[0];
    if (/\/>$/.test(rowXml)) rowXml = rowXml.replace(/\/>$/, '></row>');
    const after = [...rowXml.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"/g)].find((c) => colNum(c[1]) > colNum(col));
    const at = after ? after.index! : rowXml.lastIndexOf('</row>');
    rowXml = rowXml.slice(0, at) + cell + rowXml.slice(at);
    body = body.replace(rm[0], rowXml);
  }
  const open = sd[0].startsWith('<sheetData') && sd[1] != null ? /<sheetData\b[^>]*>/.exec(sd[0])![0] : '<sheetData>';
  return xml.slice(0, sd.index) + open + body + '</sheetData>' + xml.slice(sd.index + sd[0].length);
}
