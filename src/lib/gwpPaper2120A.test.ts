// 2110(글자 속 값) · 2120A(전기 DSD 로 당기 열 채우기).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SheetData, CellValue } from './xlsxRead';
import type { FsLine } from './fsParse';
import { PAPER_2110 } from './gwpPaper2110';
import { PAPER_2120A, fillFromFs } from './gwpPaper2120A';

const sheet = (name: string, cells: Record<string, CellValue>): SheetData => ({ name, cells: new Map(Object.entries(cells)) });
const t = (text: string): CellValue => ({ text });
const n = (num: number): CellValue => ({ num });

const S2110 = sheet('2110(소규모)', {
  A8: t('항 목'), F8: t('수행자'),
  A9: t('(감사팀의 구성)'),
  A10: t('1.업무수행이사 … 감사팀을 구성한다.'), F10: t('정우철'),
  A11: t('-상기 파악한 내용의 기재 : \r\n-또는 별도의 조서에서 검토 : 조서번호 (   2110A)'),
  A18: t('1 주요감사계약 내용의 확인'), F18: t('정우철'),
  A19: t('(1) 감사목적과범위：일반( V), 임의( )'),
  A20: t('(2)감사일정:'), A21: t('감사계획: 2025.4.14'), A22: t('중간감사: 2025.12월 중'), A25: t('기말감사: 2026년 3월중'),
  A26: t('(3) 실사장소:'), A27: t('본사: N/A'),
  A29: t('(4) 감사보고서 제출 예정일: '), A30: t('국문( 10 부), 영문( -부) '),
});

test('2110 — 글자 속 값을 읽고, 그대로면 한 칸도 안 바꾼다', () => {
  const d = PAPER_2110.read(S2110);
  assert.equal(d.team[0].ref, '2110A');
  assert.equal(d.scope, '일반');
  assert.equal(d.schedule.find((x) => x.label === '중간감사')?.value, '2025.12월 중');
  assert.equal(d.sites[0].value, 'N/A');
  assert.equal(d.copiesKo, '10');
  const changed = PAPER_2110.write(S2110, d).filter((e) => e.text != null && e.text.trim() !== (S2110.cells.get(e.ref)?.text ?? '').trim());
  assert.deepEqual(changed, []);
});

test('2110 — 고친 값만 문구를 살려 바꾼다(줄바꿈은 그대로)', () => {
  const d = PAPER_2110.read(S2110);
  d.schedule = d.schedule.map((x) => (x.label === '중간감사' ? { ...x, value: '2026.12월 중' } : x));
  d.team[0] = { ...d.team[0], text: '2110A 참조' };
  d.scope = '임의';
  const e = new Map(PAPER_2110.write(S2110, d).map((x) => [x.ref, x]));
  assert.equal(e.get('A22')?.text, '중간감사: 2026.12월 중');
  assert.equal(e.get('A11')?.text, '-상기 파악한 내용의 기재 : 2110A 참조 \r\n-또는 별도의 조서에서 검토 : 조서번호 ( 2110A )');
  assert.equal(e.get('A19')?.text, '(1) 감사목적과범위：일반( ), 임의( V)');
  assert.equal(e.has('A21'), false);
});

// 명진 2120A 모양 — 이월 뒤: 전기(E) 에 숫자, 당기(F) 비움
const S2120 = sheet('2120A', {
  B14: t('계정과목 (FSLI)'), D14: t('계정과목 (IFRS 공시용)'), E14: t('BS: 2024_4Q\nPL: 2024_4Q'), F14: t('BS: 2025_4Q\nPL: 2025_4Q'), L14: t('비고'),
  B17: t('Ⅰ. 유 동 자 산'), E17: { formula: 'SUM(E18:E21)' }, F17: { formula: 'SUM(F18:F21)' },
  C18: t('현금및현금성자산'), D18: t('현금및현금성자산'), E18: n(60656226),
  C19: t('단기투자자산'), D19: t('기타유동금융자산'), E19: n(2000000),
  C20: t('매출채권'), D20: t('매출채권 및 기타채권'), E20: n(63030000),
  C21: t('대손충당금-매출채권'), D21: t('매출채권 및 기타채권'), E21: n(-630300),
  B101: t('Ⅰ. 매    출    액'),
  C102: t('매출액'), D102: t('매출액'), E102: n(991021873),
  C112: t('지급수수료'), D112: t('판관비'), E112: n(30430039),
  C140: t('지급수수료'), D140: t('영업외비용'),
});
const L = (statement: string, label: string, level: number, cur?: number, pri?: number): FsLine => ({ statement, label, level, cur, pri, notes: [], at: 0 });
const FS = [
  L('재무상태표', 'I.유동자산', 0, 24350610492, 24387522139),
  L('재무상태표', '(1)당좌자산', 1, 113646019, 175055926),
  L('재무상태표', '현금및현금성자산', 2, 46180910, 60656226),
  L('재무상태표', '단기금융상품', 2, undefined, 2000000),
  L('재무상태표', '매출채권', 2, 65720600, 63030000),
  L('재무상태표', '대손충당금', 2, -630300, -630300),
  L('재무상태표', '당기법인세자산', 2, 30345, undefined),
  L('재무상태표', '자 산 총 계', 0, 24462905041, 24514274004),
  L('손익계산서', 'Ⅰ.매출액', 0, 917513441, 991021873),
  L('손익계산서', '지급수수료', 1, 35250850, 30430039),
];

test('2120A — 문구·차감 계정·전기 금액으로 짝짓고, 같은 이름은 한 번만, 받을 줄 없는 계정은 알린다', () => {
  const d = PAPER_2120A.read(S2120);
  assert.equal(d.rows.length, 7);
  const { data, report } = fillFromFs(d, FS);
  const by = new Map(data.rows.map((r) => [r.label + r.fsli, r]));
  assert.equal(by.get('현금및현금성자산현금및현금성자산')?.cur, 46180910);
  assert.equal(by.get('단기투자자산기타유동금융자산')?.src, '금액');
  assert.equal(by.get('단기투자자산기타유동금융자산')?.cur, 0);
  assert.equal(by.get('대손충당금-매출채권매출채권 및 기타채권')?.cur, -630300);
  assert.equal(by.get('매출액매출액')?.cur, 917513441);
  assert.equal(by.get('지급수수료판관비')?.cur, 35250850);
  assert.equal(by.get('지급수수료영업외비용')?.cur, null);
  assert.deepEqual([report.byLabel, report.byContra, report.byValue], [4, 1, 1]);
  assert.deepEqual(report.unplaced.map((u) => u.label), ['당기법인세자산']);
  assert.deepEqual(report.missing, []);
  const e = new Map(PAPER_2120A.write(S2120, data).map((x) => [x.ref, x]));
  assert.equal(e.get('F18')?.num, 46180910);
  assert.equal(e.get('F140')?.clear, true);
});

test('2120A — DSD 가 천원 단위면 전기 열과 견주어 ×1000', () => {
  const d = PAPER_2120A.read(S2120);
  const k = FS.map((l) => ({ ...l, cur: l.cur == null ? undefined : Math.round(l.cur / 1000), pri: l.pri == null ? undefined : Math.round(l.pri / 1000) }));
  const { report, data } = fillFromFs(d, k);
  assert.equal(report.scale, 1000);
  assert.equal(data.rows[0].cur, 46181000);
});
