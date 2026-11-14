// 기말감사일정 — 달력 · 점검 · 색(사용자 2026-11-15 원칙).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarDays, capacity, cellTone, checkItem, dayOrdinal, dayStats, defaultStaff, fsDueDate, headTone, parseMark, personDays, sortItems, type ScheduleItem } from './auditSchedule';

const S = { teams: 1, startDay: '2027-01-25', deadline: '2027-03-22', deadlineOther: '2027-03-31', closed: false };
let n = 0;
const it = (p: Partial<ScheduleItem> & { days?: string[] }): ScheduleItem => ({
  id: String(++n), entityId: null, company: 'A', kind: '외감', task: '개별감사', daysNeeded: 1, daysUncertain: false, confirmed: false, sort: 0, note: null, staff: [],
  ...p, days: new Map((p.days ?? []).map((d) => [d, ''])),
});

test('달력 — FY2026 → 2027-01-01~03-31, 설 2/6~9 공휴일, 2/5·2/10 곤란', () => {
  const c = calendarDays(2026);
  assert.equal(c.length, 90);
  assert.equal(c[0].date, '2027-01-01'); assert.equal(c[0].wd, 5);
  assert.equal(c.at(-1)!.date, '2027-03-31');
  assert.equal(c.find((x) => x.date === '2027-02-09')!.holiday, '대체공휴일');
  assert.equal(c.find((x) => x.date === '2027-02-10')!.hard, '설 연휴 다음날');
});

test('점검 — 일수 부족 · 외감 기한초과 · PEF 평일 · 설 전날', () => {
  assert.deepEqual(checkItem(it({ daysNeeded: 2, days: ['2027-03-02'] }), S).issues, ['1일 부족']);
  assert.ok(checkItem(it({ days: ['2027-03-23'] }), S).issues.includes('기한초과'));
  assert.ok(checkItem(it({ kind: '임의', days: ['2027-03-23'] }), S).ok);
  assert.ok(checkItem(it({ kind: 'PEF', days: ['2027-02-15'] }), S).issues.includes('평일배정'));
  assert.ok(checkItem(it({ kind: 'PEF', days: ['2027-02-13'] }), S).ok);
  assert.ok(checkItem(it({ days: ['2027-02-05'] }), S).issues[0].includes('설 연휴 전날'));
  assert.ok(checkItem(it({ daysNeeded: 2, daysUncertain: true, days: ['2027-03-02'] }), S).ok);
});

test('색 — 겹침 분홍이 먼저, 재고실사는 겹침에서 빠짐, 머리칸은 모두 확정일 때만 녹색', () => {
  const a = it({ days: ['2027-02-17'], confirmed: true });
  const b = it({ days: ['2027-02-17'] });
  const inv = it({ task: '재고실사', days: ['2027-02-18'] });
  const c = it({ days: ['2027-02-18'], confirmed: true });
  const st = dayStats([a, b, inv, c], 1);
  assert.equal(cellTone(a, '2027-02-17', st), 'overlap');
  assert.equal(headTone('2027-02-17', st), 'overlap');
  assert.equal(cellTone(c, '2027-02-18', st), 'confirmed');
  assert.equal(headTone('2027-02-18', st), 'assigned');   // 재고실사가 미확정
  assert.equal(cellTone(b, '2027-02-18', st), 'none');
  assert.equal(dayStats([a, b], 2).get('2027-02-17')!.over, false);
});

test('n일차 · 여유일', () => {
  const x = it({ days: ['2027-03-12', '2027-03-15'] });
  assert.equal(dayOrdinal(x, '2027-03-15'), 2);
  const cap = capacity([it({ daysNeeded: 3 }), it({ task: '재고실사', daysNeeded: 1 }), it({ kind: '임의', daysNeeded: 2 })], S, 2026);
  assert.equal(cap.need, 3);
  assert.equal(cap.avail, 36);   // 1/25~3/22 평일 41 − 설 2/8·2/9 − 2/5·2/10 − 3/1 (엑셀 대화와 같은 36일)
});

test('사람 — 칸 글 「조정김」·「정&김」, 기본 인원(윤영미 동행 거래처), 같은 날 두 곳이면 2', () => {
  assert.deepEqual(parseMark('조정김'), ['조', '정', '김']);
  assert.deepEqual(parseMark('정&김'), ['정', '김']);
  assert.deepEqual(defaultStaff('㈜휴식', '기말감사'), ['조', '김', '정', '윤']);
  assert.deepEqual(defaultStaff('㈜백련', '개별감사'), ['조', '김', '정']);
  assert.deepEqual(defaultStaff('㈜휴식', '재고실사'), []);
  const a = it({ staff: ['조', '김'], days: ['2027-01-06'] });
  const inv: ScheduleItem = { ...it({ task: '재고실사' }), days: new Map([['2027-01-06', '김']]) };
  const pd = personDays([a, inv]);
  assert.equal(pd.get('김')!.get('2027-01-06'), 2);
  assert.equal(pd.get('조')!.get('2027-01-06'), 1);
});

test('정렬 — 가나다(㈜ 떼고, 회사 안은 넣은 차례) · 첫 일정순', () => {
  const xs = [it({ company: '㈜휴식', sort: 1, days: ['2027-03-10'] }), it({ company: '㈜대양이티에스', sort: 3, task: '개별감사', days: ['2027-01-13'] }), it({ company: '㈜대양이티에스', sort: 2, task: '중간&재고' }), it({ company: '백련', sort: 4, days: ['2027-03-19'] })];
  assert.deepEqual(sortItems(xs, '가나다').map((x) => x.company + x.sort), ['㈜대양이티에스2', '㈜대양이티에스3', '백련4', '㈜휴식1']);
  assert.deepEqual(sortItems(xs, '일정').map((x) => x.company), ['㈜대양이티에스', '㈜대양이티에스', '㈜휴식', '백련']);
});

test('상장사 제시재무제표 — 주총 6주 전', () => {
  assert.equal(fsDueDate('2027-03-31'), '2027-02-17');
});
