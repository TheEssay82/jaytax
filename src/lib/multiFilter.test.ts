import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_FILTER, isAll, passes, passesAny, toggle, label, selectedSet, fromSelection,
} from './multiFilter.ts';

const ALL = ['정우철', '김준성', '조현규'];

test('아무것도 안 고르면 전체가 통과한다', () => {
  assert.equal(isAll(EMPTY_FILTER), true);
  for (const v of ALL) assert.equal(passes(EMPTY_FILTER, v), true);
});

test('여럿 고르기 — 고른 것만 보인다', () => {
  const f = { mode: 'include' as const, picked: ['정우철', '김준성'] };
  assert.equal(passes(f, '정우철'), true);
  assert.equal(passes(f, '김준성'), true);
  assert.equal(passes(f, '조현규'), false);
});

test('특정 값 빼기 — 「정우철만 제외」가 된다', () => {
  const f = { mode: 'exclude' as const, picked: ['정우철'] };
  assert.equal(passes(f, '정우철'), false);
  assert.equal(passes(f, '김준성'), true);
  assert.equal(passes(f, '조현규'), true);
});

test('한 건에 여럿이 붙는 자리(담당직원)는 하나만 통과해도 통과', () => {
  const f = { mode: 'include' as const, picked: ['김동주'] };
  assert.equal(passesAny(f, ['김민섭', '김동주']), true);
  assert.equal(passesAny(f, ['김민섭']), false);
});

test('담당이 아예 없는 건은 「(빈 값)」 하나로 보고 판단한다 — 조용히 빠지면 합계가 어긋난다', () => {
  const onlyEmpty = { mode: 'include' as const, picked: [''] };
  assert.equal(passesAny(onlyEmpty, []), true);
  const excludeEmpty = { mode: 'exclude' as const, picked: [''] };
  assert.equal(passesAny(excludeEmpty, []), false);
});

test('켜고 끄기', () => {
  let f = EMPTY_FILTER;
  f = toggle(f, '정우철');
  assert.deepEqual(f.picked, ['정우철']);
  f = toggle(f, '정우철');
  assert.deepEqual(f.picked, []);
});

// ── 화면 체크 ↔ 필터 ──────────────────────────────────────
test('전부 켜면 「전체」로 돌아간다', () => {
  assert.deepEqual(fromSelection(new Set(ALL), ALL), EMPTY_FILTER);
});

test('하나만 끄면 exclude 로 담는다 — 나중에 담당자가 늘어도 저절로 포함된다', () => {
  const f = fromSelection(new Set(['김준성', '조현규']), ALL);
  assert.deepEqual(f, { mode: 'exclude', picked: ['정우철'] });
  // 새 담당자가 생겨도 그대로 통과한다
  assert.equal(passes(f, '새회계사'), true);
});

test('하나만 켜면 include 로 담는다', () => {
  const f = fromSelection(new Set(['정우철']), ALL);
  assert.deepEqual(f, { mode: 'include', picked: ['정우철'] });
  assert.equal(passes(f, '새회계사'), false);
});

test('아무것도 안 켜면 아무것도 안 보인다', () => {
  const f = fromSelection(new Set(), ALL);
  assert.deepEqual(f, { mode: 'include', picked: [] });
  // 다만 빈 include 는 「전체」와 같으므로 화면이 「모두 끄기」를 막아야 한다
  assert.equal(isAll(f), true);
});

test('체크 상태로 되돌리기', () => {
  assert.deepEqual([...selectedSet(EMPTY_FILTER, ALL)].sort(), [...ALL].sort());
  assert.deepEqual([...selectedSet({ mode: 'exclude', picked: ['정우철'] }, ALL)], ['김준성', '조현규']);
  assert.deepEqual([...selectedSet({ mode: 'include', picked: ['정우철'] }, ALL)], ['정우철']);
});

// ── 화면에 적을 글 ────────────────────────────────────────
test('화면 글', () => {
  assert.equal(label(EMPTY_FILTER, 3), '전체');
  assert.equal(label({ mode: 'include', picked: ['정우철'] }, 3), '정우철');
  assert.equal(label({ mode: 'include', picked: ['정우철', '김준성'] }, 3), '정우철 외 1');
  assert.equal(label({ mode: 'exclude', picked: ['정우철'] }, 3), '정우철 제외');
});

test('다 고른 것은 「전체」로 적는다', () => {
  assert.equal(label({ mode: 'include', picked: ALL }, 3), '전체');
});
