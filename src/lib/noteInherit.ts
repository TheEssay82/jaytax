// 작년에 등록한 **표준주석엑셀**에서 수식을 이어받는다.
//
// 왜 필요한가: 주석의 구조·문단·표는 ④ 가 만든 DSD 가 내년 ② 의 틀이 되어 저절로 넘어간다.
// 넘어가지 않는 것이 **엑셀 안에 사람이 건 수식**이다 — 재무제표·TB 시트로의 링크. 해마다 스무
// 장에 다시 거는 일이었다. 다 채우고 검증까지 마친 엑셀을 작업 건에 등록해 두면, 다음 해 ② 가
// 노란 칸에 그 수식을 미리 넣어 준다(사용자 결정 2026-09-14).
//
// 어떻게 짝을 짓는가: 자리(칸 주소)로 맞추지 않는다 — 행이 늘고 줄면 밀린다. **주석 제목 →
// 행 라벨(C열) → 열 글자**로 맞춘다. 같은 라벨이 한 주석에 여럿이면(「합계」·「기타」) 몇 번째인지로
// 가른다. 옛 엑셀이 주석별 시트든 종단형이든 상관없다 — 「주석명」 라벨(B열)로 주석의 자리를
// 가르기 때문이다.
//
// 값은 이어받지 않는다. 작년 숫자를 올해 칸에 넣는 것이 이 일에서 가장 큰 사고다.
import { colName, type SheetPlan } from './noteSheet';
import type { SheetData } from './xlsxRead';

const norm = (s: string | undefined) => (s ?? '').replace(/\s/g, '');
/** 「5. 재고자산」 → 「재고자산」. 번호는 해마다 밀리므로 열쇠에서 뺀다. */
const titleKey = (s: string | undefined) => norm(s).replace(/^\d+\./, '');

/** 옛 엑셀에서 주석 하나가 차지한 자리. */
export interface OldNote {
  title: string;
  sheet: SheetData;
  /** 「주석명」 라벨이 있는 행 */ from: number;
  /** 다음 주석 직전 행(마지막이면 시트 끝) */ to: number;
}

/** 시트마다 「주석명」 라벨(B열)을 찾아 주석의 자리를 가른다. */
export function oldNotes(sheets: SheetData[]): OldNote[] {
  const out: OldNote[] = [];
  for (const sheet of sheets) {
    const marks: number[] = [];
    let max = 0;
    for (const [ref, v] of sheet.cells) {
      const m = /^([A-Z]+)(\d+)$/.exec(ref);
      if (!m) continue;
      const row = Number(m[2]);
      if (row > max) max = row;
      if (m[1] === 'B' && norm(v.text) === '주석명') marks.push(row);
    }
    marks.sort((a, b) => a - b);
    marks.forEach((r, i) => {
      const title = titleKey(sheet.cells.get(`C${r}`)?.text);
      if (!title) return;
      out.push({ title, sheet, from: r, to: i + 1 < marks.length ? marks[i + 1] - 1 : max });
    });
  }
  return out;
}

export interface InheritResult {
  plans: SheetPlan[];
  /** 수식을 넣은 노란 칸 수 */ got: number;
  /** 노란 칸 전체 */ want: number;
  /** 옛 엑셀에서 찾은 주석 수 */ notes: number;
  /** 수식이 가리키는데 새 파일에 없는 시트 — 정산표 시트 이름이 바뀐 것이다 */ unknownSheets: string[];
}

/** 수식이 가리키는 시트 이름들 — 「'BS'!D12」·「TB!A1」. */
export function sheetsInFormula(f: string): string[] {
  const out: string[] = [];
  for (const m of f.matchAll(/'((?:[^']|'')+)'!|(?<![A-Za-z0-9_'가-힣])([A-Za-z가-힣_][A-Za-z0-9가-힣_.]*)!/g)) {
    out.push((m[1] ?? m[2]).replace(/''/g, "'"));
  }
  return out;
}

/**
 * 새 배치의 노란 칸에 옛 엑셀의 수식을 넣는다.
 *
 * `known` 을 주면 수식이 가리키는 시트가 새 파일에 있는지 본다 — 없으면 알려만 준다.
 * 수식은 그대로 넣는다: 시트 이름이 바뀌었으면 엑셀이 #REF! 로 보여 주고, 사람이 고친다.
 */
export function inheritFormulas(plans: SheetPlan[], old: SheetData[], known?: Set<string>): InheritResult {
  const byTitle = new Map<string, OldNote>();
  for (const s of oldNotes(old)) if (!byTitle.has(s.title)) byTitle.set(s.title, s);
  let got = 0;
  let want = 0;
  let notes = 0;
  const unknown = new Set<string>();

  const outPlans = plans.map((plan) => {
    const inputs = plan.cells.filter((c) => c.kind === 'input');
    want += inputs.length;
    const title = titleKey(plan.note ?? plan.cells.find((c) => c.kind === 'title')?.text);
    const seg = title ? byTitle.get(title) : undefined;
    if (!seg || !inputs.length) return plan;
    notes += 1;

    // 새 배치의 행 라벨(C열). 노란 칸 자체는 라벨이 아니다.
    const labelAt = new Map<number, string>();
    for (const c of plan.cells) {
      if (c.col === 3 && c.kind !== 'input' && norm(c.text)) labelAt.set(c.row, norm(c.text));
    }
    const newRows = new Map<string, number[]>();
    for (const row of [...labelAt.keys()].sort((a, b) => a - b)) {
      const l = labelAt.get(row)!;
      newRows.set(l, [...(newRows.get(l) ?? []), row]);
    }
    const oldRows = new Map<string, number[]>();
    for (let r = seg.from; r <= seg.to; r += 1) {
      const t = norm(seg.sheet.cells.get(`C${r}`)?.text);
      if (t) oldRows.set(t, [...(oldRows.get(t) ?? []), r]);
    }

    const cells = plan.cells.map((c) => {
      if (c.kind !== 'input' || c.formula != null) return c;
      const l = labelAt.get(c.row);
      if (!l) return c;
      const k = newRows.get(l)!.indexOf(c.row);
      const r = oldRows.get(l)?.[k];
      if (r == null) return c;
      const f = seg.sheet.cells.get(`${colName(c.col)}${r}`)?.formula;
      if (!f) return c;
      got += 1;
      if (known) for (const s of sheetsInFormula(f)) if (!known.has(s)) unknown.add(s);
      return { ...c, formula: f };
    });
    return { ...plan, cells };
  });
  return { plans: outPlans, got, want, notes, unknownSheets: [...unknown] };
}
