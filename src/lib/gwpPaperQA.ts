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
import { cleanFs, type Paper2120A, type Sec } from './gwpPaper2120A';

export interface QaItem {
  /** 묶음 질문(「3. 감사 중 … 미비점을 알게 된 경우」) — 없으면 '' */ group: string;
  q: string;
  text: string;
  ref: string;
  performer: string;
  /** 초안에서 채웠다 — 사람이 확인할 것 */ draft?: boolean;
}
export interface PaperQA {
  items: QaItem[];
  /** 회계처리를 누가 하나 — 2520·2530 초안이 같이 쓴다 */ keeper?: Keeper | null;
}

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

// ── 초안 — 회사마다 만든다(사용자 2026-09-28 「이제 다른 회사도 다 해야」). ──
// 재무제표에서 알 수 있는 것(유의적 거래유형·회계추정)은 2120A 계정에서, 알 수 없는 것(회계처리를 누가 하나)은
// 화면에서 한 번 고르게 한다. 모르는 자리는 ○○ 로 남기고 [확인] 때 막는다 — 틀린 사실을 조용히 넣지 않는다.
export type DraftItem = Pick<QaItem, 'text' | 'ref'>;
export const BLANK = '○○';
export type Keeper = '외부' | '내부' | 'ERP';
export const KEEPERS: { key: Keeper; label: string; who: string }[] = [
  { key: '외부', label: '외부 기장대리인에 위탁', who: '기장대리인' },
  { key: '내부', label: '회사 회계담당자(상용 회계프로그램)', who: '회계담당자' },
  { key: 'ERP', label: '회사 ERP·회계팀', who: '회계팀' },
];
/** 재무제표 한 줄 — 2120A 에서. */
export interface FsFact { label: string; amount: number; sec?: Sec; pl: boolean }
export interface DraftCtx { fs: FsFact[] | null; keeper: Keeper | null }

/** 2120A 줄 → 재무제표 사실(당기 열, 없으면 전기 열). 금액 없는 줄은 뺀다. 믿을 만하지 않으면 null. */
export function fsFacts(d: Paper2120A | null | undefined): FsFact[] | null {
  const out = (d?.rows ?? []).flatMap((r) => {
    const amount = r.cur ?? r.prev;
    return amount ? [{ label: cleanFs(r.label), amount, sec: r.sec, pl: r.pl }] : [];
  });
  // 몇 줄 못 읽었으면(양식이 달라 2120A 를 제대로 못 읽음) 믿지 않는다 — 「추정 항목 없음」 같은 틀린 초안을 내지 않게.
  return out.length >= 10 && out.some((x) => x.pl) && out.some((x) => !x.pl) ? out : null;
}

const TOTAL_RE = /총계|합계|소계|^계$|이익$|손실$|손익$/;
/** 계정 → 거래유형. 위에서부터 첫째로 맞는 것. */
const KIND: [RegExp, string][] = [
  [/매출원가|원가/, '구매'], [/매출|영업수익|수익$|임대료|수수료수익/, '판매'],
  [/급여|상여|퇴직/, '인건비'], [/차입금|사채|이자/, '자금'], [/재고|상품|제품|원재료|재공품|용지/, '구매'],
  [/매출채권|외상매출/, '판매'], [/매입채무|외상매입/, '구매'], [/유형자산|건물|기계|토지|구축물|투자부동산/, '설비투자'],
];
/** 계정 → 회계추정. */
const ESTIMATE: [RegExp, string][] = [
  [/대손충당금/, '대손충당금'], [/재고|상품|제품|원재료|재공품|용지/, '재고자산 평가'],
  [/건물|기계|구축물|차량|비품|유형자산|사용권자산/, '유형자산 내용연수'], [/투자부동산/, '투자부동산 내용연수'],
  [/무형자산|영업권|개발비|소프트웨어/, '무형자산 손상'], [/퇴직급여|확정급여/, '퇴직급여부채'],
  [/이연법인세/, '이연법인세 회수가능성'], [/(?<!대손)충당부채/, '충당부채'],
  [/공정가치|매도가능|파생/, '금융상품 공정가치'], [/계약자산|미청구|초과청구|진행/, '진행률(수익인식)'],
];
const josa = (w: string) => (w === BLANK ? `${w}이(가)` : /[가-힣]$/.test(w) && (w.charCodeAt(w.length - 1) - 0xac00) % 28 ? `${w}이` : `${w}가`);
const uniq = (xs: string[]) => [...new Set(xs)];

