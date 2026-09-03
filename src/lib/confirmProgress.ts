// 조회서 **회수 진행률 셈법**만 모은 곳. supabase 를 물지 않는다(테스트가 돌아야 하므로).
//
// 감사 회수율은 감사보고서에 걸리는 숫자다. 화면·엑셀·요약이 **같은 함수**를 쓰게 해
// 어느 한 곳만 다른 값을 내는 일이 없게 한다.
import { todayYmd as localToday } from './format';

/** 집계에 필요한 최소한의 조회처 모양 — 이것만 갖추면 어떤 줄이든 받는다. */
export interface ProgressItem {
  /** 전자조회인가(아니면 우편) */
  isElectronic: boolean;
  /** 발송했는가 */
  sent: boolean;
  /** 발송일 'YYYY-MM-DD'. 발송했어도 날짜가 없을 수 있다. */
  sentDate: string | null;
  /** '회수완료' · '반송' · null(아직) */
  collectStatus: string | null;
}

export interface Progress {
  total: number; sent: number; collected: number; returned: number;
  elecTotal: number; elecSent: number; elecCollected: number;
  postTotal: number; postSent: number; postCollected: number;
  /** 발송일 범위 — 최초/최종 */
  firstSentDate: string | null;
  lastSentDate: string | null;
}

export const emptyProgress = (): Progress => ({
  total: 0, sent: 0, collected: 0, returned: 0,
  elecTotal: 0, elecSent: 0, elecCollected: 0,
  postTotal: 0, postSent: 0, postCollected: 0,
  firstSentDate: null, lastSentDate: null,
});

/**
 * 조회처 목록 → 집계.
 *
 * **반송은 회수가 아니다.** 회수완료와 반송을 따로 세는 것이 핵심이다 —
 * 반송을 회수로 세면 회수율이 부풀고, 그 숫자가 감사보고서로 간다.
 */
export function summarize(items: ProgressItem[]): Progress {
  const p = emptyProgress();
  for (const it of items) {
    p.total++;
    if (it.isElectronic) p.elecTotal++; else p.postTotal++;
    if (it.sent) {
      p.sent++;
      if (it.isElectronic) p.elecSent++; else p.postSent++;
      if (it.sentDate) {
        if (!p.firstSentDate || it.sentDate < p.firstSentDate) p.firstSentDate = it.sentDate;
        if (!p.lastSentDate || it.sentDate > p.lastSentDate) p.lastSentDate = it.sentDate;
      }
    }
    if (it.collectStatus === '회수완료') {
      p.collected++;
      if (it.isElectronic) p.elecCollected++; else p.postCollected++;
    } else if (it.collectStatus === '반송') {
      p.returned++;
    }
  }
  return p;
}

/** 비율(%) — 분모 0이면 0. 소수 첫째 자리까지. */
export const pct = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

/** 여러 집계를 합산(연도 전체 합계용) */
export function sumProgress(list: Progress[]): Progress {
  const t = emptyProgress();
  for (const p of list) {
    t.total += p.total; t.sent += p.sent; t.collected += p.collected; t.returned += p.returned;
    t.elecTotal += p.elecTotal; t.elecSent += p.elecSent; t.elecCollected += p.elecCollected;
    t.postTotal += p.postTotal; t.postSent += p.postSent; t.postCollected += p.postCollected;
    if (p.firstSentDate && (!t.firstSentDate || p.firstSentDate < t.firstSentDate)) t.firstSentDate = p.firstSentDate;
    if (p.lastSentDate && (!t.lastSentDate || p.lastSentDate > t.lastSentDate)) t.lastSentDate = p.lastSentDate;
  }
  return t;
}

/** 'YYYY-MM-DD' → 일(day) 단위 정수. 시간대 영향을 받지 않도록 UTC 자정 기준으로 센다. */
const toDayNumber = (ymd: string): number => Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);

/** 발송일로부터 오늘까지 지난 날수. 발송일이 없으면 null. */
export function daysSince(ymd: string | null, todayYmd?: string): number | null {
  if (!ymd) return null;
  const today = todayYmd ?? localToday();
  return toDayNumber(today) - toDayNumber(ymd);
}

/** 독촉 임계일 선택지 — 전자조회는 며칠, 우편은 2주 남짓 걸리는 것이 보통이라 14일을 기본으로 둔다. */
export const OVERDUE_THRESHOLDS = [7, 14, 21, 30] as const;
export const DEFAULT_OVERDUE_DAYS = 14;

/**
 * 독촉 대상 = 발송했는데 **아직 회수도 반송도 아닌** 건 중 임계일이 지난 것.
 * 반송은 이미 '조치 필요'로 따로 다루므로 여기서 제외한다.
 * 오래 밀린 것부터 위로 올린다.
 */
export interface OverdueRow<C, I> {
  conf: C;
  item: I;
  /** 발송 후 경과일 */
  days: number;
}

export function findOverdue<C extends { id: string; companyName: string }, I extends ProgressItem>(
  rows: C[],
  itemsByConf: Record<string, I[]>,
  thresholdDays: number,
  todayYmd?: string,
): OverdueRow<C, I>[] {
  const out: OverdueRow<C, I>[] = [];
  for (const conf of rows) {
    for (const item of itemsByConf[conf.id] ?? []) {
      if (!item.sent || item.collectStatus !== null) continue;
      const days = daysSince(item.sentDate, todayYmd);
      if (days === null || days < thresholdDays) continue;
      out.push({ conf, item, days });
    }
  }
  return out.sort((a, b) => b.days - a.days || a.conf.companyName.localeCompare(b.conf.companyName, 'ko'));
}

/** 발송했지만 아직 미회수인 건(임계일 무관) — 요약 숫자용 */
export function countPending<C extends { id: string }, I extends ProgressItem>(
  rows: C[], itemsByConf: Record<string, I[]>,
): number {
  let n = 0;
  for (const conf of rows) {
    for (const item of itemsByConf[conf.id] ?? []) {
      if (item.sent && item.collectStatus === null) n++;
    }
  }
  return n;
}
