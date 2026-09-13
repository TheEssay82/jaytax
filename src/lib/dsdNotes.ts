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
 * 주석 줄을 구별할 코드 — **제목에서 만든다.**
 *
 * 전에는 사무소 표준 틀과 대조해 `CASH` 같은 코드를 주고, 없으면 `X_` 를 붙였다. 그런데
 * **회사마다 주석 양식이 다르므로 「표준」이 성립하지 않는다**(사용자 지적 2026-09-13).
 * `X_` 는 「내가 가진 목록에 없다」는 뜻일 뿐이라 보는 사람에게 아무 뜻이 없었다.
 *
 * 코드가 하는 일은 **한 작업 건 안에서 줄을 구별하는 것**뿐이다 — ②③④ 는 주석을 **제목**으로
 * 찾는다(notePick). 그래서 제목을 그대로 쓴다.
 */
export function suggestCode(title: string, _basis?: Basis): string {
  const slug = (title ?? '').replace(/[^0-9A-Za-z가-힣]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return slug || 'NOTE';
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
