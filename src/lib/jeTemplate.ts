// JET — 회사 제시 잔액표 양식 내려받기. 분개장의 재무상태표 계정을 미리 깔아 두고, 감사인이 전기말 · 당기말 재무상태표 금액을 붙여 넣는다.
// 더존 분개장에는 시산표가 없어서(세원 FY2025 실물) 4_기초잔액검토에 이 표가 필요하다. 올리면 jeParse.parseBalanceRows 가 읽는다.
import type { Cell } from 'exceljs';
import { FONT, FONT_BOLD, FILL_HEADER, FILL_INPUT, BORDER_ALL, saveWorkbook } from './confirmExcelStyle';
import { guessSide, isBsCode, type BsBalance } from './jeChecks';
import type { JeLine } from './jeParse';

export async function exportBalanceTemplate(company: string, fy: number, lines: JeLine[], current: BsBalance[] | null): Promise<void> {
  const mod = await import('exceljs');
  const ExcelJS = ((mod as unknown as { default?: unknown }).default ?? mod) as typeof import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('잔액표');
  ws.getCell('A1').value = `${company} FY${fy} — 회사 제시 잔액표(재무상태표 계정)`; ws.getCell('A1').font = { ...FONT_BOLD, size: 12 };
  ws.getCell('A2').value = '노란 칸에 전기말(감사받은 재무상태표) · 당기말 금액을 붙여 넣으세요. 원장 계정 하나가 공시과목 여럿이면 줄을 더하고 같은 「묶음」 이름을 적습니다. 차대: 차(자산 · 차감계정) / 대(부채 · 자본). 충당금 · 누계액은 음수로.';
  ws.getCell('A2').font = { ...FONT, color: { argb: 'FF7F7F7F' } };
  const head = ['묶음', '계정코드', '계정명', '차대', '전기말(기초)', '당기말(기말)', '분개장 차변', '분개장 대변'];
  head.forEach((h, i) => { const c = ws.getCell(4, i + 1); c.value = h; c.font = FONT_BOLD; c.fill = FILL_HEADER; c.border = BORDER_ALL; });
  const agg = new Map<string, { name: string; dr: number; cr: number }>();
  for (const l of lines) if (isBsCode(l.acctCode)) { const a = agg.get(l.acctCode) ?? { name: l.acctName, dr: 0, cr: 0 }; a.dr += l.dr; a.cr += l.cr; agg.set(l.acctCode, a); }
  const rows = current?.length
    ? current.map((b) => ({ group: b.group ?? '', code: b.acctCode, name: b.acctName, side: (b.side ?? guessSide(b.acctCode, b.acctName)) === 1 ? '차' : '대', open: b.open, close: b.close }))
    : [...agg.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([code, a]) => ({ group: '', code, name: a.name, side: guessSide(code, a.name) === 1 ? '차' : '대', open: null as number | null, close: null as number | null }));
  rows.forEach((r, i) => {
    const a = agg.get(r.code);
    [r.group, r.code, r.name, r.side, r.open, r.close, a ? Math.round(a.dr) : null, a ? Math.round(a.cr) : null].forEach((v, ci) => {
      const c = ws.getCell(5 + i, ci + 1); c.value = v as Cell['value']; c.font = FONT; c.border = BORDER_ALL;
      if (ci >= 4) c.numFmt = '#,##0;-#,##0';
      if (ci === 4 || ci === 5) c.fill = FILL_INPUT;
    });
  });
  ws.columns = [{ width: 12 }, { width: 10 }, { width: 30 }, { width: 6 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  await saveWorkbook(wb, `JET_잔액표_${company}_FY${fy}.xlsx`);
}
