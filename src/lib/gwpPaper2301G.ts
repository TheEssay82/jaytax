// 웹 조서 2301 — 일반·K-IFRS 2026 양식 「중요왜곡표시위험의 식별·평가 및 대응(재무제표 수준)」. 1차 확정(중간감사 전).
//
// 2026 개정으로 일반·K-IFRS 의 2301 은 소규모 2301(전체 재무제표 5개 + 계정별 경영진주장)과 다른 표가 됐다
// (2026-09-28 알티스트 검증에서 확인). 한 줄 = 재무제표 수준 위험 하나, 열 8개:
//   B 위험 · C 유의적 위험인지(Y/N) · D 해당하는 유의적 위험(부정/오류/부정 및 오류) · E 경영진주장 수준 위험 평가에 영향(Y/N)
//   F 전반적인 영향의 성격·규모 · G 관련 통제 이해(요약 또는 조서번호) · H 전반적인 대응 · I 비고
// 머리 줄이 두 번 나온다 — 첫째 아래가 입력 칸(양식 11~28행), 둘째 아래가 작성 예시(31행~, 화면에서 「예시에서 추가」).
// 작년 조서가 옛 모양(알티스트 FY25: 2301 전체 재무제표 5개)이면 그 판단을 줄로 옮겨 온다. 계정 수준은 2302(엑셀).
import type { SheetData } from './xlsxRead';
import type { CellEdit } from './xlsxCells';
import { normLabel, textOf, colOf, rowOf, findPaperSheet, type WebPaperDef } from './gwpWeb';
import { insertRows } from './xlsxRows';
import { readOld } from './gwpPaper2301';

export type YN = 'Y' | 'N' | '';
export interface FsRisk {
  risk: string;
  sig: YN;
  /** 부정 · 오류 · 부정 및 오류 */ kind: string;
  /** 경영진주장 수준의 위험 평가에 영향 */ affects: YN;
  impact: string;
  control: string;
  response: string;
  note: string;
}
export interface Paper2301G { risks: FsRisk[] }
export const RISK_KINDS = ['부정', '오류', '부정 및 오류'];

const FIELDS: { key: keyof FsRisk; re: RegExp }[] = [
  { key: 'risk', re: /^재무제표수준의중요왜곡표시위험$/ },
  { key: 'sig', re: /^유의적인위험인지/ },
  { key: 'kind', re: /^해당하는유의적위험/ },
  { key: 'affects', re: /^경영진주장수준의위험평가에영향/ },
  { key: 'impact', re: /^재무제표에미치는전반적인영향/ },
  { key: 'control', re: /^관련통제에대한/ },
  { key: 'response', re: /^전반적인대응/ },
  { key: 'note', re: /^비고$/ },
];

interface LayoutG { cols: Partial<Record<keyof FsRisk, string>>; from: number; to: number; exampleHead: number | null }
export function layout2301G(sheet: SheetData): LayoutG | null {
  const heads: { row: number; cols: Partial<Record<keyof FsRisk, string>> }[] = [];
  const byRow = new Map<number, { col: string; t: string }[]>();
  for (const [ref, v] of sheet.cells) {
    const t = v.formula == null ? normLabel(textOf(v)) : '';
    if (t) (byRow.get(rowOf(ref)) ?? byRow.set(rowOf(ref), []).get(rowOf(ref))!).push({ col: colOf(ref), t });
  }
  for (const r of [...byRow.keys()].sort((a, b) => a - b)) {
    const xs = byRow.get(r)!;
    const cols: Partial<Record<keyof FsRisk, string>> = {};
    for (const f of FIELDS) { const hit = xs.find((x) => f.re.test(x.t)); if (hit) cols[f.key] = hit.col; }
    if (cols.risk && cols.sig && cols.response) heads.push({ row: r, cols });
  }
  if (!heads.length) return null;
  const ex = heads[1]?.row ?? null;
  // 입력 칸 — 2026 양식은 머리가 두 줄 병합(10:11)이고 12~16행 다섯 줄(테두리), 17행은 빈 줄, 29행부터 작성 예시.
  // 머리 다음 줄이 비었으면 두 줄 머리로 본다. 회사가 줄을 끼웠으면 글자가 있는 마지막 줄까지.
  const riskCol = heads[0].cols.risk!;
  const blank = (r: number) => Object.values(heads[0].cols).every((c) => !textOf(sheet.cells.get(`${c}${r}`)));
  const from = heads[0].row + (blank(heads[0].row + 1) ? 2 : 1);
  // 줄을 끼우면 예시 머리도 밀린다 — 마지막 입력 줄은 예시 머리보다 TAIL 줄 위(양식 16 ↔ 29).
  let to = ex != null && ex - TAIL >= from + SLOTS - 1 ? ex - TAIL : from + SLOTS - 1;
  for (let r = to + 1; r < (ex ?? from + 200); r++) if (textOf(sheet.cells.get(`${riskCol}${r}`)) && !/예시|사례/.test(textOf(sheet.cells.get(`${riskCol}${r}`)))) to = r;
  return { cols: heads[0].cols, from, to, exampleHead: ex };
}
/** 2026 양식의 입력 줄 수, 마지막 입력 줄 → 작성 예시 머리 거리 */
const SLOTS = 5, TAIL = 13;

