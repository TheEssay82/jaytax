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

/** 원래 서식(cellXfs 의 k 번)에 바탕색만 바꾼 서식을 만들어 번호를 돌려준다. */
function xfWithFill(files: Record<string, Uint8Array>, entry: { fillId: number; xf: Map<number, number> }, k: number): number {
  const hit = entry.xf.get(k);
  if (hit != null) return hit;
  const path = 'xl/styles.xml';
  let xml = strFromU8(files[path]);
  const cx = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  if (!cx) throw new Error('styles.xml 에 cellXfs 가 없습니다.');
  const xfs = [...cx[1].matchAll(XF_RE)].map((m) => m[0]);
  const base = xfs[k] ?? xfs[0];
  const open = /^<xf\b([^>]*?)(\/?)>/.exec(base)!;
  let attrs = open[1].replace(/\s*\bfillId="[^"]*"/, '').replace(/\s*\bapplyFill="[^"]*"/, '');
  attrs += ` fillId="${entry.fillId}" applyFill="1"`;
  const clone = base.replace(open[0], `<xf${attrs}${open[2]}>`);
  const id = xfs.length;
  xml = xml.replace(cx[0], `<cellXfs count="${id + 1}">${cx[1]}${clone}</cellXfs>`);
  files[path] = strToU8(xml);
  entry.xf.set(k, id);
  return id;
}

/**
 * 시트의 칸들에 바탕색을 칠한다. 값·수식은 건드리지 않고 서식 번호만 바꾼다.
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
