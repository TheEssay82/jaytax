// 거래처 Excel 양식 다운로드 / 업로드 파싱 — 원본 dlClientTemplate/importClients 포팅 (SheetJS)
// xlsx는 무거우므로 동적 import로 코드 분할(거래처 탭 엑셀 기능 사용 시에만 로드)
import type { BizType } from '../types';
import { REV_YEARS, ALL_YEARS, CURRENT_YEAR } from './constants';

/** 업로드 파싱 결과 (사업자번호 기준 upsert 대상) */
export interface ParsedClient {
  bizType: BizType;
  companyName: string;
  taxId: string;
  manager: string;
  tradeName: string;
  repName: string;
  bankAccount: string;
  revenues: Record<string, number>;
  modelYears: Record<string, boolean>;
}

/** 업로드 양식 .xlsx 다운로드 */
export async function downloadTemplate(): Promise<void> {
  const XLSX = await import('xlsx');
  const revCols = REV_YEARS.map((y) => `${y}년_매출액`);
  const modelCols = REV_YEARS.map((y) => `${y}년_성실(O/X/미확정)`);
  const headers = ['담당자', '회사명(신고자명)', '업무구분', '사업자번호', '상호명', '대표자명', '가상계좌', ...revCols, ...modelCols];
  const note = ['※ 신규/상실은 청구기록 기반 자동표시', '', '', '', '', '', '', ...REV_YEARS.map(() => ''), ...REV_YEARS.map(() => 'O/X/미확정 (생략시 미확정)')];
  const sample = ['정남지', '주식회사 예시', '법인', '000-00-00000', '예시상호', '홍길동', '56100694829804', ...REV_YEARS.map((_, i) => 500000000 + i * 100000000), ...REV_YEARS.map((_, i) => (i === 0 ? 'X' : 'O'))];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, note, sample]);
  ws['!cols'] = headers.map(() => ({ wch: 22 }));
  XLSX.utils.book_append_sheet(wb, ws, '거래처목록');
  XLSX.writeFile(wb, '인덕_거래처_업로드양식.xlsx');
}

/** 업로드 파일 파싱 → ParsedClient[] (원본 importClients 의 행 파싱 로직) */
export async function parseClientsFile(file: File): Promise<ParsedClient[]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
  if (rows.length < 2) return [];
  const header = (rows[0] as unknown[]).map((h) => String(h).trim());
  const fi = (names: string[]) => {
    for (const n of names) {
      const i = header.findIndex((h) => h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const iMgr = fi(['담당자']);
  const iCn = fi(['회사명', '신고자명']);
  const iBz = fi(['업무구분', '구분']);
  const iTx = fi(['사업자번호']);
  const iTn = fi(['상호명']);
  const iRp = fi(['대표자명']);
  const iBa = fi(['가상계좌', '계좌']);
  const iMd = fi(['성실신고', '성실']);
  const num = (v: unknown) => parseFloat(String(v).replace(/,/g, ''));

  const out: ParsedClient[] = [];
  for (const r of rows.slice(1)) {
    const row = r as unknown[];
    const cn = iCn >= 0 ? String(row[iCn]).trim() : '';
    if (!cn || cn.startsWith('※')) continue;

    const revenues: Record<string, number> = {};
    const modelYears: Record<string, boolean> = {};
    for (const y of ALL_YEARS) {
      const revIdx = header.findIndex(
        (h) => h.includes(String(y)) && (h.includes('매출') || h.includes('수입') || h.toLowerCase().includes('revenue')),
      );
      if (revIdx >= 0) {
        const v = num(row[revIdx]);
        if (v > 0) revenues[String(y)] = v;
      }
      const mdIdx = header.findIndex(
        (h) => h.includes(String(y)) && (h.includes('성실') || h.toLowerCase().includes('model')),
      );
      if (mdIdx >= 0) {
        const v = String(row[mdIdx]).trim().toUpperCase();
        if (v === 'O') modelYears[String(y)] = true;
        else if (v === 'X') modelYears[String(y)] = false;
      }
    }
    // 레거시: 연도 없는 단일 매출액/성실 컬럼 → CY-1 귀속
    if (Object.keys(revenues).length === 0) {
      const iRv = fi(['매출액', '매출']);
      if (iRv >= 0) {
        const v = num(row[iRv]);
        if (v > 0) revenues[String(CURRENT_YEAR - 1)] = v;
      }
    }
    if (Object.keys(modelYears).length === 0 && iMd >= 0) {
      const v = String(row[iMd]).trim().toUpperCase();
      if (v === 'O') modelYears[String(CURRENT_YEAR - 1)] = true;
      else if (v === 'X') modelYears[String(CURRENT_YEAR - 1)] = false;
    }

    out.push({
      bizType: iBz >= 0 && String(row[iBz]).includes('개인') ? '개인' : '법인',
      companyName: cn,
      taxId: iTx >= 0 ? String(row[iTx]).trim() : '',
      manager: iMgr >= 0 ? String(row[iMgr]).trim() : '',
      tradeName: iTn >= 0 ? String(row[iTn]).trim() : '',
      repName: iRp >= 0 ? String(row[iRp]).trim() : '',
      bankAccount: iBa >= 0 ? String(row[iBa]).trim() : '',
      revenues,
      modelYears,
    });
  }
  return out;
}