const yn = (s: string): YN => (/^y/i.test(s.trim()) ? 'Y' : /^n$/i.test(s.trim()) ? 'N' : '');
function rowAt(sheet: SheetData, L: LayoutG, r: number): FsRisk {
  const get = (k: keyof FsRisk) => (L.cols[k] ? textOf(sheet.cells.get(`${L.cols[k]}${r}`)) : '');
  return { risk: get('risk'), sig: yn(get('sig')), kind: get('kind'), affects: yn(get('affects')), impact: get('impact'), control: get('control'), response: get('response'), note: get('note') };
}

/** 양식의 작성 예시 줄 — 「예시에서 추가」. */
export function readExamples(sheet: SheetData): FsRisk[] {
  const L = layout2301G(sheet);
  if (!L?.exampleHead) return [];
  const out: FsRisk[] = [];
  for (let r = L.exampleHead + 1; r <= L.exampleHead + 40; r++) { const x = rowAt(sheet, L, r); if (x.risk) out.push(x); }
  return out;
}

/** 옛 모양(2025 이전 2301 전체 재무제표 5개)의 판단 → 줄. 번호는 떼고, 부정 줄은 「부정」. */
export function fromOld(s2301: SheetData | null): FsRisk[] {
  return readOld(s2301, null).entity.map((e) => {
    const risk = e.label.replace(/^\s*\d\s*\.\s*/, '').trim();
    const sig: YN = e.sig === 'Y' ? 'Y' : e.sig === 'N' ? 'N' : '';
    return { risk, sig, kind: sig === 'Y' ? (/부정/.test(risk) ? '부정' : '부정 및 오류') : '', affects: sig === 'Y' ? 'Y' : '', impact: e.basis, control: '', response: '', note: '' };
  });
}

/** 규칙 — 부정으로 인한 위험은 유의적 위험(기준서 240 문단 27). */
function withRules(d: Paper2301G): Paper2301G {
  return { risks: d.risks.map((x) => (/부정/.test(x.risk) && !/특수관계|법규/.test(x.risk) && !x.sig ? { ...x, sig: 'Y', kind: x.kind || '부정' } : x)) };
}

export const PAPER_2301G: WebPaperDef<Paper2301G> = {
  code: '2301', title: '중요왜곡표시위험(재무제표 수준)', stage: 1, sheetCode: '2301', useTemplate: true,
  note: '재무제표 수준 위험마다 유의적 여부·해당 위험·경영진주장 영향·영향·관련 통제·전반적 대응. 작년 판단·양식 예시에서 시작. 계정 수준은 2302(엑셀).',
  empty: () => ({ risks: [] }),
  read: (s) => PAPER_2301G.readBook!([s]),
  readBook(sheets) {
    const s = findPaperSheet(sheets, '2301');
    const L = s ? layout2301G(s) : null;
    if (s && L) {
      const risks: FsRisk[] = [];
      for (let r = L.from; r <= L.to; r++) { const x = rowAt(s, L, r); if (x.risk) risks.push(x); }
      return withRules({ risks });
    }
    return withRules({ risks: fromOld(s) });
  },
  // 줄이 양식 칸보다 많으면 끼운다(마지막 칸 줄의 서식을 본떠).
  prepareXml(xml, sheet, d) {
    const L = layout2301G(sheet);
    if (!L) return xml;
    const slots = L.to - L.from + 1;
    return d.risks.length > slots ? insertRows(xml, L.to + 1, d.risks.length - slots, L.to) : xml;
  },
  write(sheet, d) {
    const L = layout2301G(sheet);
    if (!L) throw new Error('2301 이 올해(일반·K-IFRS 2026) 양식 모양이 아닙니다 — 반영할 때 올해 양식으로 맞춥니다(표준양식이 등록돼 있어야 합니다).');
    const slots = L.to - L.from + 1;
    if (d.risks.length > slots) throw new Error('2301 칸이 모자랍니다 — 줄 끼우기가 먼저 돼야 합니다.');
    const e: CellEdit[] = [];
    for (let i = 0; i < slots; i++) {
      const x = d.risks[i];
      for (const f of FIELDS) {
        const col = L.cols[f.key];
        if (!col) continue;
        const v = x ? String(x[f.key] ?? '').trim() : '';
        const ref = `${col}${L.from + i}`;
        e.push(v ? { ref, text: v } : { ref, clear: true });
      }
    }
    return e;
  },
};
