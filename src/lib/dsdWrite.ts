// ④ 엑셀에서 채운 글자를 **DSD 제자리에 도로 넣는다.**
//
// 원본 XML 을 틀로 두고 **글자만 갈아끼운다.** 표 너비·정렬·글꼴 같은 속성이 하나도 상하지
// 않는다(2026-09-12 실측 — 읽고 그대로 다시 쓰면 원본과 바이트 단위로 같았다).
//
// **바뀐 칸만 새로 쓴다.** 안 바뀐 칸은 원본 글자를 그대로 둔다 — 숫자 모양이 칸마다 조금씩
// 다른데(「-」·「(9,386,468)」·전각 공백) 전부 새로 찍으면 원본과 달라진다.
//
// 자리는 **② 와 똑같은 배치를 다시 지어** 얻는다(SheetPlan.back). 엑셀 A열의 자리표를 도로
// 읽지 않는다 — 사람이 그 열을 건드렸어도 흔들리지 않는다.
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { slots, escapeXml, unescapeXml, hasInline } from './dsdBlocks';
import {
  asNumber, isDash, colName,
  type SheetPlan, type BackRef, type SpareRow,
} from './noteSheet';
import type { SheetData, CellValue } from './xlsxRead';
import { numOf } from './noteVerify';

export interface WriteResult {
  /** 새 본문 XML */ xml: string;
  /** 글자를 바꾼 칸 수 */ changed: number;
  /** 아직 안 채운 칸 */ blank: BackRef[];
  /** 손대지 못한 칸과 그 까닭 */ skipped: { at: string; why: string }[];
  /** 새로 지은 행의 첫 열 글자 — 거래처가 늘었을 때 */ added: string[];
  /** 없앤 행의 첫 열 글자 — 거래처가 줄었을 때 */ removed: string[];
}

/**
 * 숫자를 DSD 가 쓰는 모양으로.
 *
 * 원본이 어떻게 적었는지를 본떠 쓴다 — 0 을 「-」로 적던 칸은 「-」로, 음수를 괄호로 적던 칸은
 * 괄호로. 원본이 없거나 모양을 알 수 없으면 쉼표만 찍는다.
 */
export function numText(v: number, orig: string): string {
  const o = (orig ?? '').trim();
  // **0 은 붙임표로 쓴다.** 회계 표는 0 을 「-」로 적는다 — 명진 원본에 맨 「0」 칸은 하나도
  // 없고 붙임표가 142곳이다(2026-09-13 실측). 원본이 딱 「0」이라 적었을 때만 0 으로 쓴다.
  if (v === 0) return o === '0' ? '0' : (isDash(o) ? o : '-');
  const neg = v < 0;
  // **소수 자릿수는 원본대로.** 지분율 「100.00」을 「100」으로 쓰면 원본과 어긋난다
  // (알티스트 20곳 — 2026-09-13).
  const dec = /[.]([0-9]+)/.exec(o)?.[1].length ?? 0;
  const body = Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: dec, maximumFractionDigits: Math.max(dec, 10),
  });
  if (!neg) return body;
  return /^\s*\(.*\)\s*$/.test(o) ? `(${body})` : `-${body}`;
}

/** 엑셀에서 온 글자를 DSD 에 넣을 꼴로 — 줄바꿈은 `\n` 하나로 맞춘다. */
function clean(s: string): string {
  return (s ?? '').replace(/\r\n?/g, '\n');
}

