// 웹 조서 2301 감사위험의 평가 — 1차 확정(중간감사 전).
//
// 사용자 2026-09-27: 「서술이 있으므로 엑셀을 올리는 것보다 추천해 준 문구를 웹으로 확인하고 CONFIRM 을 통해 확정」.
// 「명진 2301 은 판단처럼」 — 올해 양식 2301 한 장(전체 재무제표 수준 + 계정 수준 · 경영진주장 10개)에 쓰고,
// 옛 2302(계정 수준)는 숨긴다. 작년 판단은 옛 2301·2302 에서 읽어 온다.
//
// 추천(사람이 확인·수정 후 반영):
//   · 고정 규칙 — 부정(전체 재무제표 1번)은 유의적 위험(기준서 240 문단 27), 매출은 유의적 위험(수익인식 부정 추정, 문단 26)
//   · 작년 판단 — 유의적 여부·근거를 그대로
//   · 양식 작성사례 — 계정별 경영진주장 기본값(현금성자산은 A·C·E·V·RO·CL·U·P 등)
//   · 양식 참고자료 — 계정별 「주요 왜곡표시위험 사례」(근거 문구 후보)
//   · 2120A — 전기 대비 크게 변한 계정
import type { SheetData } from './xlsxRead';
import type { CellEdit } from './xlsxCells';
import { normLabel, textOf, colOf, rowOf, findPaperSheet, type WebPaperDef } from './gwpWeb';
import { insertRows } from './xlsxRows';

export const ASSERTIONS = ['A', 'C', 'CO', 'E', 'O', 'V', 'RO', 'CL', 'U', 'P'] as const;
export type Asr = (typeof ASSERTIONS)[number];
export const ASR_NAME: Record<Asr, string> = {
  A: '정확성', C: '완전성', CO: '기간귀속', E: '실재성', O: '발생사실', V: '평가', RO: '권리와 의무', CL: '분류', U: '이해가능성', P: '표시',
};
export type Sig = 'Y' | 'N' | 'N/A' | '';
export interface RiskLine { label: string; sig: Sig; asr: Asr[]; basis: string; proc: string }
export interface Paper2301 { entity: RiskLine[]; accounts: RiskLine[] }

type Hit = { row: number; col: string; text: string };
function hitsOf(sheet: SheetData): Hit[] {
  const out: Hit[] = [];
  for (const [ref, v] of sheet.cells) { const t = textOf(v); if (t && v.formula == null && v.text != null) out.push({ row: rowOf(ref), col: colOf(ref), text: t }); }
  return out.sort((a, b) => a.row - b.row);
}
const at = (sheet: SheetData, ref: string) => textOf(sheet.cells.get(ref));

// ── 올해 양식 모양 ──────────────────────────────────────
interface Layout {
  asrCol: Record<Asr, string>; sigCol: string; basisCol: string; procCol: string;
  entityRows: { row: number; no: number; label: string }[];
  /** 계정 칸 — 첫 줄부터 끝 표시(「:」·「※」) 앞 줄까지 */ slotFrom: number; slotTo: number; endRow: number;
}
export function layout2301(sheet: SheetData): Layout | null {
  const hits = hitsOf(sheet);
  const heads = hits.filter((h) => h.col === 'A' && normLabel(h.text).startsWith('구분(*1)'));
  if (heads.length < 2) return null;
  const asrRow = (hr: number) => hits.filter((h) => h.row === hr + 1 && (ASSERTIONS as readonly string[]).includes(h.text.toUpperCase()));
  const ar = asrRow(heads[0].row);
  if (ar.length < 8) return null;
  const asrCol = Object.fromEntries(ar.map((h) => [h.text.toUpperCase(), h.col])) as Record<Asr, string>;
  const inHead = (re: RegExp) => hits.find((h) => h.row === heads[0].row && re.test(normLabel(h.text)))?.col;
  const sigCol = inHead(/^유의적위험\(Y\/N\)/) ?? 'B';
  const basisCol = inHead(/판단근거/) ?? 'M';
  const procCol = inHead(/위험평가/) ?? 'P';
  const entityRows = hits.filter((h) => h.col === 'A' && h.row > heads[0].row + 1 && h.row < heads[1].row && /^\d\s*\./.test(h.text))
    .map((h) => ({ row: h.row, no: Number(/^(\d)/.exec(h.text)![1]), label: h.text }));
  const title = hits.find((h) => h.col === 'A' && h.row > heads[1].row && /^Ⅰ\.?\s*거래유형/.test(h.text.trim()));
  const from = (title?.row ?? heads[1].row + 2) + 1;
  const end = hits.find((h) => h.col === 'A' && h.row >= from && (/^[:：]$/.test(h.text.trim()) || /^※/.test(h.text.trim()) || normLabel(h.text).startsWith('구분(*1)')));
  const endRow = end?.row ?? from + 6;
  return { asrCol, sigCol, basisCol, procCol, entityRows, slotFrom: from, slotTo: endRow - 1, endRow };
}

