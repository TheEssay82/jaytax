// 팀결산 경비 귀속 — 산출물 엑셀. 작성자 한 사람마다 「ERP경비반영분_정리_{이름}_{시작}~{끝}_{yymmdd}.xlsx」(연도 표기 없이 기간만).
// 모양은 지금까지 팀결산에 내던 파일(2026-10-19 송현주 정리본)과 같다:
//   시트1 지출결의서번호별리스트 · 시트2 검색결과 지출결의서 상세리스트(+ 개인/법카 · 클라이언트명 · 업무사용 · 개인사용 · 비고) · 아래 기장 집계.
import { FONT, FONT_BOLD, FONT_TITLE, FILL_HEADER, FILL_TOTAL, BORDER_ALL, setWidths, saveWorkbook } from './confirmExcelStyle';
import { fyRange, basketOf } from './expenseParse';
import type { ExpenseLine, ExpenseVoucher } from './expenseApi';

async function loadExcelJS() {
  const mod = await import('exceljs');
  const ns = (mod as unknown as { default?: unknown }).default ?? mod;
  return ns as typeof import('exceljs');
}

const AC: Record<string, number> = { 복리후생비: 81100, 여비교통비: 81200, 기업업무추진비: 81300, 세금과공과금: 81700, 차량유지비: 82200, 교육훈련비: 82500, 도서인쇄비: 82600, 소모품비: 83000, 지급수수료: 83100, 통신비: 81400, 회의비: 81900 };
const EMP: Record<string, string> = { 송현주: '202410017', 정우철: '201310005' };
const NUM = '#,##0';

