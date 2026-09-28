// 조서 시트 차례 — 엑셀 조서 파일의 시트를 조서 번호 순서로(사용자 2026-09-28 「조서의 엑셀버젼에서 조서시트의 번호별로 순서가 이어져야 합니다」).
//
//   앞쪽 공통 시트(감사조서철 · 조서표지 · 조서목록 · 기본사항 …)는 첫 조서 앞에 그대로.
//   조서 시트는 번호 순서 — 1100 · 1200 · 2100 · 2100A · 2110 · 2110-1 · 2110-2 · 2110A · 2120 · 2120A · … · 2700 · 2700A · 2700A-1 · 2700A-2 …
//     (같은 번호 안에서 「-1」이 글자 꼬리 「A」보다 앞 — 한공회 조서목록 차례)
//   번호 없는 딸림 시트(조직도 · kick-off 회의록 · 8110ARP_BS · 특수관계자 …)는 원래 붙어 있던 조서 뒤를 따라간다.
//   같은 번호(「2110A(소규모)」 숨김 · 「2110A」)는 원래 차례대로 나란히.
import { codeOf } from './gwpCatalog';
import { sheetEntries, reorderSheets } from './xlsxTransplant';

const BASE = /^(\d{4})([A-Z]?(?:-\d+)?[A-Z]?)/;

/** 차례 열쇠 — 「2110-1」 → 「2110!1」(「!」은 글자보다 앞). 조서가 아니면 null. */
export function orderKey(name: string): string | null {
  const c = codeOf(name);
  const m = c ? BASE.exec(c) : null;
  return m ? `${m[1]}${m[2].replace(/-/g, '!')}` : null;
}

/** 조서 번호 순서로 늘어놓은 시트 이름. */
export function byCodeOrder(names: string[]): string[] {
  const front: string[] = [];
  const groups: { key: string; at: number; names: string[] }[] = [];
  names.forEach((n, i) => {
    const k = orderKey(n);
    if (k == null) { if (groups.length) groups[groups.length - 1].names.push(n); else front.push(n); return; }
    groups.push({ key: k, at: i, names: [n] });
  });
  groups.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.at - b.at));
  return [...front, ...groups.flatMap((g) => g.names)];
}

export const isCodeOrdered = (names: string[]) => byCodeOrder(names).every((n, i) => n === names[i]);

/** 풀어 둔 워크북의 시트를 조서 번호 순서로(제자리). 바꿨으면 true. */
export function sortSheetsByCode(files: Record<string, Uint8Array>): boolean {
  const names = sheetEntries(files).map((e) => e.name);
  const want = byCodeOrder(names);
  return want.some((n, i) => n !== names[i]) ? reorderSheets(files, want) : false;
}
