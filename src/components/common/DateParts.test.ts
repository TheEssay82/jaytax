// 연·월·일 칸 입력의 조립 규칙 — 완성된 값만 'YYYY-MM-DD' 로 내보내고, 미완성·범위 밖은 '' 다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeDateParts } from './DateParts';

test('완성된 날짜는 0 을 채워 ISO 로', () => {
  assert.equal(composeDateParts('2026', '9', '5', 'date'), '2026-09-05');
  assert.equal(composeDateParts('2026', '12', '31', 'date'), '2026-12-31');
});
test('월 모드는 일 없이 YYYY-MM', () => {
  assert.equal(composeDateParts('2026', '8', '', 'month'), '2026-08');
  assert.equal(composeDateParts('2026', '8', '15', 'month'), '2026-08');
});
test('미완성이나 범위 밖은 빈 값 — 저장 로직에 반쪽 날짜를 넘기지 않는다', () => {
  assert.equal(composeDateParts('202', '9', '5', 'date'), '');
  assert.equal(composeDateParts('2026', '', '5', 'date'), '');
  assert.equal(composeDateParts('2026', '13', '5', 'date'), '');
  assert.equal(composeDateParts('2026', '9', '32', 'date'), '');
  assert.equal(composeDateParts('2026', '9', '', 'date'), '');
  assert.equal(composeDateParts('', '', '', 'date'), '');
});
