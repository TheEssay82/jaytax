// 엑셀에서 값을 도로 읽는다 — 사람이 채워 넣은 주석 시트를 받기 위해서다.
//
// **쓸 때와 마찬가지로 엑셀 라이브러리를 쓰지 않는다.** 읽기만 해도 되는 일이라 ZIP 을 풀어
// 시트 XML 을 훑는다. 정산표를 라이브러리로 왕복시키면 정의된 이름 4,880개가 337개로
// 줄어드는 것을 실측했다(2026-09-12). 읽기 전용이어도 같은 의존을 들일 까닭이 없다.
//
// 수식 칸은 **엑셀이 적어 둔 값**(cached value)을 읽는다. 사람이 엑셀에서 열어 저장하면
// 값이 들어 있다. 값이 없으면 수식만 돌려주고 판단은 부르는 쪽에 맡긴다.
import { unzipSync, strFromU8 } from 'fflate';

export interface CellValue {
  /** 숫자 칸이면 숫자 */ num?: number;
  /** 글자 칸이면 글자 */ text?: string;
  /** 수식이 걸려 있으면 「=」 없는 수식 */ formula?: string;
}

export interface SheetData {
  name: string;
  /** 「C8」 → 값 */ cells: Map<string, CellValue>;
}

/**
 * 엑셀이 쓰는 실체참조와 `_x000D_` 꼴.
 *
 * 엑셀은 제어문자를 `_xNNNN_` 으로 적고, 글자 그대로의 「_x」 는 `_x005F_x…` 로 한 겹 더
 * 감싼다. 그래서 둘을 **한 번에** 훑는다 — 두 번 훑으면 푼 결과를 또 푼다.
 * `&amp;` 는 맨 나중이다 — 먼저 풀면 「&amp;lt;」 처럼 적힌 것이 두 번 풀린다.
 */
export function unescapeCell(s: string): string {
  return (s ?? '')
    .replace(
      /_x005F_(x[0-9A-Fa-f]{4}_)|_x([0-9A-Fa-f]{4})_/g,
      (_, lit?: string, hex?: string) => (lit != null ? `_${lit}` : String.fromCharCode(parseInt(hex!, 16))),
    )
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** `<si>` 하나 — 조각(`<r>`)으로 나뉘어 있으면 이어 붙인다. */
function siText(si: string): string {
  let out = '';
  for (const m of si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) out += unescapeCell(m[1]);
  return out;
}

function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) out.push(siText(m[1]));
  return out;
}

/** 시트 XML 한 장 → 칸 지도. */
export function readSheet(xml: string, shared: string[]): Map<string, CellValue> {
  const cells = new Map<string, CellValue>();
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1];
    const body = m[2] ?? '';
    const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
    if (!ref) continue;
    const type = /\bt="([^"]*)"/.exec(attrs)?.[1] ?? 'n';
    const val: CellValue = {};
    const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(body);
    if (f) val.formula = unescapeCell(f[1]);
    if (type === 'inlineStr') {
      val.text = siText(body);
    } else {
      const v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(body);
      if (v) {
        const raw = v[1];
        if (type === 's') val.text = shared[Number(raw)] ?? '';
        else if (type === 'str' || type === 'e') val.text = unescapeCell(raw);
        else {
          const n = Number(raw);
          if (Number.isFinite(n)) val.num = n;
          else val.text = unescapeCell(raw);
        }
      }
    }
    if (val.num == null && val.text == null && val.formula == null) continue;
    cells.set(ref, val);
  }
  return cells;
}

/**
 * 통합문서를 읽는다. `want` 를 주면 그 이름의 시트만 푼다 — 정산표는 시트가 수십 장이라
 * 다 푸는 것은 헛일이다.
 */
export function readWorkbook(bytes: Uint8Array, want?: (name: string) => boolean): SheetData[] {
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    throw new Error('엑셀 파일이 아닌 것 같습니다(ZIP 형식이 아닙니다).');
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('엑셀 파일을 열지 못했습니다. 손상되었을 수 있습니다.');
  }
  const book = files['xl/workbook.xml'];
  if (!book) throw new Error('엑셀 안에 통합문서(xl/workbook.xml)가 없습니다.');
  const bookXml = strFromU8(book);
  const relsXml = files['xl/_rels/workbook.xml.rels'] ? strFromU8(files['xl/_rels/workbook.xml.rels']) : '';
  const target = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*?)\/>/g)) {
    const id = /\bId="([^"]*)"/.exec(m[1])?.[1];
    const to = /\bTarget="([^"]*)"/.exec(m[1])?.[1];
    if (id && to) target.set(id, to.replace(/^\/?(xl\/)?/, ''));
  }
  const shared = files['xl/sharedStrings.xml'] ? sharedStrings(strFromU8(files['xl/sharedStrings.xml'])) : [];

  const out: SheetData[] = [];
  for (const m of bookXml.matchAll(/<sheet\b([^>]*?)\/>/g)) {
    const name = unescapeCell(/\bname="([^"]*)"/.exec(m[1])?.[1] ?? '');
    if (want && !want(name)) continue;
    const rid = /\br:id="([^"]*)"/.exec(m[1])?.[1] ?? '';
    const part = files[`xl/${target.get(rid) ?? ''}`];
    if (!part) continue;
    out.push({ name, cells: readSheet(strFromU8(part), shared) });
  }
  return out;
}
