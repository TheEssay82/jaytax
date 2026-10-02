// 열 끼우기 — 공유 수식 풀기·다른 시트 참조 밀기(정산표 이월, 2026-10-03).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unshareFormulas, shiftFormulaCols, moveRelative, mapRefs } from './xlsxCols';

test('공유 수식 — 딸린 칸(<f …/>)을 낱 수식으로, 다음 칸을 삼키지 않는다', () => {
  const x = '<row r="9"><c r="O9" s="14"><f t="shared" ref="O9:O10" si="0">(N9)-(J9)</f><v>0</v></c></row>'
    + '<row r="10"><c r="O10" s="14"><f t="shared" si="0"/><v>-2</v></c><c r="P10"><f>SUM(A1)</f></c></row>';
  assert.equal(unshareFormulas(x), '<row r="9"><c r="O9" s="14"><f>(N9)-(J9)</f><v>0</v></c></row>'
    + '<row r="10"><c r="O10" s="14"><f>(N10)-(J10)</f><v>-2</v></c><c r="P10"><f>SUM(A1)</f></c></row>');
});

test('열 끼우기 — 그 시트를 가리키는 참조만 민다(같은 시트는 앞 이름 없이도)', () => {
  assert.equal(shiftFormulaCols('SUMIF(WBS!$B$11:$B$97,F6,WBS!$S$11:$S$97)', '보고서BS', 'WBS', 16, 1), 'SUMIF(WBS!$B$11:$B$97,F6,WBS!$T$11:$T$97)');
  assert.equal(shiftFormulaCols('(S10)-(O10)', 'WBS', 'WBS', 16, 1), '(T10)-(O10)');
  assert.equal(shiftFormulaCols('(S10)-(O10)', 'WPL', 'WBS', 16, 1), '(S10)-(O10)');
  assert.equal(shiftFormulaCols("'A500_FY25'!E28+P5", 'WBS', 'WBS', 16, 1), "'A500_FY25'!E28+Q5");
  assert.equal(shiftFormulaCols('"P5"&P5', 'WBS', 'WBS', 16, 1), '"P5"&Q5');
});

test('mapRefs — 함수 이름·글자는 건드리지 않는다', () => {
  const seen: string[] = [];
  mapRefs('LOG10(A1)+ROUND(WPL!K85,0)+"B2"', (s, r) => { seen.push(`${s ?? ''}!${r}`); return r; });
  assert.deepEqual(seen, ['!A1', 'WPL!K85']);
  assert.equal(moveRelative('=-E15+$B$2+보고서PL!C49', -6, 0), '=-E9+$B$2+보고서PL!C43');
});
