// 중요성 웹 조서 — 옛 모양 읽기(명진 FY25), 올해 양식 읽기·쓰기, 전기 DSD 금액, 적용률 추천.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SheetData, CellValue } from './xlsxRead';
import {
  read2700, write2700, amountsFromFs, suggestLevel, suggestRate, computedMateriality, PAPER_2700A_1, emptyMateriality,
} from './gwpPaper2700A';
import type { FsLine } from './fsParse';

const sheet = (name: string, cells: Record<string, CellValue>): SheetData => ({ name, cells: new Map(Object.entries(cells)) });
const t = (text: string): CellValue => ({ text });
const n = (num: number): CellValue => ({ num });

// 명진 FY25 2700A-2(소규모) 모양
const OLD = sheet('2700A-2(소규모)', {
  A12: t('2) 회계기간'), C12: t('제 18기 2025년 1월 1일 ～ 2025년 12월 31일'), A13: t('3) 상장여부'), C13: t('일반외감'),
  B15: t('① 자산총액'), D15: n(24486), E15: t('⑤ 당기손익'), G15: n(-229),
  B16: t('② 매출액'), D16: n(918), E16: t('⑥ 세전손익'), G16: n(-229),
  B17: t('③ 자기자본'), D17: n(3190),
  A21: t('1) 선택 기준'), E21: t('총자산'), B23: t('근거'), B24: t('보유자산이 중요'),
  A27: t('2) 백분율'), G27: n(0.03), B28: t('근거'), B29: t('감사RISK 낮음'),
  A32: t('3) 중요성 금액 산정액'), G32: { formula: 'G22*G27', num: 734.58 },
  A34: t('3. 수행 중요성'), A35: t('1) 삭감 비율'), G35: n(0.25), B36: t('근거'), B37: t('75% 수준'),
  A42: t('4. 명백하게 사소한 중요성 수준'), A43: t('1) 산정 비율'), G43: n(0.05), B46: t('근거'), B47: t('최대치'),
});

// 2026 양식 2700A-2(감사계획단계) 모양
const NEW = sheet('2700A-2(감사계획단계)', {
  A12: t('2) 회계기간'), C12: t('제 기 2020년 1월 1일 ～ 2020년 12월 31일'), A13: t('3) 상장여부'), C13: t('유가증권상장'),
  B18: t('Benchmark'), C18: t('회사제시금액 (백만원)'), D18: t('적용율 지침'), F18: t('적용금액의 범위(백만원)'), I18: t('적용여부'), J18: t('적용비율'), K18: t('적용할 중요성금액'),
  B20: t('세전계속사업이익'), C20: n(47376), D20: n(0.05), E20: n(0.1), I20: t('적용'), J20: n(0.05),
  B21: t('매출액(*)'), C21: n(211034), I21: t('미적용'),
  B22: t('총자산'), C22: n(294016), I22: t('미적용'),
  B23: t('순자산'), C23: n(144947), I23: t('미적용'),
  I28: t('적용할 중요성 기준(Benchmark)'), K28: t('세전계속사업이익'),
  I29: t('결정된 중요성 금액(백만원)'), K29: n(2400),
  B31: t('근거'), B32: t('(예시) - 회사는 상장 영리기업'),
  B39: t('계속감사시 전기와 다른 Benchmark 및 적용율을 적용한 경우 변경 근거'), B40: t('(예시) - 전기까지는'),
  A43: t('3. 수행 중요성 (Performance materiality)'), I51: t('전체 중요성에 대한 적용비율'), K51: n(0.75), B56: t('근거'), B57: t('과거 감사경험상'),
  A61: t('4. 명백하게 경미한 중요성 수준 (Clearly Trivial threshold)'), I65: t('전체 중요성에 대한 적용비율'), K65: n(0.05), B70: t('근거'), B71: t('최대치로'),
});

test('중요성 — 옛 모양(명진 FY25)을 읽는다: 자기자본=순자산, 삭감 25% → 수행 75%, 근거 둘을 잇는다', () => {
  const d = read2700(OLD);
  assert.deepEqual(d.amounts, { 세전계속사업이익: -229, 매출액: 918, 총자산: 24486, 순자산: 3190 });
  assert.equal(d.bench, '총자산');
  assert.equal(d.rate, 0.03);
  assert.equal(d.materiality, 735);
  assert.equal(d.reason, '보유자산이 중요\n감사RISK 낮음');
  assert.equal(d.pmRate, 0.75);
  assert.equal(d.pmReason, '75% 수준');
  assert.equal(d.ctRate, 0.05);
  assert.equal(d.listed, '일반외감');
});

test('중요성 — 올해 양식을 읽는다: 견본 글자((예시)·제 기 2020년)는 버린다', () => {
  const d = read2700(NEW);
  assert.equal(d.bench, '세전계속사업이익');
  assert.equal(d.rate, 0.05);
  assert.equal(d.materiality, 2400);
  assert.equal(d.reason, '');
  assert.equal(d.changeReason, '');
  assert.equal(d.period, '');
  assert.equal(d.pmReason, '과거 감사경험상');
  assert.equal(d.ctRate, 0.05);
});

