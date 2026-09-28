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

// 2026 일반·K-IFRS 양식(알티스트) — 값은 B열, 항목은 조서번호 F · 수행자 G · 비고 H
const G2110 = sheet('2110', {
  A8: t('항 목'), F8: t('조서번호'), G8: t('수행자'), H8: t('비고'),
  A9: t('(감사팀의 구성)'),
  A10: t('1.업무수행이사 … 감사팀을 구성한다.'), G10: t('정우철'), H10: t('감사팀을 구성하였음.'),
  A11: t('2 업무품질관리검토자 …'), G11: t('정우철'),
  A12: t('3 감사인 측 전문가 …'), F12: t('2131'), G12: t('N/A'),
  A17: t('(업무의 지휘/감독, 검토 및 자문)'),
  A18: t('1 업무팀원들에 대한 지휘와 감독'), G18: t('정우철'),
  A38: t('1 주요감사계약 내용의 확인'), G38: t('정우철'),
  A39: t('(1) 감사목적과범위：'), B39: t('일반비상장'),
  A40: t('(2) 연결재무제표 감사 여부：'), B40: t('부'),
  A41: t('(3)감사일정:'), A42: t('감사계획:'), B42: t('2025년 4월'), A44: t('재고 실사입회:'), B44: n(46027), A47: t('연결감사:'), B47: t('N/A'),
  A48: t('(4) 실사장소:'), A49: t('본사:'), B49: { formula: "'2100A'!D26", text: '서울 마포구' },
  A51: t('(5) 감사보고서 제출 예정일:'), B51: n(46112),
  A52: t('국문'), B52: t('30부'), A53: t('영문'), B53: t('N/A'),
});

test('2110 — 일반 양식: 값은 B열(날짜 칸·링크), 감사팀 항목은 비고·조서번호 열, 그대로면 안 바꾼다', () => {
  const d = PAPER_2110.read(G2110);
  assert.equal(d.team.length, 3);
  assert.deepEqual(d.team[0], { label: '1.업무수행이사 … 감사팀을 구성한다.', performer: '정우철', text: '감사팀을 구성하였음.', ref: '' });
  assert.equal(d.team[2].ref, '2131');
  assert.equal(d.scopeText, '일반비상장');
  assert.equal(d.consolidated, '부');
  assert.equal(d.schedule.find((x) => x.label === '재고 실사입회')?.value, '2026-01-05');
  assert.equal(d.schedule.find((x) => x.label === '연결감사')?.value, 'N/A');
  assert.equal(d.sites[0].value, '서울 마포구');
  assert.equal(d.reportDue, '2026-03-31');
  assert.equal(d.copiesKo, '30');
  assert.deepEqual(PAPER_2110.write(G2110, d), []);
  d.schedule = d.schedule.map((x) => (x.label === '재고 실사입회' ? { ...x, value: '2027-01-04' } : x.label === '감사계획' ? { ...x, value: '2026년 4월' } : x));
  d.team[1] = { ...d.team[1], text: '품질관리검토자 지정됨' };
  d.copiesKo = '20';
  const e = new Map(PAPER_2110.write(G2110, d).map((x) => [x.ref, x]));
  assert.equal(e.get('B44')?.num, 46391);
  assert.equal(e.get('B42')?.text, '2026년 4월');
  assert.equal(e.get('H11')?.text, '품질관리검토자 지정됨');
  assert.equal(e.get('B52')?.text, '20부');
  assert.equal(e.has('B49'), false);                 // 링크는 값이 그대로면 두고
  assert.equal(e.size, 4);
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

test('2120A — 같은 계정의 다른 이름(선급법인세 = 당기법인세자산)은 문구로 짝짓는다', () => {
  const s = sheet('2120A', { ...Object.fromEntries(S2120.cells), C33: t('선급법인세'), D33: t('선급법인세') });
  const { data, report } = fillFromFs(PAPER_2120A.read(s), FS);
  assert.equal(data.rows.find((r) => r.label === '선급법인세')?.cur, 30345);
  assert.deepEqual(report.unplaced, []);
});

test('2120A — DSD 가 천원 단위면 전기 열과 견주어 ×1000', () => {
  const d = PAPER_2120A.read(S2120);
  const k = FS.map((l) => ({ ...l, cur: l.cur == null ? undefined : Math.round(l.cur / 1000), pri: l.pri == null ? undefined : Math.round(l.pri / 1000) }));
  const { report, data } = fillFromFs(d, k);
  assert.equal(report.scale, 1000);
  assert.equal(data.rows[0].cur, 46181000);
});

// 2026 양식 그대로의 2120A — 「계정과목」 머리 없이 계정이 A·B·C 층(8110A 와 같은 모양)
const L2120 = sheet('2120A', {
  D16: t('전기'), E16: t('당기'), H16: t('Variance'), L16: t('설명 또는 검토할 조서의 번호/링크'),
  D18: t('12/31/2025'), E18: t('12/31/2026'),
  A19: t('재무상태표'),
  A20: t('유동자산'), D20: { formula: 'D21+D24', num: 1 }, E20: { formula: 'E21+E24' },
  B21: t('당좌자산'), D21: { formula: 'SUM(D22:D23)', num: 1 }, E21: { formula: 'SUM(E22:E23)' },
  C22: t('현금및현금성자산'), D22: n(300), L22: t('작년 설명'),
  C23: t('매출채권'), D23: n(200),
  B24: t('재고자산'), D24: n(100),
  A35: t('자산총계'), D35: { formula: 'D20', num: 600 },
  B37: t('단기차입금'), D37: n(400),
  A52: t('부채총계'), D52: { formula: 'D37', num: 400 },
  A53: t('자본금'), D53: n(200),
  B58: t('자기주식'), D58: n(0), H58: n(0),
  A74: t('손익계산서'),
  A75: t('매출액'), D75: n(1000),
  A77: t('매출총이익'), D77: { formula: 'D75-D76', num: 1 },
});

test('2120A — 2026 양식 층 모양: 합계 줄은 빼고, 자산총계·부채총계로 부분을 나누고, 설명 열이 비고', () => {
  const d = PAPER_2120A.read(L2120);
  assert.deepEqual(d.rows.map((r) => `${r.sec}|${r.label}|${r.prev}`), [
    '자산|현금및현금성자산|300', '자산|매출채권|200', '자산|재고자산|100', '부채|단기차입금|400', '자본|자본금|200', '자본|자기주식|0', '손익|매출액|1000',
  ]);
  assert.equal(d.rows[0].note, '작년 설명');
  const e = new Map(PAPER_2120A.write(L2120, { ...d, rows: d.rows.map((r) => (r.label === '매출채권' ? { ...r, cur: 250 } : r)) }).map((x) => [x.ref, x]));
  assert.equal(e.get('E23')?.num, 250);
  assert.equal(e.has('E21'), false);
});
