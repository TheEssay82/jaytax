import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  suggestCode, renumber, cloneForNextYear,
  defaultPeriod, defaultAuditFy, termLabel, progress, type NoteRow,
} from './dsdNotes.ts';

test('코드는 제목에서 만든다 — 「표준」을 대조하지 않는다', () => {
  // 회사마다 주석 양식이 다르므로 사무소 공통의 표준 틀이 성립하지 않는다(2026-09-13).
  assert.equal(suggestCode('무형자산'), '무형자산');
  assert.equal(suggestCode('유 형 자 산'), '유_형_자_산');
  assert.equal(suggestCode('특수관계자 공시'), '특수관계자_공시');
  assert.equal(suggestCode('가상자산 보유내역'), '가상자산_보유내역', 'X_ 딱지를 붙이지 않는다');
  assert.equal(suggestCode('(*) …'), 'NOTE', '글자가 없으면 기본 이름');
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
  assert.deepEqual(next.map((x) => x.status), ['작업중', '작업중', '작업중', '작업중']);
  assert.deepEqual(next.map((x) => x.code), ['A', 'B', 'C', 'D']);
  assert.equal(next.find((x) => x.code === 'C')?.source, '회사');   // 작성주체는 유지
  assert.equal(next.find((x) => x.code === 'B')?.enabled, false);   // 꺼둔 것도 유지
});

test('지금 준비하는 감사의 대상 연도 — 하반기는 올해, 상반기는 작년', () => {
  assert.equal(defaultAuditFy(new Date('2026-09-12')), 2026);   // 2026년 12월 결산을 준비
  assert.equal(defaultAuditFy(new Date('2026-12-31')), 2026);
  assert.equal(defaultAuditFy(new Date('2027-03-20')), 2026);   // 그 감사를 이듬해 3월에 수행
  assert.equal(defaultAuditFy(new Date('2027-06-30')), 2026);
  assert.equal(defaultAuditFy(new Date('2027-07-01')), 2027);
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
