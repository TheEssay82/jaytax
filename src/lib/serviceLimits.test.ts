// 요금제 한도 판정. **경고가 늦으면 어느 날 갑자기 앱이 막힌다** — 경계를 못박는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ratioOf, levelOf, worstLevel, humanBytes, humanUsed,
  SUPABASE_FREE, WARN_AT, CRITICAL_AT,
} from './serviceLimits';

// ── 비율 ────────────────────────────────────────────────

test('비율은 쓴 양 ÷ 한도', () => {
  assert.equal(ratioOf(250, 500), 0.5);
  assert.equal(ratioOf(0, 500), 0);
});

test('한도나 사용량을 모르면 null — 0 이 아니다', () => {
  assert.equal(ratioOf(100, null), null);
  assert.equal(ratioOf(null, 500), null);
  assert.equal(ratioOf(100, 0), null, '0 으로 나누지 않는다');
});

// ── 등급 경계 ───────────────────────────────────────────

test('등급 경계 — 70%에서 살펴보고, 90%부터 급하고, 100%면 넘은 것', () => {
  assert.equal(levelOf(0.69), 'ok');
  assert.equal(levelOf(WARN_AT), 'warn');
  assert.equal(levelOf(0.89), 'warn');
  assert.equal(levelOf(CRITICAL_AT), 'critical');
  assert.equal(levelOf(0.99), 'critical');
  assert.equal(levelOf(1), 'over');
  assert.equal(levelOf(1.5), 'over');
});

test('한도를 모르면 경고하지 않는다 — 모르는 것으로 겁주지 않는다', () => {
  assert.equal(levelOf(null), 'ok');
});

// ── 가장 나쁜 등급 ──────────────────────────────────────

test('여럿 중 가장 나쁜 것을 고른다 — 화면 위 한 줄이 그것이다', () => {
  assert.equal(worstLevel(['ok', 'warn', 'ok']), 'warn');
  assert.equal(worstLevel(['warn', 'over', 'critical']), 'over');
  assert.equal(worstLevel(['ok', 'ok']), 'ok');
  assert.equal(worstLevel([]), 'ok');
});

// ── 크기 표시 ───────────────────────────────────────────

test('바이트를 사람이 읽는 크기로', () => {
  assert.equal(humanBytes(0), '0B');
  assert.equal(humanBytes(1023), '1023B');
  assert.equal(humanBytes(1024), '1KB');
  assert.equal(humanBytes(230542483), '219.9MB');
  assert.equal(humanBytes(1024 ** 3), '1GB');
});

test('모르는 값은 —', () => {
  assert.equal(humanBytes(null), '—');
  assert.equal(humanUsed(null, 'bytes'), '—');
});

test('개수는 천 단위로 끊어 보인다', () => {
  assert.equal(humanUsed(12, 'count'), '12');
  assert.equal(humanUsed(50000, 'count'), '50,000');
});

// ── 실제 한도표 ─────────────────────────────────────────

test('Supabase 무료 한도 — DB 500MB · 저장소 1GB', () => {
  const db = SUPABASE_FREE.find((x) => x.key === 'db')!;
  const st = SUPABASE_FREE.find((x) => x.key === 'storage')!;
  assert.equal(db.limit, 500 * 1024 * 1024);
  assert.equal(st.limit, 1024 * 1024 * 1024);
});

test('한도마다 「넘으면 무슨 일이 생기는가」가 적혀 있다', () => {
  for (const l of SUPABASE_FREE) {
    assert.ok(l.consequence.length > 0, `${l.key} 에 결과 설명이 없다`);
    assert.ok(l.label.length > 0);
  }
});

test('2026-09-04 실측값(DB 220MB)은 아직 ok 지만 절반 가까이 왔다', () => {
  const db = SUPABASE_FREE.find((x) => x.key === 'db')!;
  const r = ratioOf(230_542_483, db.limit)!;
  assert.equal(levelOf(r), 'ok');
  assert.ok(r > 0.4 && r < 0.5, `실측 비율이 ${r} 다 — 0.4~0.5 를 벗어나면 상황이 바뀐 것`);
});
