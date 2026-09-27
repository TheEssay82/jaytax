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
import { sheetEntries, setSheetHidden, zip } from './xlsxTransplant';
import { setTabColor, highlightCells, blackenSheet, TAB } from './xlsxMark';
import { buildCatalog, codeOf } from './gwpCatalog';
import { headLinker, migrateInputs } from './gwpRoll';

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
  return out;
}
