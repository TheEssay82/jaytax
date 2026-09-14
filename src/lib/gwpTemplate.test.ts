import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { skipReason, readBundle, findTemplateSheet, templateCodes } from './gwpTemplate.ts';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
function xlsx(sheets: [string, string?][]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  files['[Content_Types].xml'] = strToU8('<Types/>');
  files['xl/workbook.xml'] = strToU8(`<workbook xmlns="${NS}" xmlns:r="${R}"><sheets>${sheets.map(([n, st], i) => `<sheet name="${n}" sheetId="${i + 1}"${st ? ` state="${st}"` : ''} r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`);
  sheets.forEach((_, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8('<worksheet><sheetData/></worksheet>'); });
  return zipSync(files);
}

test('뺄 파일', () => {
  assert.equal(skipReason('Section 1000 - 감사계약/1200_1200_감사계약(1200~1300).xlsx'), null);
  assert.equal(skipReason('Section 4000 - 계정별 입증감사절차/01.자산/A-0_현금.xlsx'), '4000 계정별(설계 밖)');
  assert.equal(skipReason('JE Test/JET_JET 조서_sample.xlsx'), 'JE Test(설계 밖)');
  assert.equal(skipReason('Section 4000 - 계정별 입증감사절차/sample 조서(아카이브전 삭제할 것)/A sample.xlsx'), '4000 계정별(설계 밖)');
  assert.equal(skipReason('Section 9000/(참고)내부회계관리제도감사 조서서식(예시)_사례(아카이브전 삭제).xlsx'), '참고·예시');
  assert.equal(skipReason('Section 2000 - 위험평가/2131A_질문서.docx'), '엑셀이 아님');
  assert.equal(skipReason('__MACOSX/._x.xlsx'), '시스템 파일');
  assert.equal(skipReason('Section 2000 - 위험평가/2302-1_매크로_2026.xlsm'), null);
});

test('묶음 읽기 — 파일·시트·코드, 뺀 파일은 까닭과 함께', () => {
  const zip = zipSync({
    'Section 1000 -  감사계약/1100_1100_업무조건의 합의.xlsx': xlsx([['1100(소규모)']]),
    'Section 2000 - 위험평가/2000_2000_위험평가_소규모_2026.xlsx': xlsx([['2100(소규모)'], ['2100A'], ['2110(소규모)'], ['수정목록', 'hidden']]),
    'Section 3000 - 위험에 대한 대응/3600B_질문서.docx': strToU8('x'),
    'Section 4000 -  계정별 실증절차/4000_INDEX.xlsx': xlsx([['4000']]),
    'Section 2000 - 위험평가/2302-2_안내서.pdf': strToU8('x'),
    'Section 2000 - 위험평가/': new Uint8Array(),
  });
  const { catalog, files } = readBundle(zip);
  assert.deepEqual(catalog.files, ['Section 1000 -  감사계약/1100_1100_업무조건의 합의.xlsx', 'Section 2000 - 위험평가/2000_2000_위험평가_소규모_2026.xlsx']);
  assert.equal(Object.keys(files).length, 2);
  assert.deepEqual(catalog.sheets.map((s) => [s.code, s.hidden]), [['1100', false], ['2100', false], ['2100A', false], ['2110', false], [null, true]]);
  assert.deepEqual(catalog.skipped, [{ file: 'Section 4000 -  계정별 실증절차/4000_INDEX.xlsx', why: '4000 계정별(설계 밖)' }]);
  assert.deepEqual(templateCodes(catalog), ['1100', '2100', '2100A', '2110']);
  assert.equal(findTemplateSheet(catalog, '2100')?.name, '2100(소규모)');
  assert.equal(findTemplateSheet(catalog, '2100')?.file, 'Section 2000 - 위험평가/2000_2000_위험평가_소규모_2026.xlsx');
  assert.equal(findTemplateSheet(catalog, '9999'), null);
});
