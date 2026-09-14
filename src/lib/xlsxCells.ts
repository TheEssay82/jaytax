// 이미 있는 시트 XML 의 **칸 몇 개를 고친다** — 일반조서 이월 때 결산일·대상기간·작성일을 바꾸거나 비운다.
//
// 시트를 새로 짓지 않는다. 칸의 서식(s)은 그대로 두고 값만 바꾼다. 글자는 인라인 문자열로 넣어
// 공유문자열표를 건드리지 않는다(그 표를 고치면 다른 칸의 번호가 어긋난다). 없던 칸·행은 차례에 맞춰 끼운다.
export interface CellEdit {
  /** 「B15」 */ ref: string;
  /** 글자로 넣는다 */ text?: string;
  /** 숫자(날짜 일련번호 포함)로 넣는다 */ num?: number;
  /** 수식(= 없이). 값은 비워 두고 열 때 계산하게 한다 */ formula?: string;
  /** 비운다 — 수식도 값도 없앤다 */ clear?: boolean;
}

function esc(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function colNum(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function split(ref: string): { col: number; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`칸 주소가 이상합니다: ${ref}`);
  return { col: colNum(m[1]), row: Number(m[2]) };
}

/** 칸 하나의 XML — 서식 번호는 물려받는다. */
function cellXml(ref: string, e: CellEdit, s: string | undefined): string {
  const st = s ? ` s="${s}"` : '';
  if (e.clear) return `<c r="${ref}"${st}/>`;
  if (e.formula != null) return `<c r="${ref}"${st}><f>${esc(e.formula)}</f></c>`;
  if (e.num != null) return `<c r="${ref}"${st}><v>${e.num}</v></c>`;
  return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(e.text ?? '')}</t></is></c>`;
}

/**
 * 시트 XML 에 편집을 적용한다. 같은 칸을 두 번 고치면 뒤의 것이 이긴다.
 */
export function setCells(sheetXml: string, edits: CellEdit[]): string {
  let xml = sheetXml;
  if (/<sheetData\s*\/>/.test(xml)) xml = xml.replace(/<sheetData\s*\/>/, '<sheetData></sheetData>');
  const sd = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml);
  if (!sd) throw new Error('시트에 sheetData 가 없습니다.');
  let body = sd[1];

  for (const e of edits) {
    const { col, row } = split(e.ref);
    const rowRe = new RegExp(`<row\\b[^>]*\\br="${row}"[^>]*?(?:/>|>[\\s\\S]*?</row>)`);
    const rm = rowRe.exec(body);
    if (!rm) {
      // 행이 없다 — 번호 순서에 맞는 자리에 끼운다.
      const rows = [...body.matchAll(/<row\b[^>]*\br="(\d+)"/g)];
      const after = rows.find((r) => Number(r[1]) > row);
      const at = after ? after.index! : body.length;
      body = body.slice(0, at) + `<row r="${row}">${cellXml(e.ref, e, undefined)}</row>` + body.slice(at);
      continue;
    }
    let rowXml = rm[0];
    if (/\/>$/.test(rowXml)) rowXml = rowXml.replace(/\/>$/, '></row>');
    const cellRe = new RegExp(`<c\\b[^>]*\\br="${e.ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
    const cm = cellRe.exec(rowXml);
    if (cm) {
      const s = /\bs="(\d+)"/.exec(cm[0])?.[1];
      rowXml = rowXml.replace(cm[0], cellXml(e.ref, e, s));
    } else {
      const cells = [...rowXml.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"/g)];
      const after = cells.find((c) => colNum(c[1]) > col);
      const at = after ? after.index! : rowXml.lastIndexOf('</row>');
      rowXml = rowXml.slice(0, at) + cellXml(e.ref, e, undefined) + rowXml.slice(at);
    }
    body = body.replace(rm[0], rowXml);
  }
  return xml.slice(0, sd.index) + `<sheetData${/<sheetData\b([^>]*)>/.exec(sd[0])![1]}>` + body + '</sheetData>' + xml.slice(sd.index + sd[0].length);
}

/** 엑셀 날짜 일련번호 — 「2026-12-31」 → 46387. */
export function excelSerial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.round(ms / 86400000) + 25569;
}