function readNew(sheet: SheetData, L: Layout): Paper2301 {
  const line = (row: number, label: string): RiskLine => ({
    label,
    sig: (at(sheet, `${L.sigCol}${row}`).toUpperCase() as Sig) || '',
    asr: ASSERTIONS.filter((a) => /^[VvOo✓√]$/.test(at(sheet, `${L.asrCol[a]}${row}`))),
    basis: at(sheet, `${L.basisCol}${row}`),
    proc: /^-?위험평가절차의 기재\s*:?\s*-?또는 별도의 조서/.test(at(sheet, `${L.procCol}${row}`).replace(/\s+/g, ' ')) ? '' : at(sheet, `${L.procCol}${row}`),
  });
  const accounts: RiskLine[] = [];
  for (let r = L.slotFrom; r <= L.slotTo; r++) { const lab = at(sheet, `A${r}`); if (lab) accounts.push(line(r, lab)); }
  return { entity: L.entityRows.map((e) => line(e.row, e.label)), accounts };
}

// ── 옛 모양(명진 FY25: 2301 전사 + 2302 계정) ────────────────
function readOld(s2301: SheetData | null, s2302: SheetData | null): Paper2301 {
  const entity: RiskLine[] = [];
  if (s2301) {
    const hits = hitsOf(s2301);
    // 「Ⅰ. 전체재무제표 수준」 아래의 1.~5. 만 — 위쪽 작성요령(「3. 구체적인 판단의 근거…」)도 번호로 시작한다.
    const title = hits.find((x) => x.col === 'A' && /^Ⅰ\.?\s*전체재무제표/.test(x.text.trim()))?.row ?? 0;
    for (const h of hits.filter((x) => x.col === 'A' && x.row > title && /^\d\s*\./.test(x.text))) {
      if (entity.some((e) => e.label.startsWith(h.text.slice(0, 2)))) continue;
      const sig = at(s2301, `C${h.row}`).toUpperCase();
      entity.push({ label: h.text, sig: (['Y', 'N', 'N/A'].includes(sig) ? sig : '') as Sig, asr: [], basis: at(s2301, `G${h.row}`), proc: '' });
    }
  }
  const accounts: RiskLine[] = [];
  if (s2302) {
    const hits = hitsOf(s2302);
    const head = hits.find((h) => h.col === 'A' && normLabel(h.text).startsWith('계정과목(*1)'));
    const stop = hits.find((h) => h.col === 'A' && h.row > (head?.row ?? 0) && /^\[참고자료\]/.test(h.text));
    for (const h of hits.filter((x) => x.col === 'A' && x.row > (head?.row ?? 1e9) + 1 && x.row < (stop?.row ?? 1e9))) {
      const judge = at(s2302, `H${h.row}`);
      const ref = at(s2302, `I${h.row}`);
      const sig: Sig = /^N\/?A$/i.test(judge) ? 'N/A' : !judge || /일반적인\s*위험/.test(judge) ? 'N' : 'Y';
      accounts.push({ label: h.text, sig, asr: [], basis: sig === 'N/A' ? '' : judge, proc: ref ? `조서번호 ${ref}` : '' });
    }
  }
  return { entity, accounts };
}

