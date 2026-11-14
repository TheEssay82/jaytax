// 기말감사일정 — 달력·휴일·점검·색 계산(화면과 따로 시험할 수 있게 순수 함수로). 사용자 2026-11-15.
//
// 사용자 원칙(2026-11-04 엑셀 「기말일정검토」 대화):
//   배정(미확정)=노랑 · 확정=녹색 · 같은 날 필드가 팀 수보다 많으면 분홍(가장 먼저 보임).
//   날짜 머리칸도 그날 일정 색 — 하나라도 미확정이면 노랑, 모두 확정이면 녹색(오른쪽으로 넘겨도 보이게).
//   외감·상장은 3/23 이전 현장 종료 · PEF·SPC 는 주말 · 기말 착수는 1/25 · 설 전날·다음날은 감사 곤란.
//   재고실사는 다른 사람이 나가는 것으로 보고 하루 필드 건수(겹침)에서 뺀다.

export const SCHEDULE_KINDS = ['상장', '외감', '임의', 'PEF', 'SPC', '용역'] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];
export const SCHEDULE_TASKS = ['개별감사', '별도감사', '연결감사', '내부회계', '기말감사', '중간감사', '중간&재고', '재고실사', '용역'] as const;

export interface ScheduleItem {
  id: string;
  entityId: string | null;
  company: string;
  kind: ScheduleKind;
  task: string;
  daysNeeded: number;
  daysUncertain: boolean;
  confirmed: boolean;
  sort: number;
  note: string | null;
  /** 배정한 날(YYYY-MM-DD) → 칸 글(재고실사 담당 이니셜 등) */
  days: Map<string, string>;
}

export interface ScheduleSetting {
  teams: number;
  startDay: string;      // 기말 필드 착수 가능일
  deadline: string;      // 외감·상장 현장 종료 한도
  deadlineOther: string; // 임의·PEF·SPC 한도
}

/** 공휴일 — 이름. 연도별로 적는다(없는 해는 주말만). 출처: 우주항공청 2027 월력요항. */
const HOLIDAYS: Record<string, string> = {
  '2027-01-01': '신정',
  '2027-02-06': '설 연휴', '2027-02-07': '설날', '2027-02-08': '설 연휴', '2027-02-09': '대체공휴일',
  '2027-03-01': '삼일절',
  '2028-01-01': '신정',
  '2028-01-25': '설 연휴', '2028-01-26': '설날', '2028-01-27': '설 연휴',
  '2028-03-01': '삼일절',
};
/** 평일이지만 감사하기 어려운 날 — 설 전날·다음날(사용자). */
const HARD_DAYS: Record<string, string> = {
  '2027-02-05': '설 연휴 전날', '2027-02-10': '설 연휴 다음날',
  '2028-01-24': '설 연휴 전날', '2028-01-28': '설 연휴 다음날',
};

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

export interface CalDay {
  date: string;
  month: number;      // 1~12
  day: number;
  wd: number;         // 0=일
  weekend: boolean;
  holiday: string | null;
  hard: string | null;  // 설 전날·다음날
}

/** 감사 대상 연도 fy → 다음 해 1/1 ~ 3/31. */
export function calendarDays(fy: number): CalDay[] {
  const out: CalDay[] = [];
  for (let d = parse(`${fy + 1}-01-01`); d <= parse(`${fy + 1}-03-31`); d = new Date(d.getTime() + 86400000)) {
    const date = ymd(d), wd = d.getUTCDay();
    out.push({ date, month: d.getUTCMonth() + 1, day: d.getUTCDate(), wd, weekend: wd === 0 || wd === 6, holiday: HOLIDAYS[date] ?? null, hard: HARD_DAYS[date] ?? null });
  }
  return out;
}

/** 근무일 — 주말·공휴일·설 전후일이 아닌 날. */
export const isWorkday = (c: CalDay) => !c.weekend && !c.holiday && !c.hard;
const isInventory = (task: string) => /재고/.test(task) && !/중간&재고/.test(task);
const isFund = (k: ScheduleKind) => k === 'PEF' || k === 'SPC';
const isStatutory = (k: ScheduleKind) => k === '상장' || k === '외감';

export interface DayStat {
  /** 그날 필드 건수(재고실사 제외) */ field: number;
  inventory: number;
  fund: number;
  any: boolean;
  allConfirmed: boolean;
  over: boolean;     // 필드 건수 > 팀 수
}

