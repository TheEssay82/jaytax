// 미수금 나이 셈법. **이티머니 사건**이 난 자리라 상계를 특히 촘촘히 본다.
//   증상: 잔액이 0인데 "705일 경과"로 목록에 섰다.
//   원인: (−)전표가 별개 줄로 남아 (+)줄의 나이가 그대로 살아 있었다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settle, summarize, bucketOf, daysBetween, OVERDUE_DAYS, type AgingItem } from './aging';

const it_ = (date: string, amount: number, days: number, label = ''): AgingItem =>
  ({ date, amount, days, label });

// ── 상계 (settle) ───────────────────────────────────────

test('마이너스가 없으면 그대로 둔다 — 0원 줄만 걷어낸다', () => {
  const r = settle([it_('2026-01-01', 1000, 100), it_('2026-02-01', 0, 50)]);
    assert.equal(r.length, 1);
  assert.equal(r[0].amount, 1000);
});

test('이티머니 — 합계가 0이면 아무 줄도 남지 않는다', () => {
  const r = settle([
    it_('2024-09-01', 2_530_000, 705),     // 오래된 청구
    it_('2026-08-01', -2_530_000, 30),     // 수정발행으로 되돌림
  ]);
  assert.deepEqual(r, [], '잔액 0인데 줄이 남으면 705일 경과로 목록에 선다');
  assert.equal(summarize(r).overdue, 0);
});

test('오래된 것부터 갚는다 — 경고를 부풀리지 않는 방향', () => {
  const r = settle([
    it_('2024-01-01', 1000, 700),   // 가장 오래됨
    it_('2026-08-01', 1000, 30),
    it_('2026-08-02', -1000, 29),   // 1000 만큼 상계
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].days, 30, '오래된 700일짜리가 먼저 지워져야 한다');
  assert.equal(r[0].amount, 1000);
});

test('상계가 한 줄을 넘어가면 다음 줄로 이어진다', () => {
  const r = settle([
    it_('2024-01-01', 1000, 700),
    it_('2025-01-01', 1000, 400),
    it_('2026-08-01', 1000, 30),
    it_('2026-08-02', -1500, 29),
  ]);
  assert.equal(r.length, 2);
  assert.equal(r[0].days, 400);
  assert.equal(r[0].amount, 500, '첫 줄 1000 을 다 갚고 둘째 줄에서 500 을 깎는다');
  assert.equal(r[1].amount, 1000);
});

test('갚고도 남은 마이너스는 선수금으로 남긴다 — 감추지 않는다', () => {
  const r = settle([
    it_('2026-08-01', 1000, 30),
    it_('2026-08-02', -1500, 29),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].label, '선수금(마이너스 잔액)');
  assert.equal(r[0].amount, -500);
});

test('1원 미만 잔돈은 줄로 남기지 않는다', () => {
  const r = settle([it_('2026-08-01', 1000.4, 30), it_('2026-08-02', -1000, 29)]);
  assert.deepEqual(r, [], '0.4원짜리 줄이 남으면 화면에 0원으로 보이면서 나이만 선다');
});

test('마이너스만 있으면 전액이 선수금이다', () => {
  const r = settle([it_('2026-08-01', -700, 10)]);
  assert.equal(r.length, 1);
  assert.equal(r[0].amount, -700);
});

// ── 구간 (bucketOf) ─────────────────────────────────────

test('구간 경계 — 30·31·60·61·180·181', () => {
  assert.equal(bucketOf(0), 'b30');
  assert.equal(bucketOf(30), 'b30');
  assert.equal(bucketOf(31), 'b60');
  assert.equal(bucketOf(60), 'b60');
  assert.equal(bucketOf(61), 'b90');
  assert.equal(bucketOf(90), 'b90');
  assert.equal(bucketOf(91), 'b180');
  assert.equal(bucketOf(180), 'b180');
  assert.equal(bucketOf(181), 'over');
  assert.equal(bucketOf(99999), 'over');
});

test('연체 판정은 180일을 **넘어야** 한다 — 180일은 아직 아니다', () => {
  assert.equal(summarize([it_('x', 100, OVERDUE_DAYS)]).overdue, 0);
  assert.equal(summarize([it_('x', 100, OVERDUE_DAYS + 1)]).overdue, 100);
});

// ── 날수 (daysBetween) ──────────────────────────────────

test('날수는 발행일부터 기준일까지', () => {
  assert.equal(daysBetween('2026-08-01', '2026-08-31'), 30);
  assert.equal(daysBetween('2026-08-01', '2026-08-01'), 0);
});

test('기준일이 발행일보다 앞서면 0 — 나이가 음수일 수는 없다', () => {
  assert.equal(daysBetween('2026-09-01', '2026-08-01'), 0);
});

// ── 집계 ────────────────────────────────────────────────

test('구간별 합계와 총계가 맞는다', () => {
  const s = summarize([
    it_('a', 100, 10),    // b30
    it_('b', 200, 45),    // b60
    it_('c', 300, 200),   // over · 연체
  ]);
  assert.equal(s.total, 600);
  assert.equal(s.overdue, 300);
  assert.equal(s.buckets.b30, 100);
  assert.equal(s.buckets.b60, 200);
  assert.equal(s.buckets.over, 300);
  assert.equal(s.buckets.b90 + s.buckets.b180, 0);
});
