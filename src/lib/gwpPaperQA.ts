// 웹 조서 — 질문·기재형 조서(소규모 2520·2530). 1차 확정(중간감사 전).
//
// 모양(2026 소규모 양식): 질문 줄 뒤에 기재 줄이 온다 —
//   「(1)기업의 경영활동에서 재무제표에 유의적인 거래유형」
//   「-상기 파악한 내용의 기재 : ___ -또는 별도의 조서에서 검토 : 조서번호 ( ___ )」
// 기재 줄의 문구는 두고 ___ 자리만 바꿔 쓴다(2110 과 같은 방식). 수행자는 머리 「수 행 자」 열, 질문 줄에.
//
// 사용자 2026-09-28: 「2520·2530 은 빈칸인데 내용이 없어도 될까?」 → 회계감사기준 315 필수 문서화라 비우면 안 된다 →
// 「웹 조서로 만들어 주시고 지금 초안을 반영해 주세요」. 처음 열면 초안(작년 조서·전기 재무제표에서 가져온 것)으로 채운다.
import type { SheetData } from './xlsxRead';
import type { CellEdit } from './xlsxCells';
import { normLabel, textOf, colOf, rowOf, findHeader, type WebPaperDef } from './gwpWeb';
import type { StageNo } from './gwpStage';

export interface QaItem {
  /** 묶음 질문(「3. 감사 중 … 미비점을 알게 된 경우」) — 없으면 '' */ group: string;
  q: string;
  text: string;
  ref: string;
  performer: string;
  /** 초안에서 채웠다 — 사람이 확인할 것 */ draft?: boolean;
}
export interface PaperQA { items: QaItem[] }

export const DETAIL_RE = /(기재\s*[:：])([\s\S]*?)(-\s*또는\s*별도의\s*조서에서\s*검토\s*[:：]\s*조서번호\s*\()([\s\S]*?)(\))/;

type Line = { row: number; ref: string; text: string };
function linesA(sheet: SheetData): Line[] {
  const out: Line[] = [];
  for (const [ref, v] of sheet.cells) if (colOf(ref) === 'A' && v.formula == null && textOf(v)) out.push({ row: rowOf(ref), ref, text: textOf(v) });
  return out.sort((a, b) => a.row - b.row);
}

export function layoutQA(sheet: SheetData) {
  const lines = linesA(sheet);
  const head = findHeader(sheet, ['항 목', '수 행 자']) ?? findHeader(sheet, ['항목', '수행자']);
  const perfCol = head ? Object.values(head.cols)[1] : 'E';
  const items: { q: Line; detail: Line; group: string }[] = [];
  let group = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (DETAIL_RE.test(l.text)) continue;
    const next = lines[i + 1];
    if (next && DETAIL_RE.test(next.text)) {
      items.push({ q: l, detail: next, group: /^\(/.test(l.text.trim()) ? group : '' });
    } else if (/^\d\s*\./.test(l.text.trim())) group = l.text.trim();
  }
  return { perfCol, items };
}

function readQA(sheet: SheetData): PaperQA {
  const L = layoutQA(sheet);
  return {
    items: L.items.map(({ q, detail, group }) => {
      const m = DETAIL_RE.exec(detail.text);
      return { group, q: q.text, text: (m?.[2] ?? '').trim(), ref: (m?.[4] ?? '').trim(), performer: textOf(sheet.cells.get(`${L.perfCol}${q.row}`)) };
    }),
  };
}

function writeQA(sheet: SheetData, d: PaperQA): CellEdit[] {
  const L = layoutQA(sheet);
  if (!L.items.length) throw new Error('「-상기 파악한 내용의 기재 …」 줄을 찾지 못했습니다 — 소규모 양식 시트가 맞는지 보세요(① 올해 파일의 소규모 짝 정리).');
  const was = readQA(sheet);
  const e: CellEdit[] = [];
  L.items.forEach(({ q, detail }, i) => {
    const x = d.items[i];
    if (!x) return;
    const w = was.items[i];
    const pref = `${L.perfCol}${q.row}`;
    e.push(x.performer.trim() ? { ref: pref, text: x.performer.trim() } : { ref: pref, clear: true });
    if (x.text.trim() !== w?.text || x.ref.trim() !== w?.ref) {
      e.push({ ref: detail.ref, text: detail.text.replace(DETAIL_RE, (_m, a: string, b: string, c: string, _d, z: string) => {
        const tail = /\n/.test(b) ? /\s*$/.exec(b)![0] : ' ';
        return `${a} ${x.text.trim()}${tail}${c} ${x.ref.trim()} ${z}`;
      }) });
    }
  });
  return e;
}