/** 유의적 거래유형 — 금액 큰 계정(손익은 매출의 10%·재무상태는 자산의 10% 이상). */
export function significantLines(fs: FsFact[]): { labels: string[]; kinds: string[] } {
  const body = fs.filter((x) => x.sec !== '자본' && !TOTAL_RE.test(x.label) && !/현금|자본금|잉여금/.test(x.label));
  const pl = body.filter((x) => x.pl).map((x) => Math.abs(x.amount));
  const sales = body.filter((x) => x.pl && /매출|영업수익/.test(x.label) && !/원가/.test(x.label)).map((x) => Math.abs(x.amount));
  const rev = Math.max(0, ...(sales.length ? sales : pl));
  const asset = body.filter((x) => x.sec === '자산' && !x.pl).reduce((t, x) => t + x.amount, 0);
  const pick = (xs: FsFact[], base: number, n: number) => xs.filter((x) => base > 0 && Math.abs(x.amount) >= base * 0.1)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, n);
  const lines = [...pick(body.filter((x) => x.pl), rev, 4), ...pick(body.filter((x) => !x.pl), asset, 3)];
  return { labels: uniq(lines.map((x) => x.label)), kinds: uniq(lines.flatMap((x) => KIND.find(([re]) => re.test(x.label))?.[1] ?? [])) };
}
export function estimatesOf(fs: FsFact[]): string[] {
  return uniq(fs.filter((x) => !x.pl).flatMap((x) => ESTIMATE.find(([re]) => re.test(x.label))?.[1] ?? []));
}

export function draft2520({ fs, keeper }: DraftCtx): DraftItem[] {
  const who = KEEPERS.find((k) => k.key === keeper)?.who ?? BLANK;
  const sig = fs ? significantLines(fs) : null;
  const est = fs ? estimatesOf(fs) : null;
  const types = sig?.labels.length
    ? `${sig.labels.join(', ')} 관련 거래${sig.kinds.length ? `(${sig.kinds.join('·')})` : ''}가 재무제표에 유의적인 거래유형임.`
    : `${BLANK} 거래가 재무제표에 유의적인 거래유형임.`;
  const system = keeper === '외부' ? '회사는 별도의 전산조직이 없으며 회계처리를 외부 기장대리인에게 위탁함. 증빙에 따라 전표를 입력하고 총계정원장으로 집계됨.'
    : keeper === '내부' ? '회계담당자가 상용 회계프로그램에 증빙에 따라 전표를 입력하고 총계정원장으로 집계됨.'
    : keeper === 'ERP' ? '거래는 회사 ERP 에서 발생 부서가 입력하고 회계팀이 전표를 확정하여 총계정원장으로 집계됨.'
    : `회계처리는 ${BLANK}에서 증빙에 따라 전표를 입력하고 총계정원장으로 집계됨.`;
  return [
    { text: types, ref: '2120A' },
    { text: system, ref: '' },
    { text: '세금계산서·계산서, 카드·통장 거래내역, 계약서를 증빙으로 전표를 기록함.', ref: '' },
    { text: `경영진이 영업에 직접 관여하여 중요한 계약·사건을 파악하고 ${who}에게 전달함.`, ref: '2511' },
    { text: `결산은 ${josa(who)} 작성하고 경영진이 검토함. ${est == null ? `유의적 회계추정은 ${BLANK}임.` : est.length ? `유의적 회계추정은 ${est.join(', ')}임.` : '유의적 회계추정 항목 없음.'}`, ref: '' },
    { text: `결산 수정분개는 ${josa(who)} 작성하고 경영진이 승인함. 분개 테스트는 부정 검토에서 수행함.`, ref: '3600' },
  ];
}
export function draft2530({ keeper }: DraftCtx): DraftItem[] {
  const it = keeper === '외부' ? '회사는 별도의 전산조직 없이 회계처리를 외부에 위탁하여 정보기술로부터 발생하는 위험이 낮음.'
    : keeper === '내부' ? '상용 회계프로그램을 수정 없이 사용하고 사용자가 소수여서 정보기술로부터 발생하는 위험이 낮음.'
    : keeper === 'ERP' ? 'ERP 를 사용하나 프로그램 변경이 드물고 접근권한이 부서별로 나뉘어 있어 정보기술로부터 발생하는 위험이 낮음.'
    : `회계처리 환경(${BLANK})을 고려할 때 정보기술로부터 발생하는 위험이 낮음.`;
  return [
    { text: '해당 없음 — 통제의 운영 효과성에 의존하지 않고 실증절차 위주로 대응함.', ref: '3100' },
    { text: '해당 없음 — 실증절차만으로 충분하고 적합한 감사증거를 입수할 수 있음.', ref: '3100' },
    { text: it, ref: '2520' },
    { text: '감사 중 알게 된 유의적인 내부통제 미비점 없음.', ref: '' },
    { text: '해당 없음 — 유의적 미비점이 발견되면 경영진 및 지배기구에 커뮤니케이션함.', ref: '8500' },
  ];
}

/** 초안 칸(아직 사람이 안 고친 것)만 새 초안으로 — 「회계처리를 누가」를 바꿨을 때. */
export function redraft(d: PaperQA, draft: DraftItem[]): PaperQA {
  return { ...d, items: d.items.map((x, i) => (x.draft && draft[i] ? { ...x, ...draft[i] } : x)) };
}
/** ○○ 가 남은 항목 수 — [확인] 전에 채워야 한다. */
export const blanksLeft = (d: PaperQA) => d.items.filter((x) => x.text.includes(BLANK) || x.ref.includes(BLANK)).length;

/** 비어 있는 기재 칸만 초안으로 — 이미 적은 것은 둔다. */
export function withDraft(d: PaperQA, draft: DraftItem[], performer: string | null): PaperQA {
  return {
    ...d,
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
export const QA_DRAFTS: Record<string, (c: DraftCtx) => DraftItem[]> = { '2520': draft2520, '2530': draft2530 };
