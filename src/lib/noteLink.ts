// 주석끼리·재무제표와 **맞아야 하는 숫자 짝**을 작년 보고서에서 배운다.
//
// 왜 배우는가: 어느 칸이 어느 칸과 맞아야 하는지는 문서 어디에도 적혀 있지 않다. 그런데
// **작년 감사보고서는 이미 검증을 마친 완성품**이다. 거기서 같았던 숫자는 올해도 같아야 한다.
// 그래서 사람이 짝을 하나도 지정하지 않아도 된다.
//
// 실측(2026-09-13) — 명진 44짝 · 알티스트 63짝 · 넵튠 103짝.
// 사용자가 든 예 「현금흐름표의 유형자산 취득 = 유형자산 주석의 취득」이 그대로 잡힌다
// (알티스트 5,900,000 · 90,739,000 — 주석7 ↔ 현금흐름표).
//
// 값은 **원으로 맞춰 본다.** 천원 주석은 표시 열이 ROUND 수식이라 값이 없고, 그 표의 숫자는
// 오른쪽 「원 단위 (입력)」 칸에 원으로 앉는다 — 그래서 `num` 이 든 칸만 모으면 저절로 원이다.
import { colName, type SheetPlan, type SheetCell } from './noteSheet';
import type { FsLine } from './fsParse';

export interface LinkSpot {
  /** 주석이면 시트 이름, 재무제표면 표 이름 */ group: string;
  /** 사람이 읽을 자리 */ label: string;
  /** 엑셀 주소 — 재무제표 쪽은 없다(엑셀에 없으므로) */ at?: string;
}

export interface LinkGroup {
  /** 작년 보고서의 값(원) */ value: number;
  spots: LinkSpot[];
}

/** 한 값이 이보다 많은 자리에 나오면 짝으로 보지 않는다 — 흔한 숫자다. */
const MAX_SPOTS = 6;
/** 이보다 작은 값은 우연히 같을 수 있다. */
const MIN_VALUE = 10000;

/**
 * 작년 값이 든 배치(이월하지 않은 것)에서 짝을 찾는다.
 *
 * **자리(엑셀 주소)는 이월한 배치와 같다** — 이월은 값과 서식만 바꾸고 행·열 셈은 건드리지
 * 않기 때문이다. 그래서 이월하지 않은 배치로 배우고, 이월한 시트에 그대로 건다.
 */
export function findLinks(plans: SheetPlan[], fs: FsLine[] = []): LinkGroup[] {
  const by = new Map<number, LinkSpot[]>();
  const put = (v: number, spot: LinkSpot) => {
    if (!Number.isFinite(v) || Math.abs(v) < MIN_VALUE) return;
    const k = Math.round(v);
    const list = by.get(k) ?? [];
    list.push(spot);
    by.set(k, list);
  };

  for (const plan of plans) {
    // 표 안의 숫자만 본다 — 자리표·제목은 뺀다.
    const inTable = new Set<number>();
    for (const t of plan.tables ?? []) {
      if (t.isUnitMark) continue;
      for (const r of t.bodyRows) inTable.add(r);
    }
    for (const c of plan.cells) {
      if (c.num == null || c.col < 3 || !inTable.has(c.row)) continue;
      put(c.num, { group: plan.name, label: `${plan.name} ${colName(c.col)}${c.row}`, at: `${colName(c.col)}${c.row}` });
    }
  }
  for (const l of fs) {
    if (l.cur != null) put(l.cur, { group: l.statement, label: `${l.statement} · ${l.label} (당기)` });
    if (l.pri != null) put(l.pri, { group: l.statement, label: `${l.statement} · ${l.label} (전기)` });
  }

  const out: LinkGroup[] = [];
  for (const [value, spots] of by) {
    if (spots.length > MAX_SPOTS * 2) continue;      // 너무 흔한 숫자
    // **한 시트에서는 한 자리만** 쓴다. 한 주석 안에서 같은 숫자가 여러 번 나오는 것은
    // 표 안의 이월이지 대사가 아니다 — 자본 증감표의 기초·기말이 그렇다.
    const seen = new Set<string>();
    const inSheet: LinkSpot[] = [];
    const outside: LinkSpot[] = [];
    for (const sp of spots) {
      if (!sp.at) { if (!seen.has(sp.group)) { seen.add(sp.group); outside.push(sp); } continue; }
      if (seen.has(sp.group)) continue;
      seen.add(sp.group);
      inSheet.push(sp);
    }
    // 엑셀에서 재려면 **서로 다른 주석 시트가 둘 이상**이어야 한다.
    if (inSheet.length < 2 || inSheet.length > MAX_SPOTS) continue;
    out.push({ value, spots: [...inSheet, ...outside] });
  }
  out.sort((a2, b2) => Math.abs(b2.value) - Math.abs(a2.value));
  return out;
}