export const PAPER_2301: WebPaperDef<Paper2301> = {
  code: '2301', title: '감사위험의 평가', stage: 1, sheetCode: '2301', useTemplate: true, retire: ['2302'],
  note: '전체 재무제표 수준 5개 + 계정별 유의적 위험·경영진주장 — 작년 판단·양식 사례·규칙으로 추천, 확인 후 반영.',
  empty: () => ({ entity: [], accounts: [] }),
  read: (s) => PAPER_2301.readBook!([s]),
  readBook(sheets) {
    const s = findPaperSheet(sheets, '2301');
    const L = s ? layout2301(s) : null;
    const d = s && L ? readNew(s, L) : readOld(s, findPaperSheet(sheets, '2302'));
    return withDefaults(d);
  },
  // 계정이 양식 칸보다 많으면 줄을 끼운다(마지막 칸 줄의 서식을 본떠).
  prepareXml(xml, sheet, d) {
    const L = layout2301(sheet);
    if (!L) return xml;
    const slots = L.slotTo - L.slotFrom + 1;
    return d.accounts.length > slots ? insertRows(xml, L.endRow, d.accounts.length - slots, L.slotTo) : xml;
  },
  write(sheet, d) {
    const L = layout2301(sheet);
    if (!L) throw new Error('2301 이 올해 양식 모양이 아닙니다 — 반영할 때 올해 양식으로 맞춥니다(표준양식이 등록돼 있어야 합니다).');
    const e: CellEdit[] = [];
    const put = (ref: string, v: string) => e.push(v.trim() ? { ref, text: v.trim() } : { ref, clear: true });
    const line = (row: number, x: RiskLine, withLabel: boolean) => {
      if (withLabel) put(`A${row}`, x.label);
      put(`${L.sigCol}${row}`, x.sig);
      for (const a of ASSERTIONS) put(`${L.asrCol[a]}${row}`, x.sig !== 'N/A' && x.asr.includes(a) ? 'V' : '');
      put(`${L.basisCol}${row}`, x.basis);
      if (x.proc.trim()) put(`${L.procCol}${row}`, x.proc);
    };
    for (const er of L.entityRows) {
      const x = d.entity.find((y) => Number(/^(\d)/.exec(y.label.trim())?.[1]) === er.no);
      if (x) line(er.row, x, false);
    }
    const slots = L.slotTo - L.slotFrom + 1;
    if (d.accounts.length > slots) throw new Error('2301 계정 칸이 모자랍니다 — 줄 끼우기가 먼저 돼야 합니다.');
    for (let i = 0; i < slots; i++) {
      const row = L.slotFrom + i;
      const x = d.accounts[i];
      if (x) line(row, x, true);
      else for (const c of ['A', L.sigCol, ...ASSERTIONS.map((a) => L.asrCol[a]), L.basisCol]) put(`${c}${row}`, '');
    }
    return e;
  },
};

// ── 추천 ────────────────────────────────────────────────
/** 양식 작성사례의 경영진주장 기본값(2026 소규모 양식 2301 44~71행). */
const ASR_BS: Asr[] = ['A', 'C', 'E', 'V', 'RO', 'CL', 'U', 'P'];
const ASR_PL: Asr[] = ['A', 'C', 'CO', 'O', 'RO', 'CL', 'U', 'P'];
const PL_WORDS = /매출|원가|비용|수익|손익|급여|상각비|판매비|관리비|이자|법인세비용|처분|손실|이익/;
export function defaultAssertions(label: string): Asr[] {
  const l = normLabel(label);
  if (/^이자수익|^이자비용|판매비와관리비/.test(l)) return ['A', 'C', 'CO', 'O', 'CL', 'U', 'P'];
  if (/부채|채무|미지급|충당|차입|예수|보증금/.test(l) && !/비용$/.test(l)) return ASR_BS;
  return PL_WORDS.test(l) && !/채권|미수|선급/.test(l) ? ASR_PL : ASR_BS;
}
export const FRAUD_BASIS = '개정 회계감사기준 240 문단 27 — 경영진의 통제무력화 위험은 모든 기업에 존재하므로 유의적 위험으로 취급함';
export const REVENUE_BASIS = '수익인식에는 부정위험이 있다는 추정(회계감사기준 240 문단 26) — 매출의 발생사실·기간귀속을 유의적 위험으로 봄';
const isRevenue = (label: string) => { const l = normLabel(label); return /^(매출|매출액|수익|영업수익)$/.test(l) || (/매출$/.test(l) && !/원가|채권|총이익/.test(l)); };