/** 이 칸에 넣을 글자 — 못 정하면 null(원본을 그대로 둔다). */
function textFor(ref: BackRef, cells: Map<string, CellValue>): string | null {
  // **이월하면서 비운 칸**이 아직 안 채워졌으면 DSD 에서도 비운다. 원본을 두면 당기 칸에
  // 작년 숫자가 남는다.
  if (ref.blanked && isBlank(ref, cells)) return '';
  const cell = cells.get(ref.at);
  // 천원 표의 표시 칸은 ROUND 수식이다. 값이 있으면 그것을, 없으면 원 단위 칸에서 셈한다.
  if (ref.factor != null) {
    const shown = numOf(cell);
    if (shown != null) return numText(shown, ref.orig);
    const src = ref.srcAt ? numOf(cells.get(ref.srcAt)) : undefined;
    if (src == null) return null;
    return numText(Math.round(src / ref.factor), ref.orig);
  }
  if (!cell) return null;
  if (cell.num != null) return numText(cell.num, ref.orig);
  const t = (cell.text ?? '').trim();
  if (!t) return null;
  // 글자로 적힌 숫자도 숫자 모양으로 맞춘다 — 「1,234」를 그대로 두면 원본과 어긋날 수 있다.
  if (ref.isNum) {
    const n = asNumber(t);
    if (n != null) return numText(n, ref.orig);
  }
  return clean(t);
}

/** 한 칸이 비어 있는가 — 채워 넣을 자리인데 아직 안 찼는가. */
function isBlank(ref: BackRef, cells: Map<string, CellValue>): boolean {
  if (ref.factor != null) {
    return numOf(cells.get(ref.at)) == null && (!ref.srcAt || numOf(cells.get(ref.srcAt)) == null);
  }
  const cell = cells.get(ref.at);
  if (!cell) return true;
  if (cell.num != null) return false;
  return (cell.text ?? '').trim() === '';
}

/**
 * `<P>` 하나를 **원문 그대로** 문단 조각으로 나눈다.
 *
 * `splitParts` 는 조각마다 앞뒤 공백을 떼어 낸다. 그것으로 다시 지으면 안 고친 문단의 끝
 * 공백까지 사라져 원본과 어긋난다(명진에서 33글자 차이가 났다 — 2026-09-13).
 * 여기서는 **자르지 않는다.** 바꿀 조각만 갈아끼우고 나머지는 손대지 않는다.
 */
export function splitRaw(raw: string): string[] {
  const re = /(?:&amp;cr;|&cr;)[ \t]*(?:(?:&amp;cr;|&cr;)[ \t]*)+/g;
  const out: string[] = [];
  let last = 0;
  for (const m of (raw ?? '').matchAll(re)) {
    out.push(raw.slice(last, m.index!), m[0]);
    last = m.index! + m[0].length;
  }
  out.push(raw.slice(last));
  return out;                                        // 홀수 자리가 조각, 짝수 자리가 경계
}

/** 글자가 든 조각의 자리들 — `splitParts` 가 주는 차례와 맞는다. */
function bodyIndexes(pieces: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < pieces.length; i += 2) {
    if (pieces[i].replace(/&amp;cr;|&cr;/g, ' ').replace(/&[a-z]+;/g, ' ').trim()) out.push(i);
  }
  return out;
}

/**
 * 엑셀 칸에서 글자를 꺼낸다 — 여분 행의 칸도 같은 규칙으로 읽는다.
 *
 * `textFor` 는 `BackRef` 를 받는데 여분 행에는 원본 자리가 없다. 필요한 것(숫자인가,
 * 천원인가, 원 단위 칸은 어디인가)만 추려 빌려 쓴다.
 */
function spareText(
  c: SpareRow['cells'][number], cells: Map<string, CellValue>,
): string | null {
  return textFor(
    { at: c.at, slot: -1, orig: '', isNum: c.isNum, factor: c.factor, srcAt: c.srcAt },
    cells,
  );
}

/**
 * **행을 짓고 지운다** — 거래처가 늘고 줄 때.
 *
 * 짓기: 여분 행의 첫 열에 글자가 있으면 본보기 `<TR>` 을 통째로 떠서 칸 글자만 갈아 끼우고
 *       본보기 **뒤에** 붙인다. 속성(ACOPY·WIDTH·COLSPAN)과 병합이 그대로 따라온다.
 * 지우기: 항목 행의 첫 열을 지웠으면 그 `<TR>` 을 통째로 없앤다. 첫 열은 이월해도 비우지
 *       않으므로, 비어 있다는 것은 **사람이 일부러 지웠다**는 뜻이다.
 *
 * 되돌리는 자리(start/end)는 모두 **원본 XML 기준**이라, 글자 갈아끼우기와 한 목록에 담아
 * 뒤에서부터 한꺼번에 적용한다.
 */
