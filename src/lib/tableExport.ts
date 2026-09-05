// 표를 그대로 **복사**하거나 **엑셀로 내려받는다.**
//
// 왜 필요한가: 「엑셀로 복사」·「엑셀 내려받기」·파일 저장이 열 곳에 서로 다른 이름·다른
// 자리로 흩어져 있었다. 화면마다 되는 것이 다르니 어디서 되는지 외워야 했다.
//
// 표가 이미 열 정의(라벨 + 값 뽑는 함수)를 들고 있으므로, 여기서는 **보이는 그대로**를
// 옮기기만 한다. 숨긴 열은 빼고 정렬·필터가 적용된 순서 그대로 나간다 —
// 화면과 다른 것이 나오면 붙여 넣고 나서 다시 맞춰야 한다.

/** 엑셀에 붙일 수 있게 탭으로 가른다. */
export function toTsv(head: string[], rows: (string | number)[][]): string {
  const cell = (v: string | number) => String(v ?? '')
    .replace(/[\t\r\n]/g, ' ');     // 탭·줄바꿈이 섞이면 칸이 밀린다
  return [head.map(cell).join('\t'), ...rows.map((r) => r.map(cell).join('\t'))].join('\n');
}

/** 클립보드에 넣는다. 실패하면 이유를 돌려준다(권한이 막힌 브라우저가 있다). */
export async function copyTable(head: string[], rows: (string | number)[][]): Promise<void> {
  await navigator.clipboard.writeText(toTsv(head, rows));
}

/**
 * CSV 파일로 내려받는다.
 * 엑셀이 한글을 깨뜨리지 않도록 **BOM 을 붙인다** — 이것이 없으면 한글이 깨져서 열린다.
 */
export function downloadCsv(fileName: string, head: string[], rows: (string | number)[][]): void {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [head.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
  const blob = new Blob([`\uFEFF${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 파일 이름에 붙일 오늘 날짜(YYYYMMDD). */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
