// Google 캘린더 읽기 — 캘린더 설정의 「iCal 형식의 비공개 주소」(읽기 전용)로 받는다.
// env GCAL_ICS_INDUK(「인덕업무」), GCAL_ICS_PRIMARY(기본 캘린더). 주소 자체가 비밀이라 기록·답에 남기지 않는다.
// 참석자·설명은 돌려주지 않는다(제목·시간·장소만).
import ICAL from 'ical.js';

export const CALENDARS = [
  { key: 'induk', label: '인덕업무', env: 'GCAL_ICS_INDUK' },
  { key: 'primary', label: '기본', env: 'GCAL_ICS_PRIMARY' },
] as const;

export const gcalEnabled = () => CALENDARS.some((c) => (process.env[c.env] ?? '').trim());

export interface CalEvent { calendar: string; title: string; start: string; end: string; allDay: boolean; location?: string }

const KST_MS = 9 * 3600 * 1000;
/** Date → 한국 시각 'YYYY-MM-DD HH:mm'. */
export const kst = (d: Date) => new Date(d.getTime() + KST_MS).toISOString().slice(0, 16).replace('T', ' ');
/** 'YYYY-MM-DD'(한국 날짜) 0시의 실제 시각. */
const kstMidnight = (ymd: string) => new Date(`${ymd}T00:00:00+09:00`);
const dayAfter = (ymd: string) => new Date(kstMidnight(ymd).getTime() + 86400000);

function fmt(t: ICAL.Time): { s: string; ms: number } {
  if (t.isDate) {
    const s = `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
    return { s, ms: kstMidnight(s).getTime() };
  }
  const d = t.toJSDate();
  return { s: kst(d), ms: d.getTime() };
}

/** ICS 글에서 [from, to](한국 날짜, 양끝 포함) 안의 일정을 펼친다(반복 일정·예외 포함). */
export function eventsFromIcs(ics: string, label: string, from: string, to: string): CalEvent[] {
  const root = new ICAL.Component(ICAL.parse(ics));
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);
  const lo = kstMidnight(from).getTime();
  const hi = dayAfter(to).getTime();

  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Component[] = [];
  for (const v of root.getAllSubcomponents('vevent')) {
    if (v.hasProperty('recurrence-id')) exceptions.push(v);
    else masters.set(String(v.getFirstPropertyValue('uid') ?? Math.random()), new ICAL.Event(v));
  }
  for (const x of exceptions) {
    const m = masters.get(String(x.getFirstPropertyValue('uid')));
    if (m) m.relateException(x);
    else masters.set(`x:${Math.random()}`, new ICAL.Event(x)); // 짝 없는 예외는 한 번짜리로
  }

  const out: CalEvent[] = [];
  const push = (e: ICAL.Event, start: ICAL.Time, end: ICAL.Time) => {
    if (String(e.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') return;
    const a = fmt(start), b = fmt(end ?? start);
    const endMs = b.ms > a.ms ? b.ms : a.ms + 1;
    if (endMs <= lo || a.ms >= hi) return;
    const allDay = start.isDate;
    // 종일 일정의 끝은 다음 날 0시라 하루 당겨 보여 준다
    const endS = allDay && b.ms > a.ms ? new Date(b.ms - 86400000 + KST_MS).toISOString().slice(0, 10) : b.s;
    out.push({ calendar: label, title: e.summary || '(제목 없음)', start: a.s, end: endS, allDay, ...(e.location ? { location: e.location } : {}) });
  };

  for (const e of masters.values()) {
    if (!e.isRecurring()) { push(e, e.startDate, e.endDate); continue; }
    const it = e.iterator();
    for (let i = 0, t = it.next(); t && i < 5000; i++, t = it.next()) {
      const d = e.getOccurrenceDetails(t);
      if (d.startDate.toJSDate().getTime() >= hi) break;
      push(d.item, d.startDate, d.endDate);
    }
  }
  return out.sort((x, y) => x.start.localeCompare(y.start));
}

const cache = new Map<string, { text: string; at: number }>();

async function fetchIcs(url: string): Promise<string> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.text;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`캘린더 응답 ${res.status}`);
  const text = await res.text();
  cache.set(url, { text, at: Date.now() });
  return text;
}

/** 두 캘린더를 함께 본다. 한쪽이 실패해도 다른 쪽은 돌려주고 실패한 이름을 알린다. */
export async function listEvents(from: string, to: string, q?: string): Promise<{ events: CalEvent[]; failed: string[]; notSet: string[] }> {
  const events: CalEvent[] = [];
  const failed: string[] = [];
  const notSet: string[] = [];
  await Promise.all(CALENDARS.map(async (c) => {
    const url = (process.env[c.env] ?? '').trim();
    if (!url) { notSet.push(c.label); return; }
    try { events.push(...eventsFromIcs(await fetchIcs(url), c.label, from, to)); }
    catch (e) { console.warn('gcal failed', c.key, e instanceof Error ? e.message : e); failed.push(c.label); }
  }));
  const words = (q ?? '').split(/[\s,]+/).map((w) => w.trim()).filter(Boolean);
  const hit = words.length ? events.filter((e) => words.some((w) => e.title.includes(w))) : events;
  return { events: hit.sort((x, y) => x.start.localeCompare(y.start)), failed, notSet };
}
