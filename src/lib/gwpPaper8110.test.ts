// 8110ARP — 확정 정산표(WTB)에서 결산일 열·계정 이름으로 채우기, 중요성은 2700A-4 로.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SheetData, CellValue } from './xlsxRead';
import { PAPER_8110, fillFromWtb, dateColumn } from './gwpPaper8110';

const sheet = (name: string, cells: Record<string, CellValue>): SheetData => ({ name, cells: new Map(Object.entries(cells)) });
const t = (text: string): CellValue => ({ text });
const n = (num: number): CellValue => ({ num });
const D25 = 46022, D24 = 45657, D26 = 46387;

// 이월 뒤 8110ARP — 당기 열(D) 은 작년 정산표 링크, 전기(E) 는 옮겨 둔 숫자
const BS = sheet('8110ARP_BS', {
  B19: t('OM'), C19: { formula: "'8110ARP_PL'!C31*1%", num: 9e6 }, B20: t('PM'), C20: { formula: 'C19*0.75', num: 1 }, B21: t('DM'), C21: { formula: 'C19*0.05', num: 1 },
  A23: t('대계정'), B23: t('IFRS 공시계정'), C23: t('소계정'), D23: n(D26), E23: n(D25), I23: t('Explanation'),
  A25: t('유동자산'), C25: t('현금'), D25: { formula: '[98]WBS!X6', num: 2399066 }, E25: n(2399066), I25: t('작년 설명'),
  C26: t('보통예금'), D26: { formula: '[98]WBS!X7', num: 43781844 }, E26: n(43781844),
  C27: t('대손충당금'), D27: { formula: '[98]WBS!X10', num: -630300 }, E27: n(-630300),
});
const PL = sheet('8110ARP_PL', {
  B22: t('OM'), C22: { formula: "'8110ARP_BS'!C19" }, B23: t('PM'), C23: { formula: 'C22*0.75' },
  A26: t('대계정'), B26: t('소계정'), C26: { formula: "'8110ARP_BS'!D23", num: D26 }, D26: { formula: "'8110ARP_BS'!E23", num: D25 }, H26: t('Explanation'),
  A27: t('대계정'), B27: t('소계정'),
  A30: t('매출액'), B30: t('임대료매출'), C30: { formula: '[98]WPL!W6+[98]WPL!W7', num: 917513441 }, D30: { formula: 'SUMIF([98]WPL!$B$3:$B$54,B30,[98]WPL!$S$3:$S$54)', num: 991021873 },
});
const M4 = sheet('2700A-4(감사완결단계)', { A1: t('2700A-4') });

// 올해(FY26) 정산표 — 열이 하나 늘어 감사후가 Y 로 밀렸다
const WBS = sheet('WBS', {
  B1: t('과    목'), C1: t('회사제시계정'), T2: n(D24), X2: n(D25), V2: n(D26), Y2: n(D26),
  B6: t('현금및현금성자산'), C6: t('현금'), X6: n(2399066), Y6: n(5000000),
  B7: t('현금및현금성자산'), C7: t('보통예금'), X7: n(43781844), Y7: n(40000000),
  B11: t('대손충당금-매출채권'), C11: t('대손충당금-외상매출금'), X11: n(-630300), Y11: n(-700000),
});
const WPL = sheet('WPL', {
  B1: t('과목'), S2: n(D24), W2: n(D25), X2: n(D26),
  B6: t('임대료매출'), W6: n(916852000), X6: n(800000000),
  B7: t('임대료매출'), W7: n(661441), X7: n(1000000),
});

test('정산표 열 — 머리에 결산일이 적힌 가장 오른쪽 열(감사후)', () => {
  assert.equal(dateColumn(WBS, D26), 'Y');
  assert.equal(dateColumn(WBS, D25), 'X');
});

test('8110ARP — 이름으로 채우고(같은 이름은 더함), 못 찾으면 작년 링크 줄로, 손익 전기는 전기 결산일 열에서', () => {
  const d = PAPER_8110.readBook!([BS, PL]);
  assert.equal(d.rows.length, 4);
  assert.equal(d.rows[0].explanation, '');
  assert.equal(d.rows[0].lastYear, '작년 설명');
  const { data, report } = fillFromWtb(d, [WBS, WPL], '2026-12-31');
  const by = new Map(data.rows.map((r) => [r.label, r]));
  assert.equal(by.get('현금')?.cur, 5000000);
  assert.equal(by.get('보통예금')?.cur, 40000000);
  // 「대손충당금」은 정산표에 그 이름이 없다 → 작년 링크 줄(10)… 올해 정산표 10행은 비었다 → 0
  assert.equal(by.get('임대료매출')?.cur, 801000000);
  assert.equal(by.get('임대료매출')?.prev, 917513441);
  assert.deepEqual(report.curCol, { BS: 'Y', PL: 'X' });
  assert.deepEqual(report.prevCol, { BS: 'X', PL: 'W' });
});

test('8110ARP 쓰기 — 링크 칸에 값, Explanation 은 새로 쓴 것만, OM·PM·DM 은 2700A-4(원)·PL 은 BS', () => {
  const d = PAPER_8110.readBook!([BS, PL]);
  const { data } = fillFromWtb(d, [WBS, WPL], '2026-12-31');
  data.rows[3] = { ...data.rows[3], explanation: '공실 증가' };
  const plan = new Map(PAPER_8110.writeBook!([BS, PL, M4], data).map((p) => [p.sheet, new Map(p.edits.map((e) => [e.ref, e]))]));
  const b = plan.get('8110ARP_BS')!, p = plan.get('8110ARP_PL')!;
  assert.equal(b.get('D25')?.num, 5000000);
  assert.equal(b.get('I25')?.clear, true);
  assert.equal(b.get('C19')?.formula, "'2700A-4(감사완결단계)'!K29*1000000");
  assert.equal(b.get('C21')?.formula, "'2700A-4(감사완결단계)'!K68*1000000");
  assert.equal(p.get('C30')?.num, 801000000);
  assert.equal(p.get('D30')?.num, 917513441);
  assert.equal(p.get('H30')?.text, '공실 증가');
  assert.equal(p.get('C23')?.formula, "'8110ARP_BS'!C20");   // 숫자로 시작하는 시트 이름은 따옴표
});