test('중요성 — 올해 양식에 쓴다: 적용/미적용, 적용비율은 고른 줄만, 범위 칸은 수식', () => {
  const d = { ...read2700(OLD), period: '제19기 2026년 1월 1일 ～ 2026년 12월 31일' };
  const e = new Map(write2700(NEW, d).map((x) => [x.ref, x]));
  assert.equal(e.get('C22')?.num, 24486);
  assert.equal(e.get('I22')?.text, '적용');
  assert.equal(e.get('I20')?.text, '미적용');
  assert.equal(e.get('J22')?.num, 0.03);
  assert.equal(e.get('J20')?.clear, true);
  assert.equal(e.get('F22')?.formula, '$C22*D22');
  assert.equal(e.get('K22')?.formula, 'IFERROR(C22*J22,0)');
  assert.equal(e.get('K28')?.text, '총자산');
  assert.equal(e.get('K29')?.formula, 'K22');                  // 적용한 줄(총자산)의 금액에 링크
  assert.equal(e.get('B32')?.text, '보유자산이 중요\n감사RISK 낮음');
  assert.equal(e.get('K51')?.num, 0.75);
  assert.equal(e.get('B71')?.text, '최대치');
  assert.equal(e.get('C12')?.text, '제19기 2026년 1월 1일 ～ 2026년 12월 31일');
});

test('중요성 — 옛 모양에는 쓰지 않는다(올해 양식으로 갈아끼운 뒤에)', () => {
  assert.throws(() => write2700(OLD, emptyMateriality()), /올해 양식 모양이 아닙니다/);
});

test('전기 DSD → 기준 금액(백만원 반올림)', () => {
  const L = (statement: string, label: string, cur: number): FsLine => ({ statement, label, notes: [], cur, level: 0, at: 0 });
  const got = amountsFromFs([
    L('재무상태표', '자 산 총 계', 24_486_123_456), L('재무상태표', '자본총계', 3_190_400_000),
    L('손익계산서', 'Ⅰ. 매출액', 918_300_000), L('손익계산서', 'Ⅴ.법인세비용차감전순손실', -229_600_000),
  ], '원');
  assert.deepEqual(got, { 총자산: 24486, 순자산: 3190, 매출액: 918, 세전계속사업이익: -230 });
  assert.equal(amountsFromFs([L('재무상태표', '자산총계', 24_486_123)], '천원').총자산, 24486);
});

test('적용률 추천 — 낮은 요소가 하나라도 있으면 낮게(하한), 모두 높으면 상한, 아니면 평균', () => {
  const f = (...ls: ('낮은' | '중간' | '높은' | '')[]) => ls.map((level, i) => ({ label: String(i), level, reason: '' }));
  assert.equal(suggestLevel(f('높은', '낮은', '중간')), '낮은');
  assert.equal(suggestLevel(f('높은', '높은')), '높은');
  assert.equal(suggestLevel(f('높은', '중간')), '중간');
  assert.equal(suggestLevel(f('', '')), '');
  assert.equal(suggestRate('총자산', '낮은'), 0.01);
  assert.equal(suggestRate('총자산', '중간'), 0.02);
  assert.equal(suggestRate('매출액', '중간'), 0.019);
  const m = computedMateriality({ ...emptyMateriality(), amounts: { ...emptyMateriality().amounts, 총자산: 24486 }, bench: '총자산', rate: 0.03 })!;
  assert.ok(Math.abs(m - 734.58) < 1e-9);
});

test('2700A-1 — 고려요소를 읽고 쓴다(기타 둘째 줄은 「기타(2)」)', () => {
  const s = sheet('2700A-1(적용지침)', {
    C38: t('구분'), D38: t('백분율 적용'), E38: t('고려 요소 예시'),
    C39: t('이해관계자의 범위와 정도'), D39: t('높은 수준 적용율'), D40: t('판단근거'), E40: t('비상장'),
    C45: t('기타'), D45: t('낮은 수준 적용율'), D46: t('판단근거'), E46: t('최대주주 변경'),
    D47: t('높은 수준 적용율'), D48: t('판단근거'), E48: t('그룹 지원 없음'),
    C49: t('추가고려요소'),
  });
  const d = PAPER_2700A_1.read(s);
  assert.deepEqual(d.factors.map((f) => [f.label, f.level, f.reason]), [
    ['이해관계자의 범위와 정도', '높은', '비상장'], ['기타', '낮은', '최대주주 변경'], ['기타(2)', '높은', '그룹 지원 없음'],
  ]);
  const e = new Map(PAPER_2700A_1.write(s, { ...d, factors: d.factors.map((f, i) => (i === 0 ? { ...f, level: '중간' } : f)), extra: '없음' }).map((x) => [x.ref, x]));
  assert.equal(e.get('D39')?.text, '중간 수준 적용율');
  assert.equal(e.get('E49')?.text, '없음');
  assert.ok(PAPER_2700A_1.pick!([s]) === s);
});
