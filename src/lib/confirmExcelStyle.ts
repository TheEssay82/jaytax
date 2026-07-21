// 조회서 엑셀 서식 — 2025 control sheet 의 조서 서식을 그대로 따른다.
// 맑은 고딕 10pt · 전 셀 thin 테두리 · 2단 헤더(회색 채움) · 입력칸 노란 채움 ·
// 가로방향 인쇄 + 헤더행 반복 + 좁은 여백.
//
// ExcelJS 는 용량이 커서(약 1MB) 내보낼 때만 동적 로드한다. 평소 화면에는 실리지 않는다.
import type { Borders, Fill, Worksheet, Row } from 'exceljs';

export const FONT = { name: '맑은 고딕', size: 10 };
export const FONT_BOLD = { ...FONT, bold: true };
export const FONT_TITLE = { ...FONT, size: 12, bold: true };

/** 2025 파일의 헤더 채움(테마2 밝은 회색) */
export const FILL_HEADER: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };
/** 입력하는 칸(발송일·회수 등)은 노란 바탕 — 원본과 동일 */
export const FILL_INPUT: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
/** 합계·요약행 */
export const FILL_TOTAL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };

const thin = { style: 'thin' as const };
export const BORDER_ALL: Partial<Borders> = { top: thin, bottom: thin, left: thin, right: thin };

/** 지정 범위에 테두리·폰트를 입힌다. */
export function frame(
  ws: Worksheet,
  r1: number, c1: number, r2: number, c2: number,
  opts: { fill?: Fill; bold?: boolean; align?: 'left' | 'center' | 'right'; wrap?: boolean } = {},
): void {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const cell = ws.getCell(r, c);
      cell.border = BORDER_ALL;
      cell.font = opts.bold ? FONT_BOLD : FONT;
      cell.alignment = {
        vertical: 'middle',
        horizontal: opts.align,
        wrapText: opts.wrap ?? false,
      };
      if (opts.fill) cell.fill = opts.fill;
    }
  }
}

/** 조서용 인쇄 설정 — 가로, 폭 1장 맞춤, 헤더행 반복, 좁은 여백 */
export function setupPrint(ws: Worksheet, headerRows: string, lastCol: string, lastRow: number): void {
  ws.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.2, right: 0.2, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    printArea: `A1:${lastCol}${lastRow}`,
  };
  ws.pageSetup.printTitlesRow = headerRows; // 예: '7:8'
  ws.headerFooter = { oddFooter: '&C&P / &N' }; // 페이지 번호
  ws.views = [{ state: 'frozen', ySplit: 0 }];
}

/** 열 너비 일괄 지정 */
export function setWidths(ws: Worksheet, widths: number[]): void {
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
}

/** 행 높이 */
export function setRowHeight(row: Row, h: number): void {
  row.height = h;
}

/** 브라우저 저장 — ExcelJS 는 버퍼만 만들므로 다운로드는 직접 처리한다. */
export async function saveWorkbook(wb: { xlsx: { writeBuffer(): Promise<ArrayBuffer> } }, filename: string): Promise<void> {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
