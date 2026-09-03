// 조회서 회수율 셈법. **감사보고서에 실리는 숫자**라 경계를 촘촘히 본다.
//
// 가장 무서운 실수는 **반송을 회수로 세는 것**이다. 회수율이 부풀고, 그 상태로
// 감사 절차가 끝났다고 판단하게 된다. 그래서 첫 테스트가 그것이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarize, pct, sumProgress, emptyProgress, daysSince, findOverdue, countPending,
  type ProgressItem,
} from './confirmProgress';

const it_ = (p: Partial<ProgressItem> = {}): ProgressItem =>
  ({ isElectronic: false, sent: false, sentDate: null, collectStatus: null, ...p });

const conf = (id: string, companyName: string) => ({ id, companyName });

// ── 반송은 회수가 아니다 ────────────────────────────────

test('반송을 회수로 세지 않는다 — 세면 회수율이 부풀어 감사보고서로 간다', () => {
  const p = summarize([
    it_({ sent: true, sentDate: '2026-08-01', collectStatus: '회수완료' }),
    it_({ sent: true, sentDate: '2026-08-01', collectStatus: '반송' }),
  ]);
  assert.equal(p.collected, 1);
  assert.equal(p.returned, 1);
  assert.equal(pct(p.collected, p.total), 50, '반송을 회수로 세면 100% 가 된다');
});

// ── 전자 / 우편을 나눠 센다 ─────────────────────────────

test('전자와 우편을 각각 센다 — 합이 전체와 맞는다', () => {
  const p = summarize([
    it_({ isElectronic: true, sent: true, collectStatus: '회수완료' }),
    it_({ isElectronic: true, sent: true }),
    it_({ isElectronic: false, sent: true, collectStatus: '회수완료' }),
    it_({ isElectronic: false }),
  ]);
  assert.equal(p.total, 4);
  assert.equal(p.elecTotal + p.postTotal, p.total);
  assert.equal(p.elecSent + p.postSent, p.sent);
  assert.equal(p.elecCollected + p.postCollected, p.collected);
  assert.equal(p.elecTotal, 2);
  assert.equal(p.postCollected, 1);
});

test('발송하지 않은 건은 sent 에 들어가지 않는다', () => {
  const p = summarize([it_(), it_({ sent: true })]);
  assert.equal(p.total, 2);
  assert.equal(p.sent, 1);
});

test('발송했는데 발송일이 없어도 센다 — 날짜만 안 잡힌다', () => {
  const p = summarize([it_({ sent: true, sentDate: null })]);
  assert.equal(p.sent, 1);
  assert.equal(p.firstSentDate, null);
});

// ── 발송일 범위 ─────────────────────────────────────────

test('최초·최종 발송일을 잡는다 — 순서가 뒤섞여 들어와도', () => {
  const p = summarize([
    it_({ sent: true, sentDate: '2026-08-20' }),
    it_({ sent: true, sentDate: '2026-08-01' }),
    it_({ sent: true, sentDate: '2026-08-11' }),
  ]);
  assert.equal(p.firstSentDate, '2026-08-01');
  assert.equal(p.lastSentDate, '2026-08-20');
});

// ── 비율 ────────────────────────────────────────────────

test('분모가 0이면 0 — 나눗셈이 터지지 않는다', () => {
  assert.equal(pct(0, 0), 0);
  assert.equal(pct(5, 0), 0);
});

test('비율은 소수 첫째 자리까지', () => {
  assert.equal(pct(1, 3), 33.3);
  assert.equal(pct(2, 3), 66.7);
  assert.equal(pct(1, 1), 100);
});

// ── 합산 ────────────────────────────────────────────────

test('여러 집계를 합치면 건수는 더해지고 날짜 범위는 넓어진다', () => {
  const a = summarize([it_({ sent: true, sentDate: '2026-08-10', collectStatus: '회수완료' })]);
  const b = summarize([it_({ sent: true, sentDate: '2026-07-01' })]);
  const t = sumProgress([a, b]);
  assert.equal(t.total, 2);
  assert.equal(t.sent, 2);
  assert.equal(t.collected, 1);
  assert.equal(t.firstSentDate, '2026-07-01', '더 이른 쪽');
  assert.equal(t.lastSentDate, '2026-08-10', '더 늦은 쪽');
});

test('빈 목록을 합치면 빈 집계 — 0 으로 시작한다', () => {
  assert.deepEqual(sumProgress([]), emptyProgress());
});

// ── 경과일 ──────────────────────────────────────────────

test('경과일은 발송일부터 오늘까지', () => {
  assert.equal(daysSince('2026-08-01', '2026-08-15'), 14);
  assert.equal(daysSince('2026-08-15', '2026-08-15'), 0);
});

test('발송일이 없으면 null — 0 이 아니다', () => {
  assert.equal(daysSince(null, '2026-08-15'), null);
});

test('달·해를 넘어가도 맞는다', () => {
  assert.equal(daysSince('2025-12-25', '2026-01-05'), 11);
});

// ── 독촉 대상 ───────────────────────────────────────────

test('독촉 대상은 발송했고 아직 회수도 반송도 아닌 것', () => {
  const c = conf('c1', '㈜가');
  const items = {
    c1: [
      it_({ sent: true, sentDate: '2026-08-01' }),                          // 대상
      it_({ sent: true, sentDate: '2026-08-01', collectStatus: '회수완료' }), // 끝남
      it_({ sent: true, sentDate: '2026-08-01', collectStatus: '반송' }),     // 따로 다룬다
      it_({ sent: false }),                                                  // 아직 안 보냄
    ],
  };
  const out = findOverdue([c], items, 14, '2026-08-20');
  assert.equal(out.length, 1);
  assert.equal(out[0].days, 19);
});

test('임계일 경계 — 임계일이 지나야 대상이다(같은 날은 대상)', () => {
  const c = conf('c1', '㈜가');
  const items = { c1: [it_({ sent: true, sentDate: '2026-08-01' })] };
  assert.equal(findOverdue([c], items, 14, '2026-08-14').length, 0, '13일째는 아직');
  assert.equal(findOverdue([c], items, 14, '2026-08-15').length, 1, '14일째부터');
});

test('오래 밀린 것이 위로 온다', () => {
  const a = conf('a', '㈜가'); const b = conf('b', '㈜나');
  const items = {
    a: [it_({ sent: true, sentDate: '2026-08-10' })],
    b: [it_({ sent: true, sentDate: '2026-07-01' })],
  };
  const out = findOverdue([a, b], items, 7, '2026-08-25');
  assert.deepEqual(out.map((r) => r.conf.id), ['b', 'a']);
});

test('조회처가 없는 거래처는 건너뛴다', () => {
  assert.deepEqual(findOverdue([conf('x', '㈜없음')], {}, 7, '2026-08-25'), []);
});

// ── 미회수 건수 ─────────────────────────────────────────

test('미회수는 임계일과 무관하게 센다 — 어제 보낸 것도 미회수다', () => {
  const c = conf('c1', '㈜가');
  const items = {
    c1: [
      it_({ sent: true, sentDate: '2026-08-24' }),
      it_({ sent: true, sentDate: '2026-01-01' }),
      it_({ sent: true, collectStatus: '회수완료' }),
      it_({ sent: false }),
    ],
  };
  assert.equal(countPending([c], items), 2);
});

test('반송은 미회수로 세지 않는다 — 이미 조치 대상이다', () => {
  const c = conf('c1', '㈜가');
  assert.equal(countPending([c], { c1: [it_({ sent: true, collectStatus: '반송' })] }), 0);
});
