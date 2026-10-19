// 팀결산 경비 귀속 — 줄마다 「제안」을 만든다(확정은 사람이 한다. 사용자 2026-10-19 「적요만으로 강제 분류한 뒤 확정하면 안 된다」).
//
// 한 줄의 결정 = 클라이언트 꼬리표(거래처명 · 기장 · 기타) + 업무 금액(나머지는 개인).
//   · 「기장」 업무 = 기장비용으로 안분 · 그 밖의 업무 = 3인 공동 · 개인 = 바구니 주인 귀속.
// 제안 순서:
//   1. 이전에 **확정한** 같은 내역(같은 적요·계정) — 사람이 이미 판단한 것이라 가장 믿을 만하다
//   2. 적요에 JAYTAX 거래처 이름이 있으면 그 거래처. 접대비는 바구니 주인의 기장·세무조정 거래처면 개인
//      (「정우철 개인 거래처 접대」, 2026-10-19), 감사·용역 거래처면 업무(작년엔 섞여 검토 필요)
//   3. 낱말 규칙 — 인지세·사무용품·오피스 → 기장 업무 / 교육·도서·경조 → 개인
//   4. 야근·주말·휴일 식대, 골프는 **제안하지 않는다**(적요와 실제가 자주 다르다)
export type ExpenseKind = '업무' | '개인';

export interface ExpenseLineIn {
  description: string;
  account: string;
  vendor: string;
  supply: number;
}

export interface ClientRef {
  name: string;          // 표시 이름(㈜ 붙임)
  keys: string[];        // 적요에서 찾을 이름들(정규화 전)
  /** 기장·세무조정(기장팀 계약)으로 이 거래처를 가진 바구니 */
  taxOwners: string[];
  /** 감사·용역 계약 담당 회계사 */
  auditOwners: string[];
}

export interface PriorDecision {
  description: string;
  account: string;
  client: string;
  workRatio: number;     // 업무 / 공급가액 (0~1)
}

export interface Suggestion {
  client: string | null;
  work: number | null;   // 업무 금액(null = 제안 없음)
  reason: string;
}

const norm = (s: string) => s
  .replace(/주식회사|유한회사|\(주\)|㈜|\(유\)|\(합\)|\(사\)|\s/g, '')
  .replace(/[()[\]\-_.,·/]/g, '')
  .toLowerCase();
/** 적요 비교용 — 날짜·숫자·괄호 속 메모를 떼어 「같은 내역」을 넓게 잡는다. */
export const descKey = (s: string) => norm(s.replace(/\d+[./월일]\d*[일]?|\d+/g, ''));

const JUDGE = /야근|주말|휴일|골프|라운딩|cc\b|c\.c/i;
const BOOKKEEPING = /인지세|위하고|세무사랑|더존|오피스|사무용품|소모품|모니터|복합기|토너|파티션|책상|기장팀|기장24팀/;
const PERSONAL = /교육|연수|수강|도서|책자|한공회|경조|조의|축의|부의|명절|일비|자동차세|자동차보험|주유/;
const ENTERTAIN = /기업업무추진비|접대/;

export function suggest(line: ExpenseLineIn, basket: string, clients: ClientRef[], prior: PriorDecision[]): Suggestion {
  const d = line.description || '';
  const key = descKey(d);
  // 1. 이전 확정과 같은 내역
  const hit = key.length >= 2 ? prior.find((p) => descKey(p.description) === key && p.account === line.account) : undefined;
  if (hit) {
    return { client: hit.client, work: Math.round(line.supply * hit.workRatio), reason: `이전에 확정한 같은 내역(${hit.client} · ${hit.workRatio >= 1 ? '업무' : hit.workRatio <= 0 ? '개인' : '일부 업무'})` };
  }
  if (JUDGE.test(d) || JUDGE.test(line.vendor || '')) {
    return { client: null, work: null, reason: '판단 필요 — 야근·주말·휴일 식대나 골프는 적요만으로 정하지 않습니다' };
  }
  // 2. 적요 속 거래처
  const nd = norm(d);
  let best: ClientRef | null = null, bestLen = 0;
  for (const c of clients) {
    for (const k of c.keys) {
      const nk = norm(k);
      if (nk.length >= 2 && nd.includes(nk) && nk.length > bestLen) { best = c; bestLen = nk.length; }
    }
  }
  if (best) {
    const entertain = ENTERTAIN.test(line.account || '') || ENTERTAIN.test(d);
    if (entertain && best.taxOwners.includes(basket)) {
      return { client: best.name, work: 0, reason: `${basket} 기장·세무조정 거래처 접대 → 개인 거래처(개인)` };
    }
    if (entertain) {
      return { client: best.name, work: line.supply, reason: '감사·용역 거래처 접대 → 업무로 제안(작년엔 업무·개인이 섞였습니다. 검토)' };
    }
    return { client: best.name, work: line.supply, reason: '거래처 업무 관련 비용 → 업무' };
  }
  // 3. 낱말 규칙
  if (BOOKKEEPING.test(d)) return { client: '기장', work: line.supply, reason: '기장 업무 비용(인지세·사무용품·프로그램 등)' };
  if (PERSONAL.test(d)) return { client: '기타', work: 0, reason: '교육·도서·경조·차량 등 → 개인' };
  return { client: null, work: null, reason: '제안 없음 — 직접 판단' };
}

/** 개인 금액 = 공급가액 − 업무 − 김준성 몫 − 조현규 몫 */
export const personalOf = (l: { supply: number; work_amount: number | null; split_kjs: number; split_jhg: number }) =>
  l.supply - (l.work_amount ?? 0) - (l.split_kjs || 0) - (l.split_jhg || 0);

/** 집계 — 기장 업무 / 그 밖의 업무(3인 공동) / 개인 / 김준성 / 조현규 */
export function summarize(lines: { client: string | null; supply: number; work_amount: number | null; split_kjs: number; split_jhg: number; status: string; excluded?: boolean }[]) {
  const s = { supply: 0, bookkeeping: 0, team: 0, personal: 0, kjs: 0, jhg: 0, unset: 0, excluded: 0, confirmed: 0, suggested: 0, open: 0 };
  for (const l of lines) {
    s.supply += l.supply;
    if (l.status === '확정') s.confirmed++; else if (l.status === '제안') s.suggested++; else s.open++;
    if (l.excluded) { s.excluded += l.supply; continue; }
    if (l.work_amount == null) { s.unset += l.supply; continue; }
    if (l.client === '기장') s.bookkeeping += l.work_amount; else s.team += l.work_amount;
    s.kjs += l.split_kjs || 0; s.jhg += l.split_jhg || 0;
    s.personal += personalOf(l);
  }
  return s;
}