/** 비어 있는 경영진주장만 기본값으로(작년에 고른 것은 둔다). */
function withDefaults(d: Paper2301): Paper2301 {
  return {
    entity: d.entity.map((x) => ({ ...x, asr: x.asr.length ? x.asr : x.sig === 'N/A' ? [] : [...ASSERTIONS] })),
    accounts: d.accounts.map((x) => ({ ...x, asr: x.asr.length || x.sig === 'N/A' ? x.asr : defaultAssertions(x.label) })),
  };
}

export interface Hint { kind: '규칙' | '2120A' | '사례'; text: string; apply?: Partial<RiskLine> }
export interface LibCase { group: string; risk: string; asr: Asr[] }

/** 양식 「참고자료」 — 계정과목 · 주요 왜곡표시위험 사례 · 경영진 주장. */
export function readLibrary(sheet: SheetData): LibCase[] {
  const hits = hitsOf(sheet);
  const head = hits.find((h) => h.col === 'A' && normLabel(h.text) === '계정과목' && hits.some((x) => x.row === h.row && /왜곡표시위험사례/.test(normLabel(x.text))));
  if (!head) return [];
  const asrCol = hits.find((x) => x.row === head.row && /경영진주장/.test(normLabel(x.text)))?.col ?? 'M';
  const out: LibCase[] = [];
  let group = '';
  for (const r of [...new Set(hits.filter((h) => h.row > head.row).map((h) => h.row))]) {
    const g = at(sheet, `A${r}`);
    if (g) group = g;
    const risk = at(sheet, `B${r}`);
    if (!risk) continue;
    const asr = (at(sheet, `${asrCol}${r}`).toUpperCase().match(/CO|CL|RO|[ACEOVUP]/g) ?? []) as Asr[];
    out.push({ group, risk, asr: [...new Set(asr)] });
  }
  return out;
}
export function casesFor(label: string, lib: LibCase[]): LibCase[] {
  const l = normLabel(label);
  return lib.filter((c) => normLabel(c.group).split(/[/,()·]/).filter((t) => t.length >= 2).some((t) => l.includes(t) || t.includes(l)));
}

/** 줄마다 추천 — 규칙·2120A 변동·양식 사례. big 은 2120A 에서 크게 변한 계정(라벨 → 설명). */
export function hintsFor(x: RiskLine, kind: 'entity' | 'account', big: Map<string, string>, lib: LibCase[]): Hint[] {
  const out: Hint[] = [];
  if (kind === 'entity' && /^1\s*\./.test(x.label.trim()) && (x.sig !== 'Y' || !x.basis)) {
    out.push({ kind: '규칙', text: '부정 위험은 유의적 위험(기준서 240 문단 27)', apply: { sig: 'Y', basis: x.basis || FRAUD_BASIS } });
  }
  if (kind === 'account' && isRevenue(x.label) && x.sig !== 'Y') {
    out.push({ kind: '규칙', text: '매출은 유의적 위험(수익인식 부정 추정)', apply: { sig: 'Y', basis: x.basis && !/일반적인 위험/.test(x.basis) ? x.basis : REVENUE_BASIS, asr: ['O', 'CO'] } });
  }
  if (kind === 'account') {
    const b = [...big.entries()].find(([k]) => normLabel(k) === normLabel(x.label) || normLabel(k).includes(normLabel(x.label)));
    if (b) out.push({ kind: '2120A', text: `2120A: ${b[1]} — 유의적 위험인지 다시 보세요` });
    const cs = casesFor(x.label, lib);
    if (cs.length && x.sig === 'Y') out.push({ kind: '사례', text: `양식 사례 ${cs.length}개: ${cs.slice(0, 2).map((c) => c.risk).join(' · ')}${cs.length > 2 ? ' …' : ''}` });
  }
  return out;
}
