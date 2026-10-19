// ERP 엑셀 읽기 — 2026-10-19 인덕 ERP 에서 바로 받은 상세·리스트 엑셀의 머리글 그대로.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExpenseRows, parseVoucherRows, erpDetailXlsUrl, periodLabel, fyRange } from './expenseParse';

test('ERP 상세검색 엑셀(xls_exgl_find_list) — 코드 칸까지 읽고 합계 줄은 버린다', () => {
  const raw = [
    ['검색결과 지출결의서 상세리스트'], ['회사명 : 인덕회계법인'],
    ['지출결의서 번호', '증빙유형', '라인번호', '증빙일자', '제목', '지출내역', '계정과목코드(차변)', '계정과목(차변)', '거래처코드', '거래처명', '공급가액', '세액', '합계', '거래전표번호', '회계전표번호', '라인사원코드', '라인사원명', '라인부서코드', '라인부서명', '전자결재번호', '결재여부', '증빙'],
    ['26-0414-0029', '과세신용카드', 1, '2026-03-18', '신용카드 사용내역', '야근 식대(기장팀)', '81100', '복리후생비', '04422', '한국정보통신(PG사)', 61500, 0, 61500, '', '26-0318-0094', '202410017', '송현주', '0205', '2본부5팀', '26-0414-0056', '결재', '1건'],
    ['', '합계', '', '', '', '', '', '', '', '', 61500, 0, 61500],
  ];
  const r = parseExpenseRows(raw)!;
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].exjunpyoNo, r[0].lineNo, r[0].evidDate, r[0].cardType, r[0].evidType, r[0].accountCode, r[0].vendorCode, r[0].empCode, r[0].writer, r[0].supply],
    ['26-0414-0029', 1, '2026-03-18', '법카', '과세신용카드', '81100', '04422', '202410017', '송현주', 61500]);
});

test('ERP 지출결의서번호별리스트 — 결의서 머리', () => {
  const v = parseVoucherRows([
    ['지출결의서번호별리스트'], ['회사명 : 인덕회계법인'],
    ['지출결의서번호', '자금집행예정일자', '작성자', '작성부서', '제목', '거래처명', '금액', '거래전표번호', '회계전표번호', '결재여부', '전자결재번호', '결재진행상태'],
    ['25-0915-0026', '2025-10-31', '송현주', '2본부5팀', '개인카드 해외결제(25년 9월)', '송현주(2본부5팀)', 183480, '', '25-0904-0284', '결재', '25-0915-0028', '최종결재완료'],
    ['합 계', '', '', '', '', '', 183480],
  ])!;
  assert.equal(v.length, 1);
  assert.deepEqual([v[0].planDate, v[0].approvalStatus, v[0].amount], ['2025-10-31', '최종결재완료', 183480]);
});

test('기간 표기와 ERP 주소 — 연도 없이 기간만', () => {
  assert.equal(periodLabel(2026), '2025.07.01 ~ 2026.06.30');
  assert.deepEqual(fyRange(2026), { from: '2025-07-01', to: '2026-06-30' });
  const u = new URL(erpDetailXlsUrl('송현주', 2026));
  assert.equal(u.searchParams.get('CreaterName'), '송현주');
  assert.equal(u.searchParams.get('exglFromDate'), '2025-07-01');
  assert.equal(u.searchParams.get('exglToDate'), '2026-06-30');
});
