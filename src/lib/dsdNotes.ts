// 주석 목록을 다루는 규칙 **한 곳**. supabase 를 부르지 않는 순수 모듈이라 테스트가 붙는다.
//
// 이 파일이 지키려는 것 하나: **주석 번호를 열쇠로 쓰지 않는다.**
// 주석은 해마다 늘고 줄어서 하나가 빠지면 뒤가 통째로 밀린다 — 올해 17번(무형자산)이
// 내년엔 16번이 된다. 그래서 「엑셀 칸 ↔ DSD 칸」 대응표를 번호에 매달면 해가 바뀔 때마다
// 처음부터 다시 붙여야 한다. 안 바뀌는 코드(INTANGIBLE)를 따로 두는 이유다.

export type Basis = 'K-IFRS' | '일반기업회계기준';
export type NoteSource = '감사인' | '회사';
export type NoteStatus = '미할당' | '작업중' | '작업완료' | '작성제외';

/**
 * 새로 만드는 주석의 기본 상태.
 *
 * **「미할당」이 아니라 「작업중」이다.** 작년 감사보고서에서 가져오면 대부분의 주석이
 * 올해도 그대로 쓰이므로, 목록에 올라온 순간 이미 할 일이 정해진 셈이다.
 * 「미할당」은 담당을 아직 못 정한 예외를 표시할 때만 쓴다.
 */
export const DEFAULT_STATUS: NoteStatus = '작업중';

export interface NoteRow {
  code: string;
  no: number | null;
  title: string;
  sheet?: string | null;
  enabled: boolean;
  source: NoteSource;
  assignee?: string | null;
  status: NoteStatus;
  memo?: string | null;
  sortOrder: number;
}

/**
 * 사무소 표준 주석 틀 — **실제 감사보고서에서 뽑았다.**
 *
 * 일반기업회계기준 틀은 명진산업개발 FY25(비상장·중소기업), K-IFRS 틀은 ㈜넵튠 FY25(상장)에서
 * 그대로 가져왔다. 새 거래처는 여기서 복제해 시작하고, 회사 사정에 맞춰 켜고 끄면 된다.
 * 회사가 늘수록 이 틀이 좋아져 첫 해 준비가 계속 싸진다.
 */
const KGAAP: readonly (readonly [string, string])[] = [
  ['COMPANY', '회사의 개요'],
  ['ACCT_POLICY', '중요한 회계처리방침'],
  ['ACCT_POLICY_SIG', '유의적인 회계정책'],
  ['RESTRICTED_DEPOSIT', '사용이 제한된 예금 등'],
  ['INVENTORY', '재고자산'],
  ['PPE', '유형자산'],
  ['BORROWING', '차입금'],
  ['RETIREMENT', '퇴직급여충당부채'],
  ['EQUITY', '자본'],
  ['RETAINED_APPROP', '이익잉여금처분계산서'],
  ['INCOME_TAX', '법인세비용'],
  ['RELATED_PARTY', '특수관계자 공시'],
  ['PLEDGED', '담보제공자산 등'],
  ['LIQUIDITY_RISK', '금융부채의 유동성 위험관리 방법 및 종류별 만기 분석'],
  ['VALUE_ADDED', '부가가치계산에 필요한 사항'],
  ['NONCASH', '현금 유ㆍ출입이 없는 중요한 거래'],
  ['COMPREHENSIVE_IS', '포괄손익계산서'],
  ['FS_APPROVAL', '재무제표의 확정일'],
];

const KIFRS: readonly (readonly [string, string])[] = [
  ['GENERAL', '일반사항'],
  ['ACCT_POLICY', '중요한 회계정책'],
  ['JUDGEMENT', '중요한 판단과 추정불확실성의 주요 원천'],
  ['FIN_RISK', '재무위험관리'],
  ['FAIR_VALUE', '공정가치'],
  ['SEGMENT', '영업부문정보'],
  ['FI_CATEGORY', '범주별 금융상품'],
  ['TRADE_RECEIVABLE', '매출채권및기타채권'],
  ['FVPL', '당기손익-공정가치측정금융자산'],
  ['FVOCI', '기타포괄손익-공정가치측정금융자산'],
  ['AMORTIZED_COST', '상각후원가측정금융자산및기타금융자산'],
  ['DERIVATIVE', '파생상품'],
  ['OTHER_CURRENT', '기타유동자산'],
  ['SUBSIDIARY', '종속기업투자주식'],
  ['ASSOCIATE', '관계기업및공동기업투자주식'],
  ['PPE', '유형자산'],
  ['INTANGIBLE', '무형자산'],
  ['LEASE', '리스'],
  ['OTHER_LIABILITY', '기타부채'],
  ['OTHER_FIN_LIABILITY', '기타금융부채'],
  ['BORROWING', '차입금'],
  ['RESTORATION', '복구충당부채'],
  ['RETIREMENT', '퇴직급여제도'],
  ['INCOME_TAX', '법인세비용및이연법인세'],
  ['CAPITAL_STOCK', '자본금및주식발행초과금'],
  ['CAPITAL_SURPLUS', '자본잉여금'],
  ['OTHER_EQUITY', '기타자본구성요소'],
  ['RETAINED', '이익잉여금'],
  ['AOCI', '기타포괄손익누계액'],
  ['REVENUE', '고객과의 계약에서 생기는 수익'],
  ['OPEX', '영업비용'],
  ['FIN_INCOME', '금융수익및금융비용'],
  ['OTHER_INCOME', '기타수익및기타비용'],
  ['EPS', '주당이익(손실)'],
  ['SHARE_BASED', '주식기준보상'],
  ['CASH_FLOW', '현금흐름표'],
  ['CONTINGENCY', '우발상황및약정사항'],
  ['RELATED_PARTY', '특수관계자거래'],
  ['BUSINESS_COMB', '사업결합'],
  ['SUBSEQUENT', '보고기간후사건'],
  ['FS_APPROVAL', '재무제표승인'],
];