export function exportFileName(fy: number, writer: string, today = new Date()) {
  const { from, to } = fyRange(fy);
  const d = `${String(today.getFullYear()).slice(2)}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  // 연도(FY) 표기는 넣지 않는다 — 기간만(사용자 2026-10-19).
  return `ERP경비반영분_정리_${writer}_${from.replace(/-/g, '')}~${to.replace(/-/g, '')}_${d}.xlsx`;
}

export async function exportWriterXlsx(fy: number, writer: string, lines: ExpenseLine[], vouchers: Map<string, ExpenseVoucher>): Promise<void> {
  const wb = await buildWriterWorkbook(writer, lines, vouchers);
  await saveWorkbook(wb, exportFileName(fy, writer));
}

/** 산출물 통합문서를 만든다(저장은 따로 — 시험에서 파일로 쓰려고). */
export async function buildWriterWorkbook(writer: string, lines: ExpenseLine[], vouchers: Map<string, ExpenseVoucher>) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const box = (c: import('exceljs').Cell) => { c.border = BORDER_ALL; c.font = c.font?.bold ? c.font : FONT; };

  // ── 시트1 결의서 목록 ──
  const nos = [...new Set(lines.map((l) => l.exjunpyo_no))].sort().reverse();
  const s1 = wb.addWorksheet('지출결의서번호별리스트');
  s1.mergeCells('A1:L1'); s1.getCell('A1').value = '지출결의서번호별리스트'; s1.getCell('A1').font = FONT_TITLE;
  s1.getCell('A2').value = '회사명 : 인덕회계법인 | 상태 : 전체 '; s1.getCell('A2').font = FONT;
  const h1 = ['지출결의서번호', '자금집행예정일자', '작성자', '작성부서', '제목', '거래처명', '금액', '거래전표번호', '회계전표번호', '결재여부', '전자결재번호', '결재진행상태'];
  s1.getRow(3).values = h1;
  s1.getRow(3).eachCell((c) => { c.font = FONT_BOLD; c.fill = FILL_HEADER; c.border = BORDER_ALL; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  let r = 4;
  for (const no of nos) {
    const ls = lines.filter((l) => l.exjunpyo_no === no);
    const v = vouchers.get(no);
    const vendors = [...new Set(ls.map((l) => l.vendor).filter(Boolean))];
    const slips = ls.map((l) => l.acct_slip).filter(Boolean) as string[];
    const invs = ls.map((l) => l.inv_slip).filter(Boolean) as string[];
    const row = s1.getRow(r);
    row.values = [
      no, v?.plan_date ?? '', v?.writer ?? writer, v?.dept ?? '2본부5팀', v?.title ?? ls[0]?.title ?? '',
      v?.vendor_summary ?? (vendors.length > 1 ? `${vendors[0]}외${vendors.length - 1}건` : vendors[0] ?? ''),
      v?.amount ?? ls.reduce((s, l) => s + l.total, 0),
      v?.inv_slip ?? (invs.length > 1 ? `${invs[0]}외${invs.length - 1}건` : invs[0] ?? ''),
      v?.acct_slip ?? (slips.length > 1 ? `${slips[0]}(외 ${slips.length - 1}건)` : slips[0] ?? ''),
      v?.approval ?? '결재', v?.wf_no ?? ls[0]?.wf_no ?? '', v?.approval_status ?? '최종결재완료',
    ];
    row.eachCell({ includeEmpty: true }, (c, i) => { if (i <= 12) box(c); });
    row.getCell(7).numFmt = NUM;
    r++;
  }
  s1.mergeCells(`A${r}:F${r}`); s1.getCell(`A${r}`).value = '합 계';
  s1.getCell(`G${r}`).value = { formula: `SUM(G4:G${r - 1})` }; s1.getCell(`G${r}`).numFmt = NUM;
  for (let c = 1; c <= 12; c++) { const cell = s1.getRow(r).getCell(c); cell.font = FONT_BOLD; cell.fill = FILL_TOTAL; cell.border = BORDER_ALL; }
  setWidths(s1, [14, 14, 9, 11, 26, 26, 13, 18, 22, 9, 14, 13]);

  // ── 시트2 상세 + 판단 ──
  const s2 = wb.addWorksheet('검색결과 지출결의서 상세리스트');
  const hasSplit = lines.some((l) => l.split_kjs || l.split_jhg);
  const last = hasSplit ? 28 : 26;
  s2.mergeCells(1, 1, 1, 21); s2.getCell('A1').value = '검색결과 지출결의서 상세리스트'; s2.getCell('A1').font = FONT_TITLE;
  s2.getCell('A2').value = '회사명 : 인덕회계법인'; s2.getCell('A2').font = FONT;
  const h2 = ['지출결의서 번호', '증빙유형', '라인번호', '증빙일자', '지출내역', '계정과목코드(차변)', '계정과목(차변)', '거래처코드', '거래처명', '공급가액', '세액', '합계', '거래전표번호', '회계전표번호', '라인사원코드', '라인사원명', '라인부서코드', '라인부서명', '전자결재번호', '결재여부', '증빙', '개인/법카', '클라이언트명', '업무사용', '개인사용', '비고', ...(hasSplit ? ['김준성', '조현규'] : [])];
  s2.getRow(3).values = h2;
  s2.getRow(3).eachCell((c, i) => { c.font = FONT_BOLD; c.fill = i >= 22 ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } } : FILL_HEADER; c.border = BORDER_ALL; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  const sorted = [...lines].sort((a, b) => (b.exjunpyo_no.localeCompare(a.exjunpyo_no)) || a.line_no - b.line_no);
  r = 4;
  const first = 4;
  for (const l of sorted) {
    const row = s2.getRow(r);
    const work = l.excluded ? 0 : (l.work_amount ?? null);
    const note = [l.excluded ? '결산 제외' : '', l.status !== '확정' ? `(${l.status})` : '', l.memo ?? ''].filter(Boolean).join(' ');
    row.values = [
      l.exjunpyo_no, l.evid_type || (l.card_type === '법카' ? '과세신용카드' : (l.card_type ? '개인카드' : '')), l.line_no, l.evid_date ?? '', l.description,
      l.account_code || (AC[l.account ?? ''] ?? ''), l.account ?? '', l.vendor_code ?? '', l.vendor ?? '', l.supply, l.vat, l.total, l.inv_slip ?? '', l.acct_slip ?? '',
      l.emp_code || (EMP[l.writer] ?? ''), l.writer, '0205', '2본부5팀', l.wf_no ?? '', '결재', '1건', l.card_type ?? '', l.client ?? '',
      work == null ? null : (work === l.supply && !l.split_kjs && !l.split_jhg ? { formula: `J${r}` } : work),
      // 빈 칸이 글자로 남으면 #VALUE! — N() 으로 감싼다(2026-10-19 정우철 산출물에서 발견).
      l.excluded ? 0 : { formula: hasSplit ? `J${r}-N(X${r})-N(AA${r})-N(AB${r})` : `J${r}-N(X${r})` },
      note, ...(hasSplit ? [l.split_kjs || null, l.split_jhg || null] : []),
    ];
    for (let c = 1; c <= last; c++) box(row.getCell(c));
    for (const c of [10, 11, 12, 24, 25, 27, 28]) row.getCell(c).numFmt = NUM;
    r++;
  }
  const n = r - 1;
  const tot = s2.getRow(r);
  s2.mergeCells(r, 2, r, 9); tot.getCell(2).value = '합계';
  for (const [c, col] of [[10, 'J'], [11, 'K'], [12, 'L'], [24, 'X'], [25, 'Y'], ...(hasSplit ? [[27, 'AA'], [28, 'AB']] : [])] as [number, string][]) {
    tot.getCell(c).value = { formula: `SUM(${col}${first}:${col}${n})` }; tot.getCell(c).numFmt = NUM;
  }
  for (let c = 1; c <= last; c++) { const cell = tot.getCell(c); cell.font = FONT_BOLD; cell.fill = FILL_TOTAL; cell.border = BORDER_ALL; }
  const tr = r;
  // 아래 집계 — 작년 양식의 「기장 → 기장비용으로 안분」에 3인 공동·개인·검증을 붙였다.
  const owner = basketOf(writer) ?? writer;
  const sumRows: [string, string, string, string][] = [
    ['기장', '기장거래처비용', `SUMIF($W$${first}:$W$${n},"기장",$X$${first}:$X$${n})`, '기장비용으로 안분'],
    ['기장 외 업무', '3인 공동 업무', `X${tr}-Y${tr + 3}`, '3인 공동 안분'],
    ['개인', `${owner} 귀속`, `Y${tr}`, writer === owner ? '' : `${writer} 지출이지만 ${owner} 바구니`],
    ...(hasSplit ? [['김준성 몫', '', `AA${tr}`, ''], ['조현규 몫', '', `AB${tr}`, '']] as [string, string, string, string][] : []),
    ['검증', '', `ROUND(Y${tr + 3}+Y${tr + 4}+Y${tr + 5}${hasSplit ? `+Y${tr + 6}+Y${tr + 7}` : ''}+SUMIF($Z$${first}:$Z$${n},"결산 제외*",$J$${first}:$J$${n}),0)=ROUND(J${tr},0)`, '업무+개인(+몫+결산 제외) = 공급가액'],
  ];
  sumRows.forEach(([a, b, f, d], i) => {
    const row = s2.getRow(tr + 3 + i);
    row.getCell(23).value = a; row.getCell(24).value = b; row.getCell(25).value = { formula: f }; row.getCell(26).value = d;
    row.getCell(25).numFmt = NUM;
    for (const c of [23, 24, 25, 26]) { row.getCell(c).font = c === 25 ? FONT_BOLD : FONT; row.getCell(c).border = BORDER_ALL; }
  });
  setWidths(s2, [14, 12, 6, 11, 36, 10, 12, 9, 22, 12, 10, 12, 14, 14, 11, 9, 8, 10, 14, 7, 6, 8, 18, 12, 12, 32, ...(hasSplit ? [11, 11] : [])]);
  s2.views = [{ state: 'frozen', ySplit: 3 }];
  return wb;
}
