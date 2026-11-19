// 정산표 이월 — 시산표 읽기·줄 끼우기 참조(사용자 2026-10-03).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SheetData } from './xlsxRead';
import { tbFromSheet } from './wtbRoll';
import { shiftRowsInRef } from './xlsxCols';

test('더존 합계잔액시산표 — 부분·유동, 차변잔액 − 대변잔액, 머리 줄은 뺀다', () => {
  const cells = new Map<string, { text?: string; num?: number }>([
    ['A7', { text: '차    변' }], ['C7', { text: '계 정 과 목' }], ['D7', { text: '대    변' }],
    ['C9', { text: '<< 자          산 >>' }], ['C10', { text: '[ 유  동    자  산 ]' }],
    ['A12', { num: 3495683 }], ['C12', { text: '보통예금' }],
    ['C26', { text: '[ 비  유 동  자 산 ]' }], ['C34', { text: '감가상각누계액' }], ['E34', { num: 321810611 }],
    ['C49', { text: '<< 부          채 >>' }], ['C62', { text: '장기차입금' }], ['E62', { num: 25000000000 }],
    ['C73', { text: '<< 손          익 >>' }], ['C75', { text: '임대매출(신사동)' }], ['E75', { num: 752000000 }],
    ['C114', { text: '합      계' }], ['A114', { num: 1 }],
  ]);
  const tb = tbFromSheet({ name: '시산표', cells } as unknown as SheetData);
  assert.deepEqual(tb.map((t) => [t.name, t.section, t.current, t.bal]), [
    ['보통예금', '자산', true, 3495683],
    ['감가상각누계액', '자산', false, -321810611],
    ['장기차입금', '부채', true, -25000000000],
    ['임대매출(신사동)', '손익', undefined, -752000000],
  ]);
});

test('줄 끼우기 — 다른 시트의 범위: 뒤는 밀고, 끼운 줄 바로 위에서 끝나는 범위는 늘린다', () => {
  assert.equal(shiftRowsInRef('$B$11:$B$97', 13, 1), '$B$11:$B$98');
  assert.equal(shiftRowsInRef('$B$11:$B$13', 13, 1), '$B$11:$B$14');
  assert.equal(shiftRowsInRef('J85', 13, 1), 'J86');
  assert.equal(shiftRowsInRef('J5', 13, 1), 'J5');
});

test('재무제표 시트 — 들여 쓴 계정 줄만, 안쪽 열 먼저, 차감 계정은 음수, 부채·수익은 시산표 부호로', async () => {
  const { fsFromSheet } = await import('./wtbRoll');
  const bs = new Map<string, { text?: string; num?: number }>([
    ['A8', { text: '과    목' }], ['B8', { text: '제 11 (당)기' }], ['D8', { text: '제 10 (전)기' }],
    ['A10', { text: ' 자             산 ' }], ['A11', { text: ' Ⅰ. 유  동    자  산  ' }], ['C11', { num: 100 }],
    ['A13', { text: '      보통예금' }], ['C13', { num: 3495683 }],
    ['A27', { text: ' Ⅱ. 비  유  동  자  산  ' }],
    ['A33', { text: '      건물' }], ['B33', { num: 2913327108 }],
    ['A34', { text: '      감가상각누계액' }], ['B34', { num: 321810611 }], ['C34', { num: 2591516497 }],
    ['A50', { text: ' 부             채 ' }], ['A63', { text: '      장기차입금' }], ['C63', { num: 25000000000 }],
    ['A67', { text: '부    채    총    계' }], ['C67', { num: 1 }],
  ]);
  const t = fsFromSheet({ name: '재무상태표', cells: bs } as unknown as SheetData, 'BS').filter((x) => !x.subtotal);   // 합계 줄은 표시만 하고 묻지 않는다
  assert.deepEqual(t.map((x) => [x.name, x.section, x.current, x.bal]), [
    ['보통예금', '자산', true, 3495683], ['건물', '자산', false, 2913327108], ['감가상각누계액-건물', '자산', false, -321810611],
    ['장기차입금', '부채', true, -25000000000],
  ]);
  const pl = new Map<string, { text?: string; num?: number }>([
    ['A7', { text: '과목' }], ['B7', { text: '제 11 (당)기' }],
    ['A9', { text: 'Ⅰ  . 매      출      액' }], ['C9', { num: 1 }], ['A10', { text: '      임대매출(신사동)' }], ['B10', { num: 752000000 }],
    ['A28', { text: 'Ⅳ  . 판  매  관  리  비' }], ['A29', { text: '      직원급여' }], ['B29', { num: 100533336 }],
  ]);
  assert.deepEqual(fsFromSheet({ name: '손익계산서', cells: pl } as unknown as SheetData, 'PL').map((x) => [x.name, x.bal]), [['임대매출(신사동)', -752000000], ['직원급여', 100533336]]);
});