/** 질문·기재형 시트를 고른다 — 그 모양이 있는 시트, 보이는 것 우선(짝 정리 전이면 숨긴 「(소규모)」). */
function pickQA(code: string) {
  return (sheets: SheetData[]) => sheets
    .filter((s) => normLabel(s.name).replace(/\(.*$/, '') === code)
    .sort((a, b) => Number(!!a.hidden) - Number(!!b.hidden))
    .find((s) => layoutQA(s).items.length > 0) ?? null;
}

// ── 초안 — 작년 조서(2511·2520)와 전기 재무제표에서. 사실은 사람이 확인한다. ──
export const DRAFT_2520: Pick<QaItem, 'text' | 'ref'>[] = [
  { text: '임대료 매출, 용지 매출, 차입금 및 이자비용 거래가 재무제표에 유의적인 거래유형임.', ref: '2120A' },
  { text: '회사는 별도의 전산조직이 없으며 회계처리를 외부 기장대리인에게 위탁함. 증빙에 따라 전표를 입력하고 총계정원장으로 집계됨.', ref: '' },
  { text: '세금계산서, 통장 거래내역, 임대차·분양 계약서, 차입 약정서를 증빙으로 기록함.', ref: '' },
  { text: '경영진이 영업에 직접 관여하여 중요한 계약·사건을 파악하고 기장대리인에게 전달함.', ref: '2511' },
  { text: '결산은 기장대리인이 작성하고 경영진이 검토함. 유의적 회계추정은 대손충당금, 건설용지(재고자산) 평가임.', ref: '' },
  { text: '결산 수정분개는 기장대리인이 작성하고 경영진이 승인함. 분개 테스트는 부정 검토에서 수행함.', ref: '3600' },
];
export const DRAFT_2530: Pick<QaItem, 'text' | 'ref'>[] = [
  { text: '해당 없음 — 통제의 운영 효과성에 의존하지 않고 실증절차 위주로 대응함.', ref: '3100' },
  { text: '해당 없음 — 실증절차만으로 충분하고 적합한 감사증거를 입수할 수 있음.', ref: '3100' },
  { text: '회사는 별도의 전산조직 없이 외부에 위탁하여 정보기술로부터 발생하는 위험이 낮음.', ref: '2520' },
  { text: '감사 중 알게 된 유의적인 내부통제 미비점 없음.', ref: '' },
  { text: '해당 없음 — 유의적 미비점이 발견되면 경영진 및 지배기구에 커뮤니케이션함.', ref: '8500' },
];

/** 비어 있는 기재 칸만 초안으로 — 이미 적은 것은 둔다. */
export function withDraft(d: PaperQA, draft: Pick<QaItem, 'text' | 'ref'>[], performer: string | null): PaperQA {
  return {
    items: d.items.map((x, i) => {
      const dr = draft[i];
      const empty = !x.text.trim() && !x.ref.trim();
      return {
        ...x,
        text: empty && dr ? dr.text : x.text,
        ref: empty && dr ? dr.ref : x.ref,
        performer: x.performer || performer || '',
        draft: empty && !!dr,
      };
    }),
  };
}

function qaDef(code: string, title: string, stage: StageNo, note: string): WebPaperDef<PaperQA> {
  return { code, title, stage, note, sheetCode: code, pick: pickQA(code), empty: () => ({ items: [] }), read: readQA, write: writeQA };
}
export const PAPER_2520 = qaDef('2520', '재무보고 관련 정보시스템 이해', 1, '소규모 — 거래유형·처리·기록·사건 포착·결산·비표준 분개 6항목. 초안에서 시작해 확인한다.');
export const PAPER_2530 = qaDef('2530', '통제활동의 이해', 1, '소규모 — 통제 평가가 필요한 경우인지·IT 위험·미비점. 실증 위주면 대부분 해당 없음.');
export const QA_DRAFTS: Record<string, Pick<QaItem, 'text' | 'ref'>[]> = { '2520': DRAFT_2520, '2530': DRAFT_2530 };
