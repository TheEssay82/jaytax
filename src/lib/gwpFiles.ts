// 자료함 파일을 읽는다 — 어느 해 것인지(잘못 올린 것을 막는다), 정산표에서 중요성 기준 금액(수정전·수정후). 순수 모듈.
//
// 사용자 2026-09-27: FY2026 작업 건에 FY2025 확정 정산표를 올리는 실수 — 「명확하게 표시를 해 줘야」.
// 사용자 2026-09-27: 2차(중간감사 후) 중요성은 「기말감사 전 숫자 — 기말감사 때 받은 정산표의 수정전 금액」.
//   정산표 머리에 당기 결산일이 두 번 적혀 있다(명진 WTB: U = 회사 제시(수정전), X = 감사후(수정후)).
//   수정전 = 당기 결산일이 적힌 **가장 왼쪽** 열, 수정후 = **가장 오른쪽** 열.
import { unzipSync, strFromU8 } from 'fflate';
import { readWorkbook, type SheetData } from './xlsxRead';
import { documentPeriod } from './dsdParse';
import { colOf, rowOf, normLabel } from './gwpWeb';
import type { BenchKey } from './gwpPaper2700A';

export type FileKind = '전기DSD' | '당기DSD' | '수정전정산표' | '정산표';

/** 이 작업 건(fy)에 맞는 파일의 해. 전기 DSD 는 한 해 앞. */
export const expectedFy = (kind: FileKind, fy: number) => (kind === '전기DSD' ? fy - 1 : fy);

const iso = (serial: number) => new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000).toISOString().slice(0, 10);
const serialOf = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000);

/** 정산표의 기준일 — WBS·WPL 머리(1~6행)에 적힌 날짜 가운데 가장 늦은 것. */
export function wtbPeriodEnd(sheets: SheetData[]): string | null {
  // 머리 가운데 날짜가 가장 많이 늘어선 줄(명진 WTB 2행: FY16~FY25 결산일) — 근처 금액 칸을 날짜로 잘못 읽지 않게.
  let best = 0;
  for (const s of sheets) {
    const byRow = new Map<number, number[]>();
    for (const [ref, v] of s.cells) {
      if (rowOf(ref) > 6 || v.num == null || v.num < 20000 || v.num > 80000) continue;
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v.num) * 86400000);
      if (d.getUTCDate() < 28) continue;                    // 결산일은 달의 끝 무렵이다
      (byRow.get(rowOf(ref)) ?? byRow.set(rowOf(ref), []).get(rowOf(ref))!).push(Math.round(v.num));
    }
    const row = [...byRow.values()].sort((a, b) => b.length - a.length)[0];
    if (row && row.length >= 2) best = Math.max(best, ...row);
  }
  return best ? iso(best) : null;
}

export interface FileMeta { periodEnd: string | null; fy: number | null; note: string }

/** 올리려는 파일을 읽어 해를 알아낸다. 못 알아내면 fy null. */
export function inspectFile(kind: FileKind, bytes: Uint8Array): FileMeta & Record<string, unknown> {
  if (kind === '정산표' || kind === '수정전정산표') {
    const sheets = readWorkbook(bytes, (n) => /^W(BS|PL)$/i.test(n.replace(/\s/g, '')));
    if (!sheets.length) return { periodEnd: null, fy: null, note: '정산표에서 WBS·WPL 시트를 찾지 못했습니다.' };
    const end = wtbPeriodEnd(sheets);
    return { periodEnd: end, fy: end ? Number(end.slice(0, 4)) : null, note: end ? `기준일 ${end}` : '머리에서 결산일을 찾지 못했습니다.' };
  }
  const z = unzipSync(bytes);
  if (!z['contents.xml']) return { periodEnd: null, fy: null, note: 'DSD 안에 본문(contents.xml)이 없습니다.' };
  const p = documentPeriod(strFromU8(z['contents.xml']));
  const t = p?.to?.replace(/[^\d]/g, '') ?? '';
  const end = t.length === 8 ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : null;
  return { periodEnd: end, fy: end ? Number(end.slice(0, 4)) : null, note: end ? `보고 기간 끝 ${end}` : '보고 기간을 찾지 못했습니다.' };
}

/** 파일이 이 작업 건에 맞는가 — 모르면 null. */
/** 자료함에 올리기 전 — 이 작업 건의 이 칸에 맞는 해인가. 직접 올리기·업무 폴더에서 올리기가 같이 쓴다. */
export function checkForKind(kind: FileKind, fy: number, bytes: Uint8Array): { meta: FileMeta & Record<string, unknown>; want: number; wrong: string | null } {
  const meta = inspectFile(kind, bytes);
  const want = expectedFy(kind, fy);
  const wrong = meta.fy != null && meta.fy !== want ? `이 파일은 FY${meta.fy}(${meta.periodEnd}) 것입니다 — FY${fy} 작업 건에는 FY${want} 파일을 올려야 합니다. 올리지 않았습니다.` : null;
  return { meta, want, wrong };
}

export function fitsEngagement(kind: FileKind, meta: { fy?: unknown }, fy: number): boolean | null {
  return typeof meta.fy === 'number' ? meta.fy === expectedFy(kind, fy) : null;
}

/** 머리에 이 날짜가 적힌 열 — 가장 왼쪽(수정전) 또는 가장 오른쪽(수정후). */
export function dateCol(sheet: SheetData, serial: number, side: 'left' | 'right'): string | null {
  const n = (c: string) => { let x = 0; for (const ch of c) x = x * 26 + ch.charCodeAt(0) - 64; return x; };
  let best: string | null = null;
  for (const [ref, v] of sheet.cells) {
    if (rowOf(ref) > 6 || v.num == null || Math.round(v.num) !== serial) continue;
    const c = colOf(ref);
    if (!best || (side === 'right' ? n(c) > n(best) : n(c) < n(best))) best = c;
  }
  return best;
}

const TOTALS: { key: BenchKey; sheet: 'WBS' | 'WPL'; re: RegExp }[] = [
  { key: '총자산', sheet: 'WBS', re: /^자산총계$/ },
  { key: '순자산', sheet: 'WBS', re: /^자본총계$/ },
  { key: '매출액', sheet: 'WPL', re: /^(매출액|영업수익|수익\(매출액\))$/ },
  { key: '세전계속사업이익', sheet: 'WPL', re: /^법인세(비용)?차감전(계속사업)?(순)?(이익|손실|손익)/ },
];
const clean = (s: string) => normLabel(s).replace(/^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX]+\./, '').replace(/^\(\d+\)/, '');

/** 정산표 → 중요성 기준 금액(백만원). side: 수정전(left)·수정후(right). */
export function amountsFromWtb(sheets: SheetData[], closing: string, side: 'left' | 'right'): { amounts: Partial<Record<BenchKey, number>>; cols: Record<string, string | null> } {
  const serial = serialOf(closing);
  const out: Partial<Record<BenchKey, number>> = {};
  const cols: Record<string, string | null> = {};
  for (const t of TOTALS) {
    const s = sheets.find((x) => x.name.replace(/\s/g, '').toUpperCase() === t.sheet);
    if (!s) continue;
    const col = cols[t.sheet] !== undefined ? cols[t.sheet] : (cols[t.sheet] = dateCol(s, serial, side));
    if (!col) continue;
    for (const [ref, v] of s.cells) {
      if (colOf(ref) !== 'B' || !v.text || !t.re.test(clean(v.text))) continue;
      const n = s.cells.get(`${col}${rowOf(ref)}`)?.num;
      if (n != null) { out[t.key] = Math.round(n / 1e6); break; }
    }
  }
  return { amounts: out, cols };
}
