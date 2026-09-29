// 소규모 짝 정리 — 소규모 감사인데 같은 번호가 두 벌(「2511(소규모)」 숨김 · 「2511」 보임)인 것을 한 벌로. 순수 모듈.
//
// 사용자 2026-09-28: 「"소규모"인 경우 조서번호+소규모라고 제목이 붙은 시트가 있는데 그걸 무시하고 생성되다 보니
// 시트 숨김된 시트와 생성되어 교체된 시트의 번호가 중복되는 경우가 있어. 2302~2532 의 숨겨진 시트와 생성된 시트를 비교해서 수정」.
// 명진 FY25 실측: 숨긴 「2511·2520·2530·2531·2531A·2532(소규모)」는 올해 소규모 양식과 문구가 100% 같은 **빈 양식**,
// 보이는 「2511·2512·2513·2520·2530」은 작년에 쓴 **일반 양식**(내용이 들어 있다).
//
// 규칙: 소규모 감사면
//   · 짝(「번호(소규모)」 숨김 + 일반 「번호」 보임) → 소규모 쪽을 보이고 작년 값을 줄 이름으로 옮긴다(노랑). 일반 쪽은 숨긴다(지우지 않는다).
//   · 짝이 바뀐 번호 무리(첫 세 자리)의 일반 딸림 시트(2512·2513)로 올해 양식에 없는 것 → 숨긴다.
//   · 양쪽 다 쓰지 않던 것(2531·2532 등 소규모만 있고 숨김) → 그대로.
import { strFromU8, strToU8 } from 'fflate';
import { readWorkbook, type SheetData } from './xlsxRead';
import { setCells } from './xlsxCells';
import { sheetEntries, setSheetHidden, zip, transplantSheet } from './xlsxTransplant';
import { sortSheetsByCode } from './gwpOrder';
import { setTabColor, highlightCells, blackenSheet, TAB } from './xlsxMark';
import { buildCatalog, codeOf } from './gwpCatalog';
import { headLinker, migrateInputs, renameSheetRefs } from './gwpRoll';
import { PAPER_2110A, from2110ASmall } from './gwpPaper2110A';
import type { CellEdit } from './xlsxCells';

/** 2110A 소규모 → 일반: 열 이름으로 옮긴 칸(빈 칸 지우기는 빼고 — 노란 칠은 값 넣은 칸만). */
function migrate2110A(small: SheetData, to: SheetData): { edits: CellEdit[] } {
  const d = from2110ASmall(PAPER_2110A.read(small), PAPER_2110A.read(to));
  const all = PAPER_2110A.write(to, d);
  const clears = all.filter((e) => 'clear' in e && e.clear && to.cells.get(e.ref)?.text);   // 칸 자리로 잘못 들어간 옛 값 지우기
  return { edits: [...all.filter((e) => !('clear' in e && e.clear)), ...clears] };
}

export interface SmallPair { code: string; plain: string; small: string }
export interface SmallPlan { pairs: SmallPair[]; hide: string[] }
type Sh = { name: string; hidden?: boolean };

