// 일반조서 워크북을 **읽어서 목록으로** — 시트마다 어느 조서인지, 누가 언제 썼는지.
//
// 회사 실물(명진 FY25, 2026-09-15 확인)은 워크북 하나에 조서 시트 76장이다. 앞에 「감사조서철 작성 및
// 보존」·「조서표지(공통사항)」·「조서목록」이 있고, 조서 시트 머리에는 회사명·결산일·작성자·검토자·일자가
// 있다. 작성자·일자는 대개 `=조서목록!D8` 같은 링크라, **값은 엑셀이 적어 둔 계산값**으로 읽는다.
//
// 조서의 열쇠는 **조서 코드**다 — 시트 이름 「1100(소규모)」·「2700A (소규모)」·「2110-2」에서
// 「(소규모)」와 공백을 뺀 앞 토막. 소규모 시트와 일반 시트가 한 파일에 섞여 있어도 코드로 같은 조서를
// 알아본다. 「8500(별첨1)」처럼 꼬리가 붙으면 꼬리까지 열쇠에 넣는다(8500 과 다른 시트다).
import type { CellValue, SheetData } from './xlsxRead';

export type SheetKind = 'cover' | 'index' | 'paper' | 'extra';

/** 조서 시트 머리 — 값은 엑셀이 적어 둔 계산값. 수식만 있고 값이 없으면 빈 글자. */
export interface PaperHead {
  company: string;
  closing: string;
  author: string;
  reviewer: string;
  date: string;
}

export interface CatalogSheet {
  name: string;
  /** 「1100」·「2110-2」·「8500(별첨1)」. 조서가 아니면 null */ code: string | null;
  kind: SheetKind;
  hidden: boolean;
  head: PaperHead;
  cells: number;
  formulas: number;
}

/** 「조서목록」 시트의 한 줄. */
export interface IndexRow {
  row: number;
  code: string;
  title: string;
  performed: boolean;
  author: string;
  date: string;
}

export interface Catalog {
  company: string;
  closing: string;
  period: string;
  reportDate: string;
  sheets: CatalogSheet[];
  index: IndexRow[];
}

const norm = (s: string | undefined) => (s ?? '').replace(/\s/g, '');

/**
 * 시트 이름 → 조서 코드. 「(소규모)」·공백을 빼고, 앞 토막이 「숫자4 + 글자? + (-숫자)? + 글자?」이면 조서다.
 *
 *   1100(소규모) → 1100 · 2700A (소규모) → 2700A · 2110-2 → 2110-2 · 2700A-1(적용지침) → 2700A-1(적용지침)
 *   8500(별첨1) → 8500(별첨1) · 3650A 신규 → 3650A신규 · 8110ARP_BS → null · 특수관계자검토25 → null
 */
export function codeOf(name: string): string | null {
  const s = norm(name).replace(/\(소규모\)/g, '');
  const m = /^(\d{4}[A-Z]?(?:-\d+)?[A-Z]?)(?![A-Za-z0-9])/.exec(s);
  if (!m) return null;
  return s;
}

/** 시트 이름으로 종류를 가른다. */
export function kindOf(name: string): SheetKind {
  const s = norm(name);
  if (s.includes('조서목록')) return 'index';
  if (s.includes('조서표지') || s.includes('감사조서철') || s.includes('표지')) return 'cover';
  return codeOf(name) ? 'paper' : 'extra';
}