/** 시트 이름을 수식에 쓸 수 있게 감싼다 — 공백·점이 들어 있으면 홑따옴표. */
export function sheetRef(name: string): string {
  return /^[A-Za-z가-힣_][A-Za-z0-9가-힣_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/** 대사표에 나란히 걸 칸 수 — 이보다 많으면 뒤는 줄인다. */
const MAX_COLS = 4;

/**
 * 대사표 시트.
 *
 * 맞아야 하는 칸들을 **수식으로** 걸어 두고 차이를 잰다. 그러면 주석을 채우는 동안 엑셀에서
 * 실시간으로 보인다 — 다 채우고 나서 검증을 돌려야 아는 것보다 훨씬 낫다.
 * 한국오츠카제약 조서가 이 방식이었다(2026-09-13 사용자 제공).
 *
 * 「작년 값」을 함께 적어 둔다. 올해 값이 작년과 같아야 한다는 뜻은 아니고, **어느 숫자를
 * 두고 하는 말인지** 알아보라고 두는 것이다.
 */
export function layoutTieSheet(links: LinkGroup[]): SheetPlan {
  const cells: SheetCell[] = [
    { row: 2, col: 2, text: '대사표', kind: 'title' },
    {
      row: 3, col: 2, kind: 'para',
      text: '작년 감사보고서에서 **같았던 숫자**를 찾아 나란히 걸었습니다. 올해도 같아야 합니다 — '
        + '「차이」가 0 이 아니면 어느 한쪽이 아직 안 맞은 것입니다. 채워 넣는 동안 여기를 보십시오.',
    },
  ];
  const head = ['맞아야 하는 곳', '작년 값', ...Array.from({ length: MAX_COLS }, (_, i) => `값 ${i + 1}`), '차이'];
  head.forEach((h, i) => cells.push({ row: 5, col: 2 + i, text: h, kind: 'head' }));

  links.forEach((g, i) => {
    const row = 6 + i;
    const inSheet = g.spots.filter((x) => x.at).slice(0, MAX_COLS);
    const names = [...new Set(g.spots.map((x) => x.group))];
    cells.push({ row, col: 2, text: names.join(' ↔ '), kind: 'text' });
    cells.push({ row, col: 3, text: '', num: g.value, kind: 'num' });
    inSheet.forEach((sp, k) => {
      cells.push({ row, col: 4 + k, text: '', kind: 'num', formula: `${sheetRef(sp.group)}!${sp.at}` });
    });
    const from = colName(4);
    const to = colName(3 + MAX_COLS);
    cells.push({
      row, col: 4 + MAX_COLS, text: '', kind: 'num',
      formula: `IF(COUNT(${from}${row}:${to}${row})<2,"",MAX(${from}${row}:${to}${row})-MIN(${from}${row}:${to}${row}))`,
    });
  });
  if (!links.length) {
    cells.push({ row: 6, col: 2, text: '맞아야 하는 숫자 짝을 찾지 못했습니다.', kind: 'text' });
  }
  return { name: '대사표', cells, merges: [], lastRow: 5 + Math.max(1, links.length), tables: [] };
}