const SMALL = /\(\s*소규모\s*\)\s*$/;
const baseCode = (name: string) => (codeOf(name) ?? '').replace(/\(.*$/, '');
/** 「2511」처럼 번호만인 일반 시트인가(「2700A-1(적용지침)」 같은 꼬리 붙은 것은 아니다). */
const plainOnly = (name: string) => { const b = baseCode(name); return !!b && name.replace(/\s/g, '') === b; };

export function planSmall(sheets: Sh[], templateCodes?: Set<string>): SmallPlan {
  const pairs: SmallPair[] = [];
  for (const s of sheets) {
    if (!SMALL.test(s.name)) continue;
    const code = baseCode(s.name);
    const plain = sheets.find((x) => x !== s && !x.hidden && plainOnly(x.name) && baseCode(x.name) === code);
    if (plain) pairs.push({ code, plain: plain.name, small: s.name });
  }
  const families = new Set(pairs.map((p) => p.code.slice(0, 3)));
  const paired = new Set(pairs.map((p) => p.plain));
  const smallCodes = new Set(sheets.filter((s) => SMALL.test(s.name)).map((s) => baseCode(s.name)));
  const hide = sheets.filter((s) => !s.hidden && plainOnly(s.name) && !paired.has(s.name)
    && families.has(baseCode(s.name).slice(0, 3)) && !smallCodes.has(baseCode(s.name))
    && !(templateCodes?.has(baseCode(s.name)))).map((s) => s.name);
  return { pairs, hide };
}

export interface SmallResult {
  bytes: Uint8Array;
  done: { code: string; small: string; plain: string; moved: number; left: number }[];
  hidden: string[];
}

/** 짝을 정리한다 — files 는 풀어 둔 워크북(제자리에서 고친다). reviewer 는 새로 보이는 시트 머리의 검토자. */
export function applySmall(files: Record<string, Uint8Array>, plan: SmallPlan, reviewer: string): Omit<SmallResult, 'bytes'> {
  const out: Omit<SmallResult, 'bytes'> = { done: [], hidden: [] };
  if (!plan.pairs.length && !plan.hide.length) return out;
  const sheets = readWorkbook(zip(files));
  const link = headLinker(sheets, buildCatalog(sheets));
  const byName = (n: string): SheetData | undefined => sheets.find((s) => s.name === n);
  for (const p of plan.pairs) {
    const plain = byName(p.plain), small = byName(p.small);
    const e = sheetEntries(files).find((x) => x.name === p.small);
    if (!plain || !small || !e) continue;
    const mig = migrateInputs(plain, small);
    const edits = [...mig.edits, ...link(small, p.code, reviewer)];
    let xml = strFromU8(files[e.part]);
    if (edits.length) xml = setCells(xml, edits);
    files[e.part] = strToU8(setTabColor(xml, TAB.red));            // 올해 아직 손 안 댐
    blackenSheet(files, e.part);
    if (mig.edits.length) highlightCells(files, e.part, mig.edits.map((x) => x.ref));
    setSheetHidden(files, p.small, false);
    setSheetHidden(files, p.plain, true);
    out.done.push({ code: p.code, small: p.small, plain: p.plain, moved: mig.moved.length, left: mig.left.length });
  }
  for (const n of plan.hide) if (setSheetHidden(files, n, true)) out.hidden.push(n);
  sortSheetsByCode(files);
  return out;
}

// ── 반대 방향: 소규모 → 일반(·K-IFRS) ────────────────────────
//
// 사용자 2026-09-28: 「평안정공의 경우 일반기준으로 분류인데 2700번 조서를 소규모로 반영되어 있습니다」.
// 평안정공 FY25 조서는 1100·1200·2100·2110·2110A·2120·2700 계열이 「번호(소규모)」 시트였다(작년 소규모 기준).
// 올해 조서 기준이 일반이면 — 보이는 「번호(소규모)」마다
//   · 같은 번호의 일반 시트(「2110A」)가 있으면 그것을 보이고 작년 값을 줄 이름으로 옮긴다. 소규모 시트는 숨긴다.
//   · 없으면 올해 일반 양식 시트를 새로 넣고(「2700A-2(감사계획단계)」) 작년 값을 옮긴다. 소규모 시트는 숨긴다.
//   · 일반 양식에도 없는 번호(1100 — ERP 에서 평가)는 그대로 둔다.
// 다른 시트의 수식이 소규모 시트를 가리키면 새 시트를 가리키게 바꾼다. 지우는 시트는 없다(숨길 뿐).
export interface LargeStep { code: string; small: string; to: string; how: '보이기' | '양식에서' | '숨기기만' }
export interface LargePlan { steps: LargeStep[]; tidy?: Tidy }
/** 이미 바꾼 판 다듬기 — 숨긴 「번호(소규모)」의 일반 짝이 숨어 있으면 보인다. 시트 차례는 조서 번호 순서(gwpOrder). */
export interface Tidy { show: string[] }

/** 차례대로의 시트 목록 → 다듬을 것. 조서 기준이 일반·K-IFRS 일 때만 부른다. */
export function planTidy(sheets: Sh[]): Tidy {
  const out: Tidy = { show: [] };
  sheets.forEach((s) => {
    if (!s.hidden || !SMALL.test(s.name)) return;
    const code = baseCode(s.name);
    const twins = sheets.filter((x) => !SMALL.test(x.name) && baseCode(x.name) === code && (plainOnly(x.name) || /\((감사|적용)/.test(x.name)));
    if (!twins.length || sheets.some((x) => !x.hidden && SMALL.test(x.name) && baseCode(x.name) === code)) return;
    const t = twins.find((x) => !x.hidden) ?? twins[0];
    if (t.hidden) out.show.push(t.name);
  });
  return out;
}

/** 다듬기를 워크북에 — files 는 제자리에서. */
export function applyTidy(files: Record<string, Uint8Array>, t: Tidy): void {
  for (const n of t.show) setSheetHidden(files, n, false);
  sortSheetsByCode(files);                                         // 조서 번호 순서(사용자 2026-09-28)
}
type TplSheet = { file: string; name: string; code: string | null; hidden: boolean };

export function planLarge(sheets: Sh[], find: (code: string) => TplSheet | null, tplSheets: TplSheet[] = []): LargePlan {
  const steps: LargeStep[] = [];
  const names = new Set(sheets.map((s) => s.name));
  for (const s of sheets) {
    if (s.hidden || !SMALL.test(s.name)) continue;
    const code = baseCode(s.name);
    if (!code) continue;
    const plain = sheets.find((x) => x !== s && plainOnly(x.name) && baseCode(x.name) === code);
    if (plain) { steps.push({ code, small: s.name, to: plain.name, how: plain.hidden ? '보이기' : '숨기기만' }); continue; }
    const t = find(code);
    if (!t) continue;
    if (names.has(t.name)) { steps.push({ code, small: s.name, to: t.name, how: '숨기기만' }); continue; }
    steps.push({ code, small: s.name, to: t.name, how: '양식에서' });
  }
  // 2700A 요약은 2700A-1~4 를 링크한다 — 일반 양식으로 바꿀 때 빠진 짝(평안정공 2700A-4(감사완결단계))도 양식에서 넣는다(없으면 #REF!).
  if (steps.some((x) => x.code === '2700A' && x.how !== '숨기기만')) {
    const have = new Set([...names, ...steps.map((x) => x.to)]);
    const haveCode = new Set(sheets.filter((x) => !SMALL.test(x.name)).map((x) => baseCode(x.name)));
    for (const t of tplSheets) {
      const c = (t.code ?? '').replace(/\(.*$/, '');
      if (t.hidden || !/^2700A-\d$/.test(c) || have.has(t.name) || haveCode.has(c) || steps.some((x) => x.code === c)) continue;
      steps.push({ code: c, small: '', to: t.name, how: '양식에서' });
      have.add(t.name);
    }
  }
  return { steps };
}

export interface LargeResult { done: (LargeStep & { moved: number })[] }

/** 소규모 → 일반 정리. files 는 풀어 둔 워크북(제자리에서 고친다). tpl 은 올해 양식 묶음(readBundle). */
export function applyLarge(
  files: Record<string, Uint8Array>, plan: LargePlan,
  tpl: { catalog: { sheets: TplSheet[] }; files: Record<string, Uint8Array> }, reviewer: string,
  unzipBook: (b: Uint8Array) => Record<string, Uint8Array>,
): LargeResult {
  const out: LargeResult = { done: [] };
  if (!plan.steps.length) {
    applyTidy(files, planTidy(sheetEntries(files).map((e) => ({ name: e.name, hidden: !!e.state && e.state !== 'visible' }))));
    return out;
  }
  const books = new Map<string, { files: Record<string, Uint8Array>; sheets: SheetData[] }>();
  const book = (file: string) => {
    if (!books.has(file)) books.set(file, { files: unzipBook(tpl.files[file]), sheets: readWorkbook(tpl.files[file]) });
    return books.get(file)!;
  };
  // 양식에서 넣을 시트부터 — 넣은 뒤 한꺼번에 읽는다.
  for (const st of plan.steps.filter((x) => x.how === '양식에서')) {
    const t = tpl.catalog.sheets.find((x) => x.name === st.to);
    if (!t) continue;
    transplantSheet(files, book(t.file).files, t.name, { hidden: false });
  }
  const sheets = readWorkbook(zip(files));
  const link = headLinker(sheets, buildCatalog(sheets));
  const byName = (n: string) => sheets.find((s) => s.name === n);
  const rename = new Map<string, string>();
  for (const st of plan.steps) {
    const small = st.small ? byName(st.small) : undefined, to = byName(st.to);
    const e = sheetEntries(files).find((x) => x.name === st.to);
    if (!to || !e) continue;
    if (!small) {                                                    // 짝 시트만 새로 — 옮길 값 없음
      files[e.part] = strToU8(setTabColor(setCells(strFromU8(files[e.part]), link(to, st.code, reviewer)), TAB.red));
      blackenSheet(files, e.part);
      out.done.push({ ...st, moved: 0 });
      continue;
    }
    let moved = 0;
    if (st.how !== '숨기기만') {
      // 2110A 는 열 모양이 다르다(소규모 3열 ↔ 일반 7열) — 칸 자리가 아니라 열 이름으로(에이치앤아비즈 2026-09-30).
      const mig = st.code === '2110A' ? migrate2110A(small, to) : migrateInputs(small, to);
      moved = mig.edits.length;
      const edits = [...mig.edits, ...link(to, st.code, reviewer)];
      let xml = strFromU8(files[e.part]);
      if (edits.length) xml = setCells(xml, edits);
      files[e.part] = strToU8(setTabColor(xml, TAB.red));          // 올해 아직 손 안 댐
      blackenSheet(files, e.part);
      if (mig.edits.length) highlightCells(files, e.part, mig.edits.map((x) => x.ref));
      setSheetHidden(files, st.to, false);
    }
    setSheetHidden(files, st.small, true);
    rename.set(st.small, st.to);
    out.done.push({ ...st, moved });
  }
  // 다른 시트의 수식이 소규모 시트를 가리키면 새 시트로(2700A → 2700A-2(소규모) 등).
  if (rename.size) for (const e of sheetEntries(files)) files[e.part] = strToU8(renameSheetRefs(strFromU8(files[e.part]), rename));
  // 새로 넣은 일반 시트는 맨 뒤에 붙는다 — 조서 번호 순서로(사용자 2026-09-28 「조서시트의 번호별로 순서가 이어져야」).
  applyTidy(files, planTidy(sheetEntries(files).map((e) => ({ name: e.name, hidden: !!e.state && e.state !== 'visible' }))));
  return out;
}