test('손익계산서 — 매출액 아래 양수로 적힌 매출할인·에누리와환입은 차감(차변 잔액)', async () => {
  const { fsFromSheet } = await import('./wtbRoll');
  const pl = new Map<string, { text?: string; num?: number }>([
    ['A7', { text: '과목' }], ['B7', { text: '제 13 (당)기' }],
    ['A9', { text: 'Ⅰ  . 매      출      액' }], ['C9', { num: 1 }],
    ['A10', { text: '      상품매출' }], ['B10', { num: 7014930299 }],
    ['A11', { text: '      상품매출에누리와환입' }], ['B11', { num: 203008640 }],
    ['A12', { text: '      매출할인' }], ['B12', { num: 278652549 }],
    ['A20', { text: 'Ⅴ  . 영  업  외  수  익' }], ['A21', { text: '      대손충당금환입' }], ['B21', { num: 5000 }],
  ]);
  assert.deepEqual(fsFromSheet({ name: '손익계산서', cells: pl } as unknown as SheetData, 'PL').map((x) => [x.name, x.bal]),
    [['상품매출', -7014930299], ['상품매출에누리와환입', 203008640], ['매출할인', 278652549], ['대손충당금환입', -5000]]);
});

test('더존 재무상태표 — 양수로 적힌 평가충당금·손상차손누계액·국고보조금(자산)·전환권조정·미처리결손금은 차감', async () => {
  const { fsFromSheet } = await import('./wtbRoll');
  const bs = new Map<string, { text?: string; num?: number }>([
    ['A7', { text: '과    목' }], ['B7', { text: '제 13 (당)기' }], ['D7', { text: '제 12 (전)기' }],
    ['A9', { text: ' 자             산 ' }], ['A10', { text: ' Ⅰ. 유  동    자  산  ' }], ['C10', { num: 1 }],
    ['A11', { text: '      제    품' }], ['B11', { num: 1309767431 }],
    ['A12', { text: '      제품 평가 충당금' }], ['B12', { num: 43089990 }], ['D12', { num: 43089990 }],
    ['A13', { text: ' Ⅱ. 비  유  동  자  산  ' }], ['C13', { num: 1 }],
    ['A14', { text: '      매도가능증권손상차손누계액' }], ['B14', { num: 27540000 }],
    ['A15', { text: '      기 계 장 치' }], ['B15', { num: 1797943961 }],
    ['A16', { text: '      국고보조금(기 계)' }], ['B16', { num: 35444573 }],
    ['A20', { text: ' 부             채 ' }], ['A21', { text: ' Ⅰ. 유  동    부  채  ' }], ['C21', { num: 1 }],
    ['A22', { text: '      전 환 사 채' }], ['B22', { num: 3166640000 }],
    ['A23', { text: '      전 환 권 조 정' }], ['B23', { num: 2462348885 }],
    ['A30', { text: ' 자             본 ' }], ['A31', { text: '      미 처 리 결 손 금' }], ['B31', { num: 24433582632 }],
  ]);
  assert.deepEqual(fsFromSheet({ name: '재무상태표', cells: bs } as unknown as SheetData, 'BS').filter((x) => !x.subtotal).map((x) => [x.name.replace(/\s/g, ''), x.bal, x.prior]), [
    ['제품', 1309767431, undefined], ['제품평가충당금', -43089990, -43089990],
    ['매도가능증권손상차손누계액', -27540000, undefined], ['기계장치', 1797943961, undefined], ['국고보조금(기계)', -35444573, undefined],
    ['전환사채', -3166640000, undefined], ['전환권조정', 2462348885, undefined],
    ['미처리결손금', 24433582632, undefined],
  ]);
});

test('검증표 칸 계산기 — 캐시 값 대신 수식대로(SUM·사칙연산·다른 시트·ROUND)', async () => {
  const { makeEval } = await import('./wtbCheck');
  const s = (name: string, c: [string, { num?: number; formula?: string }][]) => ({ name, cells: new Map(c) }) as unknown as SheetData;
  const ev = makeEval([
    s('WPL', [['N4', { num: 100 }], ['N5', { num: -20 }], ['N3', { formula: 'SUM(N4:N5)', num: 999 }], ['N6', { formula: 'N3*2-(N5)/4' }], ['N7', { formula: "ROUND(WBS!$A$1*0.5%,-1)" }], ['N8', { formula: 'VLOOKUP(N4,A:B,2,0)' }]]),
    s('WBS', [['A1', { num: 12345 }]]),
  ]);
  assert.equal(ev('WPL', 'N3'), 80);
  assert.equal(ev('WPL', 'N6'), 165);
  assert.equal(ev('WPL', 'N7'), 60);
  assert.equal(ev('WPL', 'N8'), null);
});

