// 단계 마감 — [1차 확정] 때 웹 조서뿐 아니라 그 단계의 **엑셀 조서 전체**를 「이번 단계에 손본」 상태로 둔다. 순수 모듈.
//
// 사용자 2026-09-27: 「심리실이 요구하는 계획조서를 올리려면 1000번대와 2000번대 조서가 1차로 반영 완료되어야 합니다.
// 지금은 WEB 에 구현한 조서 시트만 작성이 됩니다. 최소한 노란색으로 수정은 반영되어 있어야 합니다.」
//   · 조서목록의 그 조서 줄에 작성자·작성일이 비었으면 채운다(각 조서 머리는 조서목록을 링크로 가져간다) — 넣은 칸은 노랑
//   · 탭이 빨강(손 안 댐)·색 없음이면 노랑으로 — 이번 단계에 확인했다는 표시
// 사람이 이미 적은 작성자·작성일, 이미 노랑·초록인 탭은 건드리지 않는다.
import { strFromU8, strToU8 } from 'fflate';
import { readWorkbook } from './xlsxRead';
import { setCells, excelSerial, type CellEdit } from './xlsxCells';
import { sheetEntries, unzip, zip } from './xlsxTransplant';
import { setTabColor, highlightCells, tabColorOf, tabStateOf, TAB } from './xlsxMark';
import { buildCatalog, kindOf, type Catalog, type CatalogSheet } from './gwpCatalog';
import { indexRowResolver } from './gwpRoll';
import type { StageNo } from './gwpStage';

/** 단계마다 함께 마감할 조서 묶음(첫 자리). 1차 = 계획(1000·2000번대). 2·3차는 정해지면 더한다. */
export const STAGE_SERIES: Partial<Record<StageNo, string[]>> = { 1: ['1', '2'] };

/** 이 단계에 마감할 엑셀 조서 — 보이는 조서 가운데 묶음 첫 자리가 맞는 것. */
export function stagePapers(cat: Catalog, no: StageNo, exclude: string[] = []): CatalogSheet[] {
  const series = STAGE_SERIES[no] ?? [];
  const ex = new Set(exclude);
  return cat.sheets.filter((s) => s.kind === 'paper' && !s.hidden && !!s.code && series.includes(s.code[0]) && !ex.has(s.code.replace(/\(.*$/, '')));
}

export interface CloseOptions {
  /** 「2026-04-14」 */ date: string;
  author: string;
  /** 다른 단계의 웹 조서(2700A-3·4 는 2000번대지만 2·3차) — 빼고 마감한다 */ exclude?: string[];
}
export interface CloseResult {
  bytes: Uint8Array;
  /** 조서목록에 작성자·작성일을 채운 조서 */ dated: string[];
  /** 탭을 빨강 → 노랑으로 바꾼 시트 */ tabbed: string[];
  /** 조서목록에 줄이 없어 작성일을 못 넣은 조서 */ noIndex: string[];
}

export function closeStage(bytes: Uint8Array, no: StageNo, o: CloseOptions): CloseResult {
  const files = unzip(bytes);
  const sheets = readWorkbook(bytes);
  const cat = buildCatalog(sheets);
  const papers = stagePapers(cat, no, o.exclude);
  const rowFor = indexRowResolver(cat);
  const index = sheets.find((s) => kindOf(s.name) === 'index');
  const out: CloseResult = { bytes, dated: [], tabbed: [], noIndex: [] };
  const serial = excelSerial(o.date);

  // 조서목록 — 작성자 D · 작성일 E(명진 모양). 비어 있을 때만.
  if (index && serial != null) {
    const edits: CellEdit[] = [];
    const seen = new Set<number>();
    for (const p of papers) {
      const row = rowFor(p.code!);
      if (!row) { out.noIndex.push(p.code!); continue; }
      if (seen.has(row)) continue;
      seen.add(row);
      const ix = cat.index.find((r) => r.row === row);
      let did = false;
      if (!ix?.author && o.author.trim()) { edits.push({ ref: `D${row}`, text: o.author.trim() }); did = true; }
      if (!ix?.date) { edits.push({ ref: `E${row}`, num: serial }); did = true; }
      if (did) out.dated.push(ix?.code ?? p.code!);
    }
    const e = sheetEntries(files).find((x) => x.name === index.name);
    if (e && edits.length) {
      files[e.part] = strToU8(setCells(strFromU8(files[e.part]), edits));
      highlightCells(files, e.part, edits.map((x) => x.ref));
    }
  }
  // 탭 — 빨강·색 없음이면 노랑.
  for (const p of papers) {
    const e = sheetEntries(files).find((x) => x.name === p.name);
    if (!e) continue;
    const xml = strFromU8(files[e.part]);
    const t = tabStateOf(tabColorOf(xml));
    if (t === 'yellow' || t === 'green') continue;
    files[e.part] = strToU8(setTabColor(xml, TAB.yellow));
    out.tabbed.push(p.name);
  }
  out.bytes = zip(files);
  return out;
}

/** 2110 감사일정의 「감사계획: 2026.4.14」 → 「2026-04-14」. 못 읽으면 null. */
export function planDate(text: string | undefined): string | null {
  const m = /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/.exec(text ?? '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