function rowEdits(
  xml: string, plan: SheetPlan, cells: Map<string, CellValue>,
): { edits: { start: number; end: number; raw: string }[]; added: string[]; removed: string[] } {
  const edits: { start: number; end: number; raw: string }[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  // ── 지우기 ────────────────────────────────────────────────
  const gone = new Set<string>();
  for (const d of plan.drops ?? []) {
    const t = (cells.get(d.labelAt)?.text ?? '').trim();
    if (t || cells.get(d.labelAt)?.num != null) continue;
    if (!d.origLabel.trim()) continue;                 // 원래 비어 있던 줄은 건드리지 않는다
    const key = `${d.at[0]}`;
    if (gone.has(key)) continue;
    gone.add(key);
    edits.push({ start: d.at[0], end: d.at[1], raw: '' });
    removed.push(d.origLabel);
  }

  // ── 짓기 ──────────────────────────────────────────────────
  // 한 본보기에 여럿이 붙을 수 있다. **차례대로 이어 붙여야** 순서가 맞는다.
  const made = new Map<number, { order: number; raw: string }[]>();
  for (const sp of plan.spares ?? []) {
    const label = spareText(sp.cells.find((c) => c.at === sp.labelAt) ?? sp.cells[0], cells);
    if (label == null || !label.trim()) continue;
    if (gone.has(`${sp.from[0]}`)) continue;           // 본보기를 지웠으면 베낄 것이 없다
    let raw = xml.slice(sp.from[0], sp.from[1]);
    // 뒤에서부터 갈아 끼운다 — 앞을 먼저 바꾸면 뒤 자리가 밀린다.
    const inner = sp.cells
      .map((c) => ({ ...c, rel0: c.start - sp.from[0], rel1: c.end - sp.from[0] }))
      .filter((c) => c.rel0 >= 0 && c.rel1 <= raw.length)
      .sort((a, b2) => b2.rel0 - a.rel0);
    for (const c of inner) {
      const t = spareText(c, cells);
      raw = raw.slice(0, c.rel0) + escapeXml(t ?? '') + raw.slice(c.rel1);
    }
    const list = made.get(sp.from[0]) ?? [];
    list.push({ order: sp.order, raw });
    made.set(sp.from[0], list);
    added.push(label.trim());
  }
  for (const [from, list] of made) {
    const sp = (plan.spares ?? []).find((x) => x.from[0] === from)!;
    list.sort((a, b2) => a.order - b2.order);
    // 본보기 **뒤**에 붙인다 — 합계 행 바로 위다.
    edits.push({ start: sp.from[1], end: sp.from[1], raw: list.map((x) => x.raw).join('') });
  }
  return { edits, added, removed };
}

/**
 * 주석 절의 글자를 갈아끼운다.
 *
 * 한 `<P>` 에 문단이 여럿이면 **한꺼번에** 써야 한다 — 자리가 하나뿐이라 따로 쓰면 마지막
 * 것만 남는다. 그래서 자리(slot)별로 모아서 처리한다.
 */
export function writeNotes(
  xml: string, plans: SheetPlan[], sheets: SheetData[],
): WriteResult {
  const all = slots(xml);
  const bySheet = new Map(sheets.map((s) => [s.name, s]));
  const blank: BackRef[] = [];
  const skipped: { at: string; why: string }[] = [];
  const rowOps: { start: number; end: number; raw: string }[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  // 없앤 행 안의 칸은 글자를 갈아끼울 까닭이 없다 — 행째로 사라진다.
  const dead: [number, number][] = [];

  // 자리별로 모은다 — 문단은 여럿이 한 자리를 나눠 쓴다.
  const bag = new Map<number, { ref: BackRef; text: string | null }[]>();
  for (const plan of plans) {
    const sheet = bySheet.get(plan.name);
    if (!sheet) { skipped.push({ at: plan.name, why: '엑셀에서 이 시트를 찾지 못했습니다.' }); continue; }
    const rows = rowEdits(xml, plan, sheet.cells);
    rowOps.push(...rows.edits);
    added.push(...rows.added);
    removed.push(...rows.removed);
    for (const e of rows.edits) if (e.raw === '') dead.push([e.start, e.end]);
    for (const ref of plan.back ?? []) {
      if (isBlank(ref, sheet.cells)) blank.push({ ...ref, at: `${plan.name}!${ref.at}` });
      const text = textFor(ref, sheet.cells);
      const list = bag.get(ref.slot) ?? [];
      list.push({ ref: { ...ref, at: `${plan.name}!${ref.at}` }, text });
      bag.set(ref.slot, list);
    }
  }

  // 뒤에서부터 갈아끼운다 — 앞을 먼저 바꾸면 뒤 자리가 밀린다.
  const edits: { start: number; end: number; raw: string }[] = [];
  let changed = 0;
  for (const [slot, items] of bag) {
    const sl = all[slot];
    if (!sl) {
      for (const it of items) skipped.push({ at: it.ref.at, why: '원본에서 이 자리를 찾지 못했습니다.' });
      continue;
    }
    if (hasInline(sl.raw)) {
      if (items.some((it) => it.text != null && it.text !== it.ref.orig)) {
        for (const it of items) skipped.push({ at: it.ref.at, why: '글꼴·색 태그가 섞인 자리라 손대지 않았습니다.' });
      }
      continue;
    }

    const isPara = items.some((it) => it.ref.part != null);
    if (!isPara) {
      const it = items[0];
      if (it.text == null || it.text === it.ref.orig) continue;
      edits.push({ start: sl.start, end: sl.end, raw: escapeXml(it.text) });
      changed += 1;
      continue;
    }

    // 문단 — 바뀐 조각만 갈아끼운다.
    const pieces = splitRaw(sl.raw);
    const at = bodyIndexes(pieces);
    let hit = false;
    for (const it of items) {
      const p = it.ref.part ?? 0;
      if (it.text == null || p >= at.length) continue;
      const body = clean(it.ref.lead ? `${it.ref.lead}${it.text}` : it.text);
      const i = at[p];
      // 앞뒤의 공백과 **홑 줄바꿈(`&cr;`)까지** 원본 그대로 둔다. 홑 줄바꿈은 문단 경계가
      // 아니라 조각 안에 남는데, 엑셀 칸의 글자는 잘려 있어 되돌리면 사라진다.
      const head = /^(?:\s|&amp;cr;|&cr;)*/.exec(pieces[i])![0];
      const tail = /(?:\s|&amp;cr;|&cr;)*$/.exec(pieces[i])![0];
      const next = head + escapeXml(body) + tail;
      if (next === pieces[i]) continue;
      // **글이 안 바뀌었으면 원본 바이트를 그대로 둔다.** 같은 글자를 다르게 적는 자리가
      // 있다 — 「(이하 "당사")」를 세진식품은 `&quot;` 로, 린치핀은 `"` 로 적었다. 다시
      // 적으면 손대지도 않은 문단이 달라져 무손실 왕복이 깨진다(2026-09-13).
      if (unescapeXml(next) === unescapeXml(pieces[i])) continue;
      pieces[i] = next;
      hit = true;
      changed += 1;
    }
    if (!hit) continue;
    edits.push({ start: sl.start, end: sl.end, raw: pieces.join('') });
  }

  // 없앤 행 안의 칸 편집은 버린다 — 행째로 사라지니 겹쳐 쓰면 자리가 어긋난다.
  const inDead = (p: number) => dead.some(([a2, b2]) => a2 <= p && p < b2);
  const all2 = [...edits.filter((e) => !inDead(e.start)), ...rowOps];
  // 뒤에서부터. 같은 자리면 **넣기를 먼저** 해야 지우기와 겹치지 않는다.
  all2.sort((a2, b2) => b2.start - a2.start || (a2.end - a2.start) - (b2.end - b2.start));
  let out = xml;
  for (const e of all2) out = out.slice(0, e.start) + e.raw + out.slice(e.end);
  return { xml: out, changed, blank, skipped, added, removed };
}

/**
 * 원본 ZIP 의 **항목별 속성과 시각**을 읽는다 — 중앙 디렉터리를 직접 훑는다.
 *
 * 왜 필요한가: 새로 지은 ZIP 은 외부속성이 0 이 되는데, 열리는 것이 확인된 파일은 원본과 같은
 * `0x81B40020` 이었다(2026-09-13). 편집기가 그것을 보는지는 알 수 없으나, **원본을 최대한
 * 그대로 두는 것**이 이 시스템의 규칙이다.
 */
export function zipMeta(src: Uint8Array): Record<string, { attrs: number; mtime: Date }> {
  const out: Record<string, { attrs: number; mtime: Date }> = {};
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  // 끝에서 EOCD(0x06054b50)를 찾는다 — 주석이 붙어 있을 수 있어 뒤에서 훑는다.
  let eocd = -1;
  for (let i = src.length - 22; i >= 0 && i > src.length - 65558; i -= 1) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return out;
  let p = dv.getUint32(eocd + 16, true);             // 중앙 디렉터리 시작
  const n = dv.getUint16(eocd + 10, true);
  const dec = new TextDecoder();
  for (let k = 0; k < n && p + 46 <= src.length; k += 1) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const cmtLen = dv.getUint16(p + 32, true);
    const attrs = dv.getUint32(p + 38, true);
    const time = dv.getUint16(p + 12, true);
    const date = dv.getUint16(p + 14, true);
    const name = dec.decode(src.subarray(p + 46, p + 46 + nameLen));
    out[name] = {
      attrs,
      mtime: new Date(
        1980 + (date >> 9), ((date >> 5) & 0xf) - 1, date & 0x1f,
        time >> 11, (time >> 5) & 0x3f, (time & 0x1f) * 2,
      ),
    };
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

/** 새 .dsd 한 개를 만든다 — 본문만 갈고 나머지 부품은 **속성까지** 그대로 옮겨 담는다. */
export function buildDsd(src: Uint8Array, xml: string): Uint8Array {
  const files = unzipSync(src);
  files['contents.xml'] = strToU8(xml);
  const meta = zipMeta(src);
  const packed: Record<string, [Uint8Array, { attrs?: number; mtime?: Date; level: 6 }]> = {};
  for (const [name, bytes] of Object.entries(files)) {
    const m = meta[name];
    packed[name] = [bytes, { level: 6, ...(m ? { attrs: m.attrs, mtime: m.mtime } : {}) }];
  }
  return zipSync(packed);
}

/** .dsd 안의 본문 XML(노드에서도 쓰려고 여기 둔다). */
export function contentsOf(src: Uint8Array): string {
  const body = unzipSync(src)['contents.xml'];
  if (!body) throw new Error('DSD 안에 본문(contents.xml)이 없습니다.');
  return strFromU8(body);
}

/**
 * **엑셀 없이** 되돌릴 때 쓰는 값 — 배치 자체를 엑셀인 셈 친다.
 *
 * 감사 나가기 전에 **작년 DSD 하나만으로 다음 해 빈 서식**을 만들려는 자리다. 이월한 배치에는
 * 전기 칸에 작년 당기 값이 들어 있고 당기 칸은 비어 있으니, 그대로 되돌리면 그것이 빈 서식이다.
 *
 * 수식 칸은 값이 없다 — 천원 표의 표시 칸이 그렇다. 그 표의 숫자는 오른쪽 「원 단위 (입력)」
 * 칸에 원으로 앉아 있고, 되돌릴 때 거기서 천원으로 셈한다.
 */
export function sheetsFromPlans(plans: SheetPlan[]): SheetData[] {
  // 같은 시트를 나눠 쓰는 배치(종단형)는 한 장으로 합친다.
  const by = new Map<string, SheetData>();
  for (const p of plans) {
    const cells = by.get(p.name)?.cells ?? new Map<string, CellValue>();
    by.set(p.name, { name: p.name, cells });
    for (const c of p.cells) {
      if (c.formula != null) continue;
      const ref = `${colName(c.col)}${c.row}`;
      if (c.num != null) cells.set(ref, { num: c.num });
      else if (c.text) cells.set(ref, { text: c.text });
    }
  }
  return [...by.values()];
}