/** 엑셀 날짜 일련번호 → 「2025-04-14」. 글자면 그대로. */
export function isoDate(v: CellValue | undefined): string {
  if (!v) return '';
  if (v.num != null && v.num > 20000 && v.num < 80000) {
    const ms = Math.round((v.num - 25569) * 86400000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const t = (v.text ?? '').trim();
  const m = /^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return t;
}

function textOf(v: CellValue | undefined): string {
  if (!v) return '';
  if (v.text != null) return v.text.trim();
  if (v.num != null) return String(v.num);
  return '';
}

function colNum(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function colName(n: number): string {
  let out = '';
  let x = n;
  while (x > 0) { const r = (x - 1) % 26; out = String.fromCharCode(65 + r) + out; x = Math.floor((x - 1) / 26); }
  return out;
}

/** 「회 사 명 :」 같은 라벨을 알아본다. */
const LABELS: Record<keyof PaperHead, RegExp> = {
  company: /^회사명[:：]?$/,
  closing: /^결산일[:：]?$/,
  author: /^작성자[:：]?$/,
  reviewer: /^검토자[:：]?$/,
  date: /^일자[:：]?$/,
};

function isLabel(t: string): boolean {
  const n = norm(t);
  return Object.values(LABELS).some((re) => re.test(n)) || /^(성명|서명)$/.test(n);
}

/**
 * 조서 시트 머리를 읽는다 — 1~8행에서 라벨을 찾고 **그 바로 오른쪽 칸**을 가져온다.
 *
 * 「일자」는 작성자 줄과 검토자 줄에 하나씩 있다. 첫 번째(작성자 줄)를 쓴다 — 검토 일자는
 * 대개 `=F5` 로 작성 일자와 같다.
 */
export function readHead(sheet: SheetData): PaperHead {
  const head: PaperHead = { company: '', closing: '', author: '', reviewer: '', date: '' };
  const byRow = new Map<number, { col: number; v: CellValue }[]>();
  for (const [ref, v] of sheet.cells) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!m) continue;
    const row = Number(m[2]);
    if (row > 8) continue;
    const list = byRow.get(row) ?? [];
    list.push({ col: colNum(m[1]), v });
    byRow.set(row, list);
  }
  const seen = new Set<keyof PaperHead>();
  for (const row of [...byRow.keys()].sort((a, b) => a - b)) {
    const cells = byRow.get(row)!.sort((a, b) => a.col - b.col);
    for (let i = 0; i < cells.length; i += 1) {
      const t = norm(textOf(cells[i].v));
      for (const key of Object.keys(LABELS) as (keyof PaperHead)[]) {
        if (seen.has(key) || !LABELS[key].test(t)) continue;
        seen.add(key);
        // 값은 **바로 오른쪽 칸**이다. 그 칸이 수식만 있고 값이 없으면 빈 글자다 — 건너뛰어 다음
        // 라벨(「작성자」)을 값으로 읽으면 안 된다. 오른쪽에 아무것도 없으면(2110-2 의 「일자」는
        // 라벨이 윗줄에 있다) 바로 아래 칸을 본다.
        let next = cells[i + 1];
        if (!next) {
          const below = byRow.get(row + 1)?.find((c) => c.col === cells[i].col);
          if (below) next = below;
        }
        if (!next || isLabel(textOf(next.v))) break;
        head[key] = key === 'date' || key === 'closing' ? isoDate(next.v) : textOf(next.v);
        break;
      }
    }
  }
  return head;
}

/** 「조서목록」 시트를 줄로. B 조서명 · C 수행여부 · D 작성자 · E 작성일(명진 실물 2026-09-15). */
export function readIndex(sheet: SheetData): IndexRow[] {
  const out: IndexRow[] = [];
  const rows = new Set<number>();
  for (const ref of sheet.cells.keys()) {
    const m = /^B(\d+)$/.exec(ref);
    if (m) rows.add(Number(m[1]));
  }
  for (const row of [...rows].sort((a, b) => a - b)) {
    const title = textOf(sheet.cells.get(`B${row}`));
    // 「2700A-1(적용지침) 중요성 적용지침」처럼 꼬리가 붙은 코드도 한 줄이다.
    const m = /^(\d{4}[A-Z]?(?:-\d+)?[A-Z]?(?:\([^)]*\))?)\s+(.*)$/.exec(title.trim());
    if (!m) continue;
    out.push({
      row,
      code: m[1],
      title: m[2].trim(),
      performed: /^[OoVv○●✓]/.test(textOf(sheet.cells.get(`C${row}`))),
      author: textOf(sheet.cells.get(`D${row}`)),
      date: isoDate(sheet.cells.get(`E${row}`)),
    });
  }
  return out;
}

/** 「조서표지(공통사항)」 — A열 라벨 옆 B열 값. */
function readCover(sheet: SheetData): Pick<Catalog, 'company' | 'closing' | 'period' | 'reportDate'> {
  const out = { company: '', closing: '', period: '', reportDate: '' };
  for (const [ref, v] of sheet.cells) {
    const m = /^A(\d+)$/.exec(ref);
    if (!m) continue;
    const label = norm(textOf(v));
    const val = sheet.cells.get(`B${m[1]}`);
    if (/^회사명$/.test(label)) out.company = textOf(val);
    else if (/^결산일$/.test(label)) out.closing = isoDate(val);
    else if (/^대상기간$/.test(label)) out.period = textOf(val);
    else if (/^감사보고서일$/.test(label)) out.reportDate = isoDate(val);
  }
  return out;
}

/** 워크북 전체를 목록으로. `hidden` 은 readWorkbook 이 알려 준다. */
export function buildCatalog(sheets: SheetData[]): Catalog {
  const cat: Catalog = { company: '', closing: '', period: '', reportDate: '', sheets: [], index: [] };
  for (const s of sheets) {
    const kind = kindOf(s.name);
    if (kind === 'index') cat.index = readIndex(s);
    if (kind === 'cover' && norm(s.name).includes('조서표지')) Object.assign(cat, readCover(s));
    let formulas = 0;
    for (const v of s.cells.values()) if (v.formula != null) formulas += 1;
    cat.sheets.push({
      name: s.name, code: kind === 'paper' ? codeOf(s.name) : null, kind, hidden: s.hidden === true,
      head: kind === 'paper' ? readHead(s) : { company: '', closing: '', author: '', reviewer: '', date: '' },
      cells: s.cells.size, formulas,
    });
  }
  return cat;
}

/** 조서 코드의 앞 네 자리 → 묶음(1000 감사계약 · 2000 위험평가 · 3000 대응 · 7000 그룹 · 8000 완결 · 9000 내부회계). */
export function sectionOf(code: string): string {
  const n = Number(code.slice(0, 4));
  if (n >= 1000 && n < 2000) return '감사계약';
  if (n >= 2000 && n < 3000) return '위험평가';
  if (n >= 3000 && n < 4000) return '위험에 대한 대응';
  if (n >= 7000 && n < 8000) return '그룹감사';
  if (n >= 8000 && n < 9000) return '감사완결';
  if (n >= 9000) return '내부회계관리제도';
  return '기타';
}

export { colName };