test('재무제표 시트 — 들여쓰기 없는 프로그램, VAT 같은 영문 계정 이름', async () => {
  const { fsFromSheet } = await import('./wtbRoll');
  const bs = new Map<string, { text?: string; num?: number }>([
    ['A1', { text: '계정과목' }], ['B1', { text: '당기' }],
    ['A2', { text: '자산' }], ['A3', { text: 'I. 유동자산' }], ['B3', { num: 9 }],
    ['A4', { text: '보통예금' }], ['B4', { num: 5 }], ['A5', { text: 'VAT대급금' }], ['B5', { num: 4 }],
    ['A6', { text: '부채' }], ['A7', { text: '미지급금' }], ['B7', { num: 9 }],
  ]);
  assert.deepEqual(fsFromSheet({ name: 'BS', cells: bs } as unknown as SheetData, 'BS').map((x) => [x.name, x.section, x.bal]),
    [['보통예금', '자산', 5], ['VAT대급금', '자산', 4], ['미지급금', '부채', -9]]);
});

test('ERP 재무제표(아비즈) — 번호 층층, 쪽 머리 되풀이, 번호 없는 차감 줄, 글자 금액, 전기 금액', async () => {
  const { fsFromSheet } = await import('./wtbRoll');
  const c = new Map<string, { text?: string; num?: number }>([
    ['B8', { text: '계정과목' }], ['D8', { text: '당기' }], ['H8', { text: '전기' }],
    ['B9', { text: '  I. 자산' }], ['F9', { text: '18,820,234,557' }],
    ['B10', { text: '    (1) 유동자산' }], ['B11', { text: '      1. 당좌자산' }],
    ['B12', { text: '        1) 미수금' }], ['D12', { text: '4,188,690' }],
    ['B13', { text: '          1. 미수금' }], ['D13', { text: '37,481,201' }], ['H13', { text: '273,666,602' }],
    ['B14', { text: '               세금과공과 면허세' }], ['D14', { text: '33,292,511' }], ['H14', { text: '33,292,511' }],
    ['B43', { text: '재무상태표' }], ['B49', { text: '계정과목' }], ['D49', { text: '당기' }],
    ['B50', { text: '        2) 선급금' }], ['D50', { text: '274,972,286' }],
    ['B51', { text: '          1. 선급금' }], ['D51', { text: '274,972,286' }], ['H51', { text: '197,175,193' }],
    ['B60', { text: '  II. 부채' }], ['B61', { text: '    (1) 유동부채' }], ['B62', { text: '      1. 미지급금' }],
    ['B63', { text: '        1) 미지급금' }], ['D63', { text: '(1,000)' }],
  ]);
  const t = fsFromSheet({ name: '재무상태표', cells: c } as unknown as SheetData, 'BS', 'BS');
  assert.deepEqual(t.map((x) => [x.name, x.section, x.bal, x.prior]), [
    ['미수금', '자산', 37481201, 273666602],
    ['세금과공과 면허세(차감 — 미수금)', '자산', -33292511, -33292511],
    ['선급금', '자산', 274972286, 197175193],
    ['미지급금', '부채', 1000, undefined],
  ]);
});

test('표 머리 — 날짜가 위 줄, 「제 23 기 | DR | CR」가 아래 줄인 틀(에스씨티)도 읽는다', async () => {
  const { readLayout } = await import('./wtbRoll');
  const c = (text?: string, num?: number, formula?: string) => ({ text, num, formula });
  const cells: [string, ReturnType<typeof c>][] = [
    ['N5', c(undefined, 45657)], ['O5', c(undefined, 46022)], ['P5', c('수정사항')], ['R5', c(undefined, 46022, 'O5')],
    ['A6', c('과목')], ['C6', c('DART과목')], ['N6', c('제 22 기')], ['O6', c('제 23 기')], ['P6', c('DR')], ['Q6', c('CR')], ['R6', c('제 23 기', undefined, 'O6')], ['S6', c('증감액')], ['T6', c('증감율')],
    ['A7', c('자산')], ['A10', c('현금')], ['C10', c('현금및현금성자산')], ['N10', c(undefined, 5)], ['O10', c(undefined, 7)], ['R10', c(undefined, 7, 'O10+P10-Q10')],
  ];
  const L = readLayout({ name: 'WBS', cells: new Map(cells) } as unknown as SheetData);
  assert.ok(L);
  assert.equal(L.cur, 15);
  assert.equal(L.yearRow, 5);
  assert.equal(L.termRow, 6);
  assert.equal(L.curYear, 2025);
  assert.equal(L.curTerm, 23);
  assert.equal(L.history.get(2024), 14);
  assert.deepEqual(L.accounts, [10]);
});