export function dayStats(items: ScheduleItem[], teams: number): Map<string, DayStat> {
  const m = new Map<string, DayStat>();
  for (const it of items) for (const d of it.days.keys()) {
    const s = m.get(d) ?? { field: 0, inventory: 0, fund: 0, any: false, allConfirmed: true, over: false };
    if (isInventory(it.task)) s.inventory++; else s.field++;
    if (isFund(it.kind)) s.fund++;
    s.any = true;
    if (!it.confirmed) s.allConfirmed = false;
    m.set(d, s);
  }
  for (const s of m.values()) s.over = s.field > teams;
  return m;
}

export type CellTone = 'none' | 'assigned' | 'confirmed' | 'overlap';
/** 칸 색 — 겹침(분홍)이 노랑·녹색보다 먼저. 재고실사 칸은 겹침 판정에 들지 않는다. */
export function cellTone(it: ScheduleItem, date: string, stats: Map<string, DayStat>): CellTone {
  if (!it.days.has(date)) return 'none';
  if (!isInventory(it.task) && stats.get(date)?.over) return 'overlap';
  return it.confirmed ? 'confirmed' : 'assigned';
}
/** 날짜 머리칸 색. */
export function headTone(date: string, stats: Map<string, DayStat>): CellTone {
  const s = stats.get(date);
  if (!s?.any) return 'none';
  if (s.over) return 'overlap';
  return s.allConfirmed ? 'confirmed' : 'assigned';
}

/** 현장 n일차 — 그 줄에서 몇 번째 날인가(칸에 숫자로). */
export function dayOrdinal(it: ScheduleItem, date: string): number {
  let n = 0;
  for (const d of [...it.days.keys()].sort()) { n++; if (d === date) return n; }
  return 0;
}

export interface ItemCheck { ok: boolean; issues: string[]; first: string | null; last: string | null; assigned: number }

/** 줄 점검 — 일수 · 기한 · PEF 평일 · 휴일·설 전후일 배정. */
export function checkItem(it: ScheduleItem, s: ScheduleSetting): ItemCheck {
  const days = [...it.days.keys()].sort();
  const issues: string[] = [];
  const assigned = days.length;
  if (!assigned) issues.push('미배정');
  else if (!it.daysUncertain && assigned < it.daysNeeded) issues.push(`${it.daysNeeded - assigned}일 부족`);
  else if (!it.daysUncertain && assigned > it.daysNeeded) issues.push(`${assigned - it.daysNeeded}일 초과`);
  const last = days[days.length - 1] ?? null;
  const limit = isStatutory(it.kind) ? s.deadline : s.deadlineOther;
  if (last && last > limit && !isInventory(it.task)) issues.push('기한초과');
  for (const d of days) {
    const c = parse(d), wd = c.getUTCDay();
    const weekend = wd === 0 || wd === 6;
    if (isFund(it.kind) && !weekend) { issues.push('평일배정'); break; }
  }
  // 재고실사는 연말·휴일에도 나간다(평안정공 1/1) — 휴일 점검에서 뺀다.
  for (const d of isInventory(it.task) ? [] : days) {
    if (HOLIDAYS[d] && !isFund(it.kind)) { issues.push(`${HOLIDAYS[d]} 배정`); break; }
    if (HARD_DAYS[d]) { issues.push(`${HARD_DAYS[d]} 배정`); break; }
  }
  return { ok: !issues.length, issues, first: days[0] ?? null, last, assigned };
}

/** 요약 — 외감·상장 기말 필요일 · 착수일~한도 가용 근무일 × 팀 · 여유. 재고실사·중간은 빼고 센다. */
export function capacity(items: ScheduleItem[], s: ScheduleSetting, fy: number) {
  const need = items.filter((it) => isStatutory(it.kind) && !isInventory(it.task) && !/중간/.test(it.task)).reduce((a, it) => a + it.daysNeeded, 0);
  const avail = calendarDays(fy).filter((c) => isWorkday(c) && c.date >= s.startDay && c.date <= s.deadline).length * s.teams;
  return { need, avail, spare: avail - need };
}

/** 그날 무엇이 있는지 — 머리칸 툴팁. */
export function dayTitle(c: CalDay, items: ScheduleItem[]): string {
  const head = `${c.month}/${c.day}(${WEEKDAYS[c.wd]})${c.holiday ? ` ${c.holiday}` : ''}${c.hard ? ` ${c.hard}` : ''}`;
  const who = items.filter((it) => it.days.has(c.date)).map((it) => `${it.confirmed ? '✓' : '·'} ${it.company} ${it.task}`);
  return [head, ...who].join('\n');
}
