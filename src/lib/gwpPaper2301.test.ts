// 2301 — 옛 모양(명진 2301+2302) 읽기, 올해 양식 쓰기, 추천(규칙·2120A·사례).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SheetData, CellValue } from './xlsxRead';
import { PAPER_2301, layout2301, hintsFor, readLibrary, casesFor, defaultAssertions, FRAUD_BASIS } from './gwpPaper2301';

const sheet = (name: string, cells: Record<string, CellValue>): SheetData => ({ name, cells: new Map(Object.entries(cells)) });
const t = (text: string): CellValue => ({ text });

const OLD2301 = sheet('2301', {
  A11: t('3. 구체적인 판단의 근거 등이 필요한 경우'), A12: t('4. 작성사례를 참조한다'),
  A30: t('Ⅰ. 전체재무제표 수준에서의 왜곡표시위험 평가'),
  A31: t('1. 부정으로 인한 전체재무제표 왜곡표시위험'), C31: t('Y'), G31: t('기준서 240 문단27'),
  A33: t('3. 특수관계자 거래가 적절하게 회계처리 및 공시되지 않을 위험'), C33: t('Y'), G33: t('특수관계자 파악'),
  A35: t('5. 기타사항'), C35: t('N/A'),
});
const OLD2302 = sheet('2302', {
  A25: t('계정과목(*1)'), B25: t('유의적 위험 판단근거(*2)'),
  A27: t('현금성자산'), H27: t('일반적인 위험'),
  A29: t('유가증권'), H29: t('N/A'),
  A45: t('매출'), H45: t('매출액 성장율에 관심'), I45: t('2100 2120'),
  A55: t('[참고자료]'),
});

const NEW = sheet('2301(소규모)', {
  A9: t('구분(*1)'), B9: t('유의적위험(Y/N)(*2)'), C9: t('경영진주장(*2)'), M9: t('유의적위험 판단근거 및 설명(*3)'), P9: t('위험평가 수행절차'),
  C10: t('A'), D10: t('C'), E10: t('CO'), F10: t('E'), G10: t('O'), H10: t('V'), I10: t('RO'), J10: t('CL'), K10: t('U'), L10: t('P'),
  A12: t('Ⅰ. 전체재무제표 수준에서의 왜곡표시위험 평가'),
  A13: t('1. 부정으로 인한 전체재무제표 왜곡표시위험'), P13: t('-위험평가절차의 기재 : -또는 별도의 조서에서 검토 : 조서번호 ( )'),
  A15: t('3. 특수관계자 거래가 적절하게 회계처리 및 공시되지 않을 위험'),
  A19: t('구분(*1) '), B19: t('유의적위험(Y/N)(*2)'),
  C20: t('A'), D20: t('C'), E20: t('CO'), F20: t('E'), G20: t('O'), H20: t('V'), I20: t('RO'), J20: t('CL'), K20: t('U'), L20: t('P'),
  A22: t('Ⅰ.거래유형, 계정잔액, 및 공시에 대한 경영진주장의 수준'),
  A23: t('현금성자산'), A24: t('장단기금융상품'),
  A29: t(':'),
  A82: t('계정과목'), B82: t('주요 왜곡표시위험 사례'), M82: t('경영진 주장'),
  A83: t('현금성자산'), B83: t('모든 현금거래가 기록 되지 않을 위험'), M83: t('C'),
  B84: t('현금 거래가 정확한 기간에 기록되지 않을 위험'), M84: t('C CO'),
  A85: t('매출'), B85: t('매출이 기간귀속되지 않을 위험'), M85: t('CO, O'),
});

test('2301 — 옛 모양(2301 전사 + 2302 계정)에서 작년 판단을 읽는다: 작성요령 번호 줄은 빼고', () => {
  const d = PAPER_2301.readBook!([OLD2301, OLD2302]);
  assert.deepEqual(d.entity.map((e) => [e.label.slice(0, 2), e.sig]), [['1.', 'Y'], ['3.', 'Y'], ['5.', 'N/A']]);
  assert.equal(d.entity[0].asr.length, 10);
  assert.deepEqual(d.accounts.map((a) => [a.label, a.sig]), [['현금성자산', 'N'], ['유가증권', 'N/A'], ['매출', 'Y']]);
  assert.equal(d.accounts[2].basis, '매출액 성장율에 관심');
  assert.equal(d.accounts[2].proc, '조서번호 2100 2120');
  assert.deepEqual(d.accounts[1].asr, []);
  assert.deepEqual(d.accounts[0].asr, defaultAssertions('현금성자산'));
});

test('2301 — 올해 양식: 칸 자리, 쓰기(V 표시·빈 칸 비우기), 칸이 모자라면 줄 끼우기 계획', () => {
  const L = layout2301(NEW)!;
  assert.equal(L.asrCol.CO, 'E');
  assert.deepEqual([L.slotFrom, L.slotTo, L.endRow], [23, 28, 29]);
  const d = PAPER_2301.readBook!([OLD2301, OLD2302]);
  const e = new Map(PAPER_2301.write(NEW, d).map((x) => [x.ref, x]));
  assert.equal(e.get('B13')?.text, 'Y');
  assert.equal(e.get('M15')?.text, '특수관계자 파악');
  assert.equal(e.get('A25')?.text, '매출');
  assert.equal(e.get('B24')?.text, 'N/A');
  assert.equal(e.get('C24')?.clear, true);           // N/A 줄은 경영진주장 없음
  assert.equal(e.get('A26')?.clear, true);           // 남는 칸 비움
  assert.equal(e.has('P13'), false);                 // 수행절차 비었으면 양식 안내문 그대로
  const many = { ...d, accounts: Array.from({ length: 9 }, (_, i) => ({ ...d.accounts[0], label: `계정${i}` })) };
  assert.throws(() => PAPER_2301.write(NEW, many), /칸이 모자랍니다/);
});

test('2301 추천 — 부정·매출 규칙, 2120A 큰 변동, 양식 사례', () => {
  const lib = readLibrary(NEW);
  assert.equal(lib.length, 3);
  assert.deepEqual(casesFor('매출', lib).map((c) => c.asr), [['CO', 'O']]);
  const fraud = hintsFor({ label: '1. 부정으로 인한', sig: 'N', asr: [], basis: '', proc: '' }, 'entity', new Map(), lib);
  assert.equal(fraud[0].apply?.sig, 'Y');
  assert.equal(fraud[0].apply?.basis, FRAUD_BASIS);
  const rev = hintsFor({ label: '매출', sig: 'N', asr: [], basis: '일반적인 위험', proc: '' }, 'account', new Map(), lib);
  assert.equal(rev[0].apply?.sig, 'Y');
  assert.equal(hintsFor({ label: '매출원가', sig: 'N', asr: [], basis: '', proc: '' }, 'account', new Map(), lib).length, 0);
  const inv = hintsFor({ label: '재고자산', sig: 'N', asr: [], basis: '', proc: '' }, 'account', new Map([['재고자산', '+35%']]), lib);
  assert.equal(inv[0].kind, '2120A');
});
