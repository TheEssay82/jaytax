// 2301(일반·K-IFRS 2026) 재무제표 수준 위험 표 — 입력 칸·작성 예시, 옛 2301 판단 옮기기, 쓰기.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SheetData, CellValue } from './xlsxRead';
import { PAPER_2301G, layout2301G, readExamples } from './gwpPaper2301G';

const sheet = (name: string, cells: Record<string, CellValue>): SheetData => ({ name, cells: new Map(Object.entries(cells)) });
const t = (text: string): CellValue => ({ text });
const HEAD = (r: number) => ({
  [`B${r}`]: t('재무제표 수준의 중요왜곡표시위험'), [`C${r}`]: t('유의적인 위험인지 여부'), [`D${r}`]: t('해당하는 유의적 위험'),
  [`E${r}`]: t('경영진주장 수준의 위험 평가에 영향을 주는지 여부'), [`F${r}`]: t('재무제표에 미치는 전반적인 영향의 성격 및 규모 평가'),
  [`G${r}`]: t('관련 통제에 대한 업무팀의 이해를 요약 기재 또는 해당 조서 번호 기재'), [`H${r}`]: t('전반적인 대응'), [`I${r}`]: t('비고'),
});
const TPL = sheet('2301', {
  B2: t('2301 중요왜곡표시위험의 식별·평가 및 대응'), ...HEAD(10), ...HEAD(29),
  B31: t('경영진이 수기분개 … 과대계상할 위험'), C31: t('Y'), D31: t('부정'), E31: t('Y'), G31: t('2531A-XX'), H31: t('JE Test 시 관련 시나리오를 추가'),
  B32: t('특수관계자 거래 … 공시될 위험'), C32: t('Y'), D32: t('부정 및 오류'),
});

test('모양 — 두 줄 머리 아래 12~16행 다섯 줄이 입력 칸, 둘째 머리 아래는 작성 예시', () => {
  const L = layout2301G(TPL)!;
  assert.equal(L.from, 12);
  assert.equal(L.to, 16);
  assert.equal(L.cols.response, 'H');
  const ex = readExamples(TPL);
  assert.equal(ex.length, 2);
  assert.deepEqual([ex[0].sig, ex[0].kind, ex[0].affects, ex[0].control], ['Y', '부정', 'Y', '2531A-XX']);
  assert.deepEqual(PAPER_2301G.read(TPL).risks, []);
});

test('작년이 옛 2301(전체 재무제표 5개)이면 판단을 줄로 — 번호 떼고, 부정은 유의적·부정', () => {
  const old = sheet('2301', {
    A5: t('Ⅰ. 전체재무제표 수준'),
    A7: t('1. 부정으로 인한 전체재무제표 왜곡표시위험'), C7: t('Y'), G7: t('기준서240 문단27'),
    A8: t('2. 계속기업 존속가능성 의문'), C8: t('N'), G8: t('영업실적 양호'),
  });
  const d = PAPER_2301G.readBook!([old]);
  assert.deepEqual(d.risks.map((r) => [r.risk, r.sig, r.kind, r.affects, r.impact]), [
    ['부정으로 인한 전체재무제표 왜곡표시위험', 'Y', '부정', 'Y', '기준서240 문단27'],
    ['계속기업 존속가능성 의문', 'N', '', '', '영업실적 양호'],
  ]);
});

test('회사가 줄을 끼웠으면 글자가 있는 마지막 줄까지 칸', () => {
  const more = sheet('2301', { ...Object.fromEntries(TPL.cells), B12: t('a'), B18: t('f') });
  assert.equal(layout2301G(more)!.to, 18);
  assert.equal(PAPER_2301G.read(more).risks.length, 2);
});

test('쓰기 — 칸마다, 빈 줄은 비우고, 칸보다 많으면 막는다(줄 끼우기가 먼저)', () => {
  const x = { risk: '위험', sig: 'Y' as const, kind: '부정', affects: 'Y' as const, impact: '영향', control: '2531A', response: '대응', note: '' };
  const e = new Map(PAPER_2301G.write(TPL, { risks: [x] }).map((y) => [y.ref, y]));
  assert.equal(e.get('B12')?.text, '위험');
  assert.equal(e.get('H12')?.text, '대응');
  assert.equal(e.get('I12')?.clear, true);
  assert.equal(e.get('B13')?.clear, true);
  assert.equal(e.has('B17'), false);
  assert.equal(e.has('B31'), false);
  assert.throws(() => PAPER_2301G.write(TPL, { risks: Array.from({ length: 6 }, () => x) }), /칸이 모자랍니다/);
});
