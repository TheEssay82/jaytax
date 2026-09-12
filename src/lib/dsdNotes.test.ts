import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  template, templateSize, suggestCode, renumber, cloneForNextYear,
  defaultPeriod, termLabel, progress, type NoteRow,
} from './dsdNotes.ts';

test('표준 틀 — 실제 보고서에서 뽑은 개수', () => {
  assert.equal(templateSize('일반기업회계기준'), 18);   // 명진산업개발 FY25
  assert.equal(templateSize('K-IFRS'), 41);             // ㈜넵튠 FY25
});

test('표준 틀 — 번호·시트가 차례로 붙는다', () => {
  const t = template('일반기업회계기준');
  assert.equal(t[0].code, 'COMPANY');
  assert.equal(t[0].no, 1);
  assert.equal(t[0].sheet, 'N01');
  assert.equal(t.at(-1)?.title, '재무제표의 확정일');
  assert.equal(t.at(-1)?.sheet, 'N18');
});

test('표준 틀 — 코드가 겹치지 않는다', () => {
  for (const b of ['K-IFRS', '일반기업회계기준'] as const) {
    const codes = template(b).map((r) => r.code);
    assert.equal(new Set(codes).size, codes.length, b);
  }
});

test('회사가 쓰는 주석은 대조 대상에서 뺀다', () => {
  const t = template('K-IFRS');
  assert.equal(t.find((r) => r.code === 'RELATED_PARTY')?.source, '회사');
  assert.equal(t.find((r) => r.code === 'INTANGIBLE')?.source, '감사인');
});

test('제목으로 코드 짐작', () => {
  assert.equal(suggestCode('무형자산', 'K-IFRS'), 'INTANGIBLE');
  assert.equal(suggestCode('유 형 자 산', 'K-IFRS'), 'PPE');
  assert.equal(suggestCode('특수관계자 공시', '일반기업회계기준'), 'RELATED_PARTY');
  // 다른 기준서의 이름이어도 찾아 준다
  assert.equal(suggestCode('재고자산', 'K-IFRS'), 'INVENTORY');
});

test('표준에 없는 제목은 임시 코드 — 사람이 고치라고 X_ 를 붙인다', () => {
  const c = suggestCode('가상자산 보유내역', 'K-IFRS');
  assert.ok(c.startsWith('X_'), c);
});

const rows = (): NoteRow[] => [
  { code: 'A', no: 1, title: '가', enabled: true, source: '감사인', status: '작업완료', sortOrder: 10 },
  { code: 'B', no: 2, title: '나', enabled: false, source: '감사인', status: '작성제외', sortOrder: 20 },
  { code: 'C', no: 3, title: '다', enabled: true, source: '회사', status: '작업중', sortOrder: 30 },
  { code: 'D', no: 4, title: '라', enabled: true, source: '감사인', status: '미할당', sortOrder: 40 },
];

test('주석을 끄면 뒤가 당겨진다 — 번호를 열쇠로 못 쓰는 이유', () => {
  const r = renumber(rows());
  assert.deepEqual(r.map((x) => [x.code, x.no]), [['A', 1], ['B', null], ['C', 2], ['D', 3]]);
});

test('다음 해로 넘기면 진행상태는 비우고 코드·시트는 가져간다', () => {
  const next = cloneForNextYear(rows());
  assert.deepEqual(next.map((x) => x.status), ['미할당', '미할당', '미할당', '미할당']);
  assert.deepEqual(next.map((x) => x.code), ['A', 'B', 'C', 'D']);
  assert.equal(next.find((x) => x.code === 'C')?.source, '회사');   // 작성주체는 유지
  assert.equal(next.find((x) => x.code === 'B')?.enabled, false);   // 꺼둔 것도 유지
});

test('기본 회계기간과 기수 표기', () => {
  assert.deepEqual(defaultPeriod(2025), { from: '2025-01-01', to: '2025-12-31' });
  assert.equal(termLabel(18), '제18기');
  assert.equal(termLabel(null), '');
  assert.equal(termLabel(0), '');
});

test('진행 상황은 켜진 주석만 센다', () => {
  const p = progress(rows());
  assert.deepEqual(p, { done: 1, total: 3, pct: 33 });
  assert.deepEqual(progress([]), { done: 0, total: 0, pct: 0 });
});
