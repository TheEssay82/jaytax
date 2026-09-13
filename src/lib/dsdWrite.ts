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
import { slots, escapeXml, hasInline } from './dsdBlocks';
import { asNumber, isDash, type SheetPlan, type BackRef } from './noteSheet';
import type { SheetData, CellValue } from './xlsxRead';
import { numOf } from './noteVerify';

export interface WriteResult {
  /** 새 본문 XML */ xml: string;
  /** 글자를 바꾼 칸 수 */ changed: number;
  /** 아직 안 채운 칸 */ blank: BackRef[];
  /** 손대지 못한 칸과 그 까닭 */ skipped: { at: string; why: string }[];
}

/**
 * 숫자를 DSD 가 쓰는 모양으로.
 *
 * 원본이 어떻게 적었는지를 본떠 쓴다 — 0 을 「-」로 적던 칸은 「-」로, 음수를 괄호로 적던 칸은
 * 괄호로. 원본이 없거나 모양을 알 수 없으면 쉼표만 찍는다.
 */
export function numText(v: number, orig: string): string {
  const o = (orig ?? '').trim();
  if (v === 0 && (isDash(o) || o === '')) return o || '-';
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

/** 이 칸에 넣을 글자 — 못 정하면 null(원본을 그대로 둔다). */
function textFor(ref: BackRef, cells: Map<string, CellValue>): string | null {
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
  return t;
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

  // 자리별로 모은다 — 문단은 여럿이 한 자리를 나눠 쓴다.
  const bag = new Map<number, { ref: BackRef; text: string | null }[]>();
  for (const plan of plans) {
    const sheet = bySheet.get(plan.name);
    if (!sheet) { skipped.push({ at: plan.name, why: '엑셀에서 이 시트를 찾지 못했습니다.' }); continue; }
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
      const body = it.ref.lead ? `${it.ref.lead}${it.text}` : it.text;
      const i = at[p];
      // 앞뒤의 공백과 **홑 줄바꿈(`&cr;`)까지** 원본 그대로 둔다. 홑 줄바꿈은 문단 경계가
      // 아니라 조각 안에 남는데, 엑셀 칸의 글자는 잘려 있어 되돌리면 사라진다.
      const head = /^(?:\s|&amp;cr;|&cr;)*/.exec(pieces[i])![0];
      const tail = /(?:\s|&amp;cr;|&cr;)*$/.exec(pieces[i])![0];
      const next = head + escapeXml(body) + tail;
      if (next === pieces[i]) continue;
      pieces[i] = next;
      hit = true;
      changed += 1;
    }
    if (!hit) continue;
    edits.push({ start: sl.start, end: sl.end, raw: pieces.join('') });
  }

  edits.sort((a2, b2) => b2.start - a2.start);
  let out = xml;
  for (const e of edits) out = out.slice(0, e.start) + e.raw + out.slice(e.end);
  return { xml: out, changed, blank, skipped };
}

/** 새 .dsd 한 개를 만든다 — 본문만 갈고 나머지 부품은 그대로 옮겨 담는다. */
export function buildDsd(src: Uint8Array, xml: string): Uint8Array {
  const files = unzipSync(src);
  files['contents.xml'] = strToU8(xml);
  return zipSync(files, { level: 6 });
}

/** .dsd 안의 본문 XML(노드에서도 쓰려고 여기 둔다). */
export function contentsOf(src: Uint8Array): string {
  const body = unzipSync(src)['contents.xml'];
  if (!body) throw new Error('DSD 안에 본문(contents.xml)이 없습니다.');
  return strFromU8(body);
}