/** 회사가 직접 쓰는 주석 — 엑셀이 원천이 아니라 대조 대상에서 뺀다. */
const COMPANY_WRITTEN = new Set(['RELATED_PARTY', 'BUSINESS_COMB', 'SUBSEQUENT', 'FS_APPROVAL']);

/** 표준 틀을 그대로 옮긴 주석 목록. 번호는 1부터 차례로 매긴다. */
export function template(basis: Basis): NoteRow[] {
  const src = basis === 'K-IFRS' ? KIFRS : KGAAP;
  return src.map(([code, title], i) => ({
    code,
    no: i + 1,
    title,
    sheet: `N${String(i + 1).padStart(2, '0')}`,
    enabled: true,
    source: COMPANY_WRITTEN.has(code) ? '회사' : '감사인',
    assignee: null,
    status: DEFAULT_STATUS,
    memo: null,
    sortOrder: (i + 1) * 10,
  }));
}

/** 그 틀에 몇 개가 들어 있나 — 화면에서 고르기 전에 보여 준다. */
export function templateSize(basis: Basis): number {
  return (basis === 'K-IFRS' ? KIFRS : KGAAP).length;
}

/**
 * 제목에서 코드를 짐작한다. 표준 틀에 같은 제목이 있으면 그 코드를,
 * 없으면 제목을 영문 코드로 만들 수 없으니 **번호 없는 임시 코드**를 준다.
 * 임시 코드는 사람이 고칠 수 있게 화면에 그대로 내놓는다.
 */
export function suggestCode(title: string, basis: Basis): string {
  const norm = (s: string) => s.replace(/[\s·ㆍ()[\]{}.,'"-]/g, '').toLowerCase();
  const t = norm(title);
  for (const [code, name] of basis === 'K-IFRS' ? KIFRS : KGAAP) {
    if (norm(name) === t) return code;
  }
  for (const [code, name] of [...KIFRS, ...KGAAP]) {
    if (norm(name) === t) return code;
  }
  const slug = title.replace(/[^0-9A-Za-z가-힣]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  return slug ? `X_${slug}` : 'X_NOTE';
}

/**
 * 켜진 주석에만 1번부터 다시 번호를 매긴다. 꺼진 것은 번호를 비운다.
 *
 * 주석 하나를 끄면 뒤가 한 칸씩 당겨지는 것이 정상이다 — 그래서 번호를 열쇠로 못 쓴다.
 */
export function renumber(rows: NoteRow[]): NoteRow[] {
  let n = 0;
  return [...rows]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => {
      if (!r.enabled) return { ...r, no: null };
      n += 1;
      return { ...r, no: n };
    });
}

/**
 * 다음 해로 넘기기 — **코드·제목·시트·작성주체·담당은 가져가고 진행상태만 되돌린다.**
 *
 * 되돌린 상태는 「미할당」이 아니라 **「작업중」**이다(DEFAULT_STATUS 참고) — 작년에 쓰던
 * 주석은 올해도 대개 그대로 쓰이므로, 넘어온 순간 이미 할 일이 정해져 있다.
 * 담당자는 남긴다(대개 그대로이고, 바뀌면 화면에서 고치는 편이 빠르다).
 */
export function cloneForNextYear(rows: NoteRow[]): NoteRow[] {
  return renumber(rows.map((r) => ({
    ...r,
    status: DEFAULT_STATUS,
    memo: null,
  })));
}

/**
 * 지금 준비하는 감사의 **대상 연도**.
 *
 * 12월 결산 감사는 이듬해 1~3월에 수행한다. 그래서 상반기에는 **직전 결산**(작년)을 다루고 있고,
 * 하반기에는 **올해 결산**을 준비한다. 2026년 9월이면 다음 대상은 2026년 12월 결산이다.
 */
export function defaultAuditFy(today: Date = new Date()): number {
  return today.getMonth() + 1 <= 6 ? today.getFullYear() - 1 : today.getFullYear();
}

/** 결산연도에서 기본 회계기간 — 1월 1일부터 12월 31일까지. 12월 결산이 아니면 화면에서 고친다. */
export function defaultPeriod(fy: number): { from: string; to: string } {
  return { from: `${fy}-01-01`, to: `${fy}-12-31` };
}

/** 「제18기」. 기수를 모르면 빈 문자열. */
export function termLabel(termNo: number | null | undefined): string {
  return termNo && termNo > 0 ? `제${termNo}기` : '';
}

/** 진행 상황 한 줄 — 켜진 주석 기준. */
export function progress(rows: NoteRow[]): { done: number; total: number; pct: number } {
  const on = rows.filter((r) => r.enabled);
  const done = on.filter((r) => r.status === '작업완료').length;
  return { done, total: on.length, pct: on.length ? Math.round((done / on.length) * 100) : 0 };
}