test('더존 재무상태표(더그림 2026-09) — 같은 이름 감가상각누계액은 위 자산 이름을 달고, 자산 쪽 퇴직연금운용자산은 차감이 아니며, 금액 있는 줄은 머리가 아니다', async () => {
  const { fsFromSheet, netIncomeOf } = await import('./wtbRoll');
  const bs = new Map<string, { text?: string; num?: number }>([
    ['A8', { text: '과    목' }], ['B8', { text: '제 10 (당)기' }], ['D8', { text: '제 9 (전)기' }],
    ['A10', { text: ' 자             산 ' }], ['A37', { text: ' Ⅱ. 비  유  동  자  산  ' }],
    ['A38', { text: ' (1) 투  자    자  산  ' }], ['C38', { num: 155415159 }],
    ['A40', { text: '      지분법적용투자주식' }], ['C40', { num: 34517110 }],
    ['A41', { text: '        퇴직연금운용자산' }], ['C41', { num: 120898049 }],
    ['A42', { text: ' (2) 유  형    자  산  ' }], ['C42', { num: 1 }],
    ['A43', { text: '      기계장치' }], ['B43', { num: 11160000 }],
    ['A44', { text: '      감가상각누계액' }], ['B44', { num: 372000 }], ['C44', { num: 10788000 }],
    ['A45', { text: '      차량운반구' }], ['B45', { num: 73803280 }],
    ['A46', { text: '      감가상각누계액' }], ['B46', { num: 70727394 }], ['C46', { num: 3075886 }],
    ['A50', { text: ' 부             채 ' }], ['A51', { text: ' Ⅱ. 비  유  동  부  채  ' }],
    ['A52', { text: '      퇴직급여충당부채' }], ['B52', { num: 1691195304 }],
    ['A53', { text: '      퇴직연금운용자산' }], ['B53', { num: 1691195304 }], ['C53', { num: 0 }],
  ]);
  const t = fsFromSheet({ name: '재무상태표', cells: bs } as unknown as SheetData, 'BS').filter((x) => !x.subtotal);
  assert.deepEqual(t.map((x) => [x.name, x.section, x.bal]), [
    ['지분법적용투자주식', '자산', 34517110], ['퇴직연금운용자산', '자산', 120898049],
    ['기계장치', '자산', 11160000], ['감가상각누계액-기계장치', '자산', -372000],
    ['차량운반구', '자산', 73803280], ['감가상각누계액-차량운반구', '자산', -70727394],
    ['퇴직급여충당부채', '부채', -1691195304], ['퇴직연금운용자산', '부채', 1691195304],
  ]);
  // 손익계산서 — 영업외수익의 국고보조금은 수익(차감 아님), 순이익은 「당기순손실」 줄에서
  const pl = new Map<string, { text?: string; num?: number }>([
    ['A7', { text: '과목' }], ['B7', { text: '제 10 (당)기' }],
    ['A8', { text: 'Ⅰ. 매  출  액' }], ['C8', { num: 1000 }], ['A9', { text: '      상품매출' }], ['B9', { num: 1000 }],
    ['A10', { text: 'Ⅱ. 매  출  원  가' }], ['C10', { num: 900 }],
    ['A11', { text: '    상품매출원가' }], ['C11', { num: 900 }],
    ['A12', { text: '      기초 상품 재고액' }], ['B12', { num: 500 }], ['A13', { text: '      당기 상품 매입액' }], ['B13', { num: 800 }],
    ['A14', { text: '      기말 상품 재고액' }], ['B14', { num: 400 }],
    ['A15', { text: 'Ⅵ. 영  업  외  수  익' }], ['C15', { num: 30 }], ['A16', { text: '      국고보조금' }], ['B16', { num: 30 }],
    ['A17', { text: 'Ⅹ. 당  기  순  이  익' }], ['C17', { num: 130 }],
  ]);
  const p = fsFromSheet({ name: '손익계산서', cells: pl } as unknown as SheetData, 'PL');
  assert.equal(p.find((x) => x.name === '국고보조금')?.bal, -30);
  assert.equal(netIncomeOf(p), 130);
  assert.equal(netIncomeOf(p.filter((x) => !x.subtotal)), 130);   // 순이익 줄이 없으면 더하되 기말재고는 뺀다
});
