// 감사업무관리 › Journal Entry 시스템 — 검사(시나리오 1~17). supabase 를 물지 않는다(시험이 돌아야 하므로).
//
// 근거: 인덕 「JE Test 가이드라인」(IT감사팀 2021, 감사기준 240 문단 32) — 필수(유효성 · 차대 · 시산표 대사) + 선택을 회사별로 골라 쓴다.
// 조서 틀은 우리 실물 조서(JETEST_조서_나래나노텍 · 세원특수금속 FY2025, 같은 템플릿)를 따른다 — 시트 「번호_약칭」, 총괄의 조서번호 A01~(필수) · B01~(선택).
//   실물의 핵심 절차 둘(사용자 2026-10-21):
//   ① 4_기초잔액검토 — 재무상태표 계정만. 분개장 계정별 차변 · 대변 합계(D · E) + 회사 제시 기말(F)로 기초를 역산(G)해 회사 제시 기초(H, 전기 감사받은 재무상태표)와 비교(I = G − H).
//      차변 계정 G = F − D + E, 대변 계정 G = F + D − E. 원장 계정 하나가 공시과목 여럿으로 나뉘면(감가상각누계액 → 자산군별) 묶음으로 합쳐 0이 되는지 본다.
//   ② 5_일정금액이상 — 중요성 = BENCHMARK(매출 등) × 적용률(1%). 손익계산서 계정 **줄** 중 |금액| ≥ 중요성 을 전부 나열하고, 줄마다 검토(REF 조서 · 결과)를 적는다.
// 실물 샘플의 10 · 11번 조서번호 중복(B06)은 고쳐서 잇는다. 12번부터는 이번에 더한 것(지침 밖 · 파이썬 JET 자료).
// 전표 = (전표일자, 그날의 번호). 더존 · 영림원 내보내기에 작성자 · 승인자 · 입력일이 없어 그 칸이 필요한 시나리오는 「자료 없음」으로 판정한다.
import type { JeLine, TbRow } from './jeParse';

export type CheckStatus = '통과' | '예외' | '자료없음' | '미수행';
export interface CheckResult {
  no: number;
  code: string;
  /** 시트 이름 「4_기초잔액검토」 */ sheet: string;
  title: string;
  kind: 'Mandatory' | 'Option';
  /** 총괄 표의 설명 */ desc: string;
  status: CheckStatus;
  /** 한 줄 요약 — 결론 문장의 바탕 */ summary: string;
  method: string[];
  head: string[];
  rows: (string | number | null)[][];
  stats?: Record<string, number>;
}

export interface Voucher { key: string; date: string; no: string; lines: JeLine[]; dr: number; cr: number; vtype: string }
export const vkey = (l: Pick<JeLine, 'date' | 'no'>) => `${l.date}|${l.no}`;

export function vouchers(lines: JeLine[]): Voucher[] {
  const m = new Map<string, Voucher>();
  for (const l of lines) {
    const k = vkey(l);
    const v = m.get(k) ?? { key: k, date: l.date, no: l.no, lines: [], dr: 0, cr: 0, vtype: l.vtype };
    v.lines.push(l); v.dr += l.dr; v.cr += l.cr;
    if (l.vtype !== '일반') v.vtype = l.vtype;
    m.set(k, v);
  }
  return [...m.values()].sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
}

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const r0 = (n: number) => Math.round(n);
/** 재무상태표 계정인가 — 계정코드 첫 자리 1 · 2 · 3(더존 3자리 101~399, 영림원 5자리 1xxxx~3xxxx). */
export const isBsCode = (code: string) => /^[123]/.test(code);

/** 시나리오 목록(총괄 표 순서). code 는 조서번호. */
export const SCENARIOS = [
  { no: 1, code: 'A01', sheet: '1_데이터유효성', title: 'Data Integrity Test', kind: 'Mandatory', desc: '받은 자료의 필드 · 레코드 수, 기간 밖 일자 · 차대 동시 기재 확인' },
  { no: 2, code: 'A02', sheet: '2_필수필드', title: '필수Field 확인', kind: 'Mandatory', desc: '전표일자 · 전표번호 · 계정 · 금액 빈값 확인' },
  { no: 3, code: 'A03', sheet: '3_차대불일치', title: '차대불일치', kind: 'Mandatory', desc: '전표번호별 차변합계와 대변합계 일치 확인' },
  { no: 4, code: 'A04', sheet: '4_기초잔액검토', title: '기초잔액 검증', kind: 'Mandatory', desc: '분개장 증감과 회사 제시 기말잔액으로 역산한 기초가 전기말 잔액과 같은지 확인(재무상태표 계정)' },
  { no: 5, code: 'B01', sheet: '5_일정금액이상', title: '일정금액이상전표(손익 전표)', kind: 'Option', desc: '중요성(BENCHMARK × 적용률) 이상인 손익계산서 계정 분개 검토' },
  { no: 6, code: 'B02', sheet: '6_COA', title: 'CoA에 없는 전표', kind: 'Option', desc: '계정과목표(시산표)에 없는 계정으로 분개한 전표 확인' },
  { no: 7, code: 'B03', sheet: '7_일정빈도이하', title: '일정빈도이하전표', kind: 'Option', desc: '사용 빈도가 낮은 계정의 분개 검토' },
  { no: 8, code: 'B04', sheet: '8_사용자', title: '권한없는자입력전표', kind: 'Option', desc: '사용자 목록에 없는 입력자 · 권한 없는 입력' },
  { no: 9, code: 'B05', sheet: '9_결산일이후입력', title: '결산일이후입력전표', kind: 'Option', desc: '입력일이 결산일 이후인 전표' },
  { no: 10, code: 'B06', sheet: '10_입력승인동일인', title: '입력&승인동일인', kind: 'Option', desc: '입력자와 승인자가 같은 전표' },
  { no: 11, code: 'B07', sheet: '11_매출상대계정', title: '비정상 계정조합(매출 상대계정)', kind: 'Option', desc: '매출 전표 중 정상 상대계정(현금성 · 채권 · 선수금 등)이 없는 전표' },
  { no: 12, code: 'B08', sheet: '12_주말공휴일', title: '주말 · 공휴일 전표', kind: 'Option', desc: '전표일자가 토 · 일 · 공휴일인 전표' },
  { no: 13, code: 'B09', sheet: '13_기말결산분개', title: '기말 결산분개', kind: 'Option', desc: '결산일 전표 · 결산 구분(결차 · 결대) 전표 검토(감사기준 240 문단 32 (2))' },
  { no: 14, code: 'B10', sheet: '14_전표번호결번', title: '전표번호 결번', kind: 'Option', desc: '날짜별 전표번호의 빈 번호(삭제 · 취소 전표)' },
  { no: 15, code: 'B11', sheet: '15_라운드금액', title: '라운드 금액 · 9999', kind: 'Option', desc: '단위의 배수인 큰 금액, 「9999」가 들어간 금액' },
  { no: 16, code: 'B12', sheet: '16_적요', title: '모호한 적요 · 적요 없음', kind: 'Option', desc: '수정 · 대체 · 오류 · 가지급 등 낱말, 적요 없는 전표' },
  { no: 17, code: 'B13', sheet: '17_음수금액', title: '음수 금액(역분개 · 취소)', kind: 'Option', desc: '차변 · 대변에 음수 금액이 있는 전표' },
  { no: 18, code: 'B14', sheet: '18_신규계정', title: '당기 신규 계정 사용 전표', kind: 'Option', desc: '전기 분개장에 없던 계정을 쓴 전표(가이드라인 2.9)' },
] as const;
export type ScenarioCode = (typeof SCENARIOS)[number]['code'];
/** 기본으로 켜는 시나리오 — 실물 조서(나래 · 세원)가 한 것 + 결산분개(240.32 (2)). */
export const DEFAULT_ON: ScenarioCode[] = ['A01', 'A02', 'A03', 'A04', 'B01', 'B02', 'B03', 'B07', 'B09', 'B14'];
/** 더존 · 영림원 내보내기로는 할 수 없는 것(작성자 · 승인자 · 입력일). */
export const NEEDS_USER_DATA: ScenarioCode[] = ['B04', 'B05', 'B06'];

const base = (code: ScenarioCode) => { const s = SCENARIOS.find((x) => x.code === code)!; return { no: s.no, code: s.code, sheet: s.sheet, title: s.title, kind: s.kind, desc: s.desc }; };

// ── 1 데이터 유효성 ── 지침 ① 기간 밖 ② 필수 칸 빈값 ③ 차변 · 대변 모두 0 ④ 한 줄에 차변 · 대변 둘 다.
export function checkValidity(lines: JeLine[], from: string, to: string): CheckResult {
  const out = lines.filter((l) => l.date < from || l.date > to);
  const both0 = lines.filter((l) => !l.dr && !l.cr);
  const both = lines.filter((l) => l.dr && l.cr);
  const rows: CheckResult['rows'] = [
    ['① 회계기간 밖 전표일자', out.length, `${from} ~ ${to}`],
    ['② 필수 칸 빈값', lines.filter((l) => !l.no || (!l.acctCode && !l.acctName)).length, '2_필수필드 참조'],
    ['③ 차변 · 대변이 모두 0인 줄', both0.length, both0.length ? '금액 영향 없음(부가세 0원 줄 등)' : ''],
    ['④ 한 줄에 차변 · 대변 금액이 모두 있는 줄', both.length, ''],
  ];
  const bad = out.length + both.length;
  return {
    ...base('A01'), status: bad ? '예외' : '통과',
    summary: bad ? `기간 밖 ${out.length}줄 · 차대 동시 ${both.length}줄이 있어 회사에 확인이 필요함` : `분개 ${lines.length.toLocaleString()}줄에 기간 밖 일자 · 차대 동시 기재가 없음을 확인하였음`,
    method: ['회사로부터 수령한 분개장의 필드 · 레코드 수를 확인하고,', '회계기간 밖 일자, 차변 · 대변이 모두 0이거나 모두 기재된 줄이 있는지 확인함'],
    head: ['검증 항목', '건수', '비고'], rows, stats: { out: out.length, both0: both0.length, both: both.length },
  };
}

// ── 2 필수 필드 ──
export function checkRequired(lines: JeLine[]): CheckResult {
  const fields: [string, (l: JeLine) => boolean, boolean][] = [
    ['전표일자', (l) => !!l.date, true], ['전표번호', (l) => !!l.no, true], ['계정코드', (l) => !!l.acctCode, true], ['계정명', (l) => !!l.acctName, true],
    ['적요', (l) => !!l.memo, false],
  ];
  const rows: CheckResult['rows'] = fields.map(([f, ok, must]) => { const n = lines.filter((l) => !ok(l)).length; return [f, must ? 'O' : '', n, n ? (must ? '빈값 — 회사 질의' : '적요 없는 줄(참고)') : '이상 없음']; });
  for (const f of ['작성자', '작성일자', '승인자', '승인일자']) rows.push([f, 'O', null, 'ERP 분개장에 해당 필드 없음']);
  const bad = rows.filter((r) => r[1] === 'O' && Number(r[2]) > 0).length;
  return {
    ...base('A02'), status: bad ? '예외' : '통과',
    summary: bad ? `필수 필드 빈값 ${bad}종 — 해당 줄을 추출해 회사에 질의함` : `총 ${lines.length.toLocaleString()}줄의 필수 필드(일자 · 번호 · 계정)에 빈값이 없음을 확인하였음`,
    method: ['필수 필드별로 빈값(=)인 줄을 조회함'], head: ['FieldName', '필수', '빈값 건수', '비고'], rows,
  };
}

// ── 3 차대 일치 ──
export function checkBalance(vs: Voucher[]): CheckResult {
  const dr = vs.reduce((s, v) => s + v.dr, 0), cr = vs.reduce((s, v) => s + v.cr, 0);
  const bad = vs.filter((v) => r0(v.dr - v.cr) !== 0);
  const rows: CheckResult['rows'] = [['전체', vs.length, r0(dr), r0(cr), r0(dr - cr)]];
  for (const v of bad.slice(0, 500)) rows.push([`${v.date} ${v.no}`, v.lines.length, r0(v.dr), r0(v.cr), r0(v.dr - v.cr)]);
  return {
    ...base('A03'), status: bad.length || r0(dr - cr) ? '예외' : '통과',
    summary: bad.length ? `차대가 일치하지 않는 전표 ${bad.length}장` : `전표 ${vs.length.toLocaleString()}장의 차대가 모두 일치함을 확인하였음(합계 ${won(dr)}원)`,
    method: ['전표(전표일자 + 전표번호)별로 차변합계와 대변합계를 비교함'],
    head: ['전표(일자 번호)', '줄 수', '차변합계', '대변합계', '차이'], rows, stats: { vouchers: vs.length, dr: r0(dr), cr: r0(cr), bad: bad.length },
  };
}

// ── 4 기초잔액 검증 ──
/** 회사 제시 잔액 줄 — 원장 계정 하나가 공시과목 여럿이면 같은 group 으로 묶는다(예: 감가상각누계액 → 건물 · 기계장치 …). */
export interface BsBalance { acctCode: string; acctName: string; open: number; close: number; group?: string | null; side?: 1 | -1 | null }
export interface OpenRecon { group: string; code: string; name: string; jdr: number; jcr: number; close: number; calcOpen: number; open: number; diff: number; side: 1 | -1 }

/**
 * 계정코드로 짐작한 잔액 방향 — 더존 3자리는 101~250 자산 · 251~ 부채 · 자본, 영림원 5자리는 1 · 2 로 시작하면 자산 · 3 은 부채 · 자본.
 * 충당금 · 누계액은 회사 제시 재무제표에 음수로 들어오는 자산 차감계정이라 차변 계정으로 둔다(실물 세원과 같이).
 */
export function guessSide(code: string, name = ''): 1 | -1 {
  if (/충당금|누계액|할인차금/.test(name) && !/충당부채/.test(name)) return 1;
  if (/^\d{3}$/.test(code)) return Number(code) <= 250 ? 1 : -1;
  // 더존 아마란스 7자리(1030001 보통예금 · 2530000 미지급금)는 앞 3자리가 옛 더존 코드다.
  if (/^\d{7}$/.test(code)) return Number(code.slice(0, 3)) <= 250 ? 1 : -1;
  return /^[12]/.test(code) ? 1 : /^3/.test(code) ? -1 : 1;
}
/** 잔액 방향 — 1 차변 계정, −1 대변 계정. 지정이 없으면 코드 · 이름으로 짐작. */
export const sideOf = (b: Pick<BsBalance, 'acctCode' | 'acctName' | 'side'>) => (b.side ?? guessSide(b.acctCode, b.acctName)) as 1 | -1;

export function reconOpening(lines: JeLine[], bal: BsBalance[], codeOf: (c: string) => string = (c) => c): OpenRecon[] {
  const agg = new Map<string, { dr: number; cr: number; name: string }>();
  for (const l of lines) { const c = codeOf(l.acctCode); if (!isBsCode(c)) continue; const a = agg.get(c) ?? { dr: 0, cr: 0, name: l.acctName }; a.dr += l.dr; a.cr += l.cr; agg.set(c, a); }
  const nm = (x: string) => x.replace(/\s/g, '');
  const used = new Set<string>();
  const rows: OpenRecon[] = bal.map((b) => {
    // 같은 계정코드가 여러 줄(공시과목 여럿)이면 분개 합계는 첫 줄에만 둔다 — 실물(세원 감가상각누계액)과 같이.
    // 코드가 비었으면 **이름이 같은 계정 전부**를 더한다(재무제표 · 정산표에서 온 줄 — 더존은 「감가상각누계액」이 자산마다 코드가 따로라 실물도 이름으로 피벗했다).
    let a: { dr: number; cr: number } | undefined;
    if (b.acctCode) { if (!used.has(b.acctCode)) a = agg.get(b.acctCode); used.add(b.acctCode); }
    else {
      const codes = [...agg.entries()].filter(([c, x]) => nm(x.name) === nm(b.acctName) && !used.has(c));
      if (codes.length) { a = { dr: 0, cr: 0 }; for (const [c, x] of codes) { a.dr += x.dr; a.cr += x.cr; used.add(c); } }
    }
    const jdr = a?.dr ?? 0, jcr = a?.cr ?? 0;
    // 방향을 안 적은 줄: 기말 − 기초가 (차 − 대)와 맞으면 차변, (대 − 차)와 맞으면 대변 계정으로 본다. 둘 다 아니면 코드로 짐작.
    let side = sideOf(b);
    if (b.side == null) { const d = r0(b.close - b.open); if (d === r0(jdr - jcr)) side = 1; else if (d === r0(jcr - jdr)) side = -1; }
    const calcOpen = side === 1 ? b.close - jdr + jcr : b.close + jdr - jcr;
    return { group: b.group || b.acctCode || b.acctName, code: b.acctCode, name: b.acctName, jdr, jcr, close: b.close, calcOpen, open: b.open, diff: r0(calcOpen - b.open), side };
  });
  for (const [c, a] of agg) if (!used.has(c)) {
    const side = guessSide(c, a.name), calcOpen = side === 1 ? a.cr - a.dr : a.dr - a.cr;
    rows.push({ group: c, code: c, name: `${a.name} (회사 제시 잔액 없음)`, jdr: a.dr, jcr: a.cr, close: 0, calcOpen, open: 0, diff: r0(calcOpen), side });
  }
  return rows;
}

/** 묶음별 차이 합 — 0 이면 공시과목 나눔 · 재분류로 상쇄된 것. */
export function groupDiffs(rows: OpenRecon[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.group, (m.get(r.group) ?? 0) + r.diff);
  return m;
}

export function checkOpening(lines: JeLine[], bal: BsBalance[] | null, codeOf: (c: string) => string = (c) => c): CheckResult {
  const head = ['묶음', '계정코드', '계정명', '차변합계', '대변합계', '회사제시기말잔액', '기초재계산금액', '회사제시 기초잔액', '차이금액', '잔액방향'];
  const method = ['전표에는 이월전표가 없으므로, 분개장의 계정별 차변 · 대변 합계와 회사 제시 기말잔액으로 기초잔액을 역산하고,', '역산한 기초잔액을 회사 제시 기초잔액(전기 감사받은 재무상태표)과 비교함(재무상태표 계정)'];
  if (!bal?.length) return { ...base('A04'), status: '자료없음', summary: '회사 제시 기초 · 기말 잔액이 없습니다 — 잔액표를 올리면 계정별로 대사합니다', method, head, rows: [] };
  const rows = reconOpening(lines, bal, codeOf);
  // 미처분이익잉여금은 회사 제시 금액에 당기순이익이 들어 있는데 분개장에는 손익 대체 전표가 아직 없다(중간 · 결산 마감 전).
  // 차이가 분개장 손익 합계(대변 − 차변)와 같으면 「당기순이익(분개장 손익 계정)」 줄을 같은 묶음에 넣어 상쇄로 보인다.
  const ni = Math.round(lines.filter((l) => !isBsCode(codeOf(l.acctCode))).reduce((s, l) => s + l.cr - l.dr, 0));
  const re = rows.find((r) => /이익잉여금|이월이익|미처분/.test(r.name) && r.diff !== 0 && Math.abs(r.diff - ni) <= Math.max(1, Math.abs(ni) * 0.001));
  if (ni && re) rows.push({ group: re.group, code: '', name: '당기순이익(분개장 손익 계정, 미대체)', jdr: 0, jcr: 0, close: 0, calcOpen: -ni, open: 0, diff: -ni, side: -1 });
  // 남은 차이가 정확히 반대인 묶음이 하나뿐이면 같은 묶음으로 — 회사 재무제표의 재분류(유동 ↔ 비유동 · 계정 간 대체). 실물 조서도 이렇게 묶어 표시했다.
  let paired = 0;
  for (;;) {
    const gd = groupDiffs(rows);
    const open = [...gd.entries()].filter(([, d]) => r0(d) !== 0);
    let done = false;
    for (const [ga, da] of open) {
      const opp = open.filter(([gb, db]) => gb !== ga && r0(db) === -r0(da));
      if (opp.length !== 1) continue;
      const gb = opp[0][0];
      const label = `재분류: ${rows.find((r) => r.group === ga)!.name} ↔ ${rows.find((r) => r.group === gb)!.name}`;
      for (const r of rows) if (r.group === ga || r.group === gb) r.group = label;
      paired++; done = true; break;
    }
    if (!done) break;
  }
  const g = groupDiffs(rows);
  const offset = rows.filter((r) => r.diff !== 0 && r0(g.get(r.group) ?? 0) === 0).length;
  const left = [...g.entries()].filter(([, d]) => r0(d) !== 0);
  return {
    ...base('A04'), status: left.length ? '예외' : '통과',
    summary: left.length
      ? `차이가 남는 묶음 ${left.length}개(합계 ${won(left.reduce((s, [, d]) => s + d, 0))}원) — 원인 확인 필요`
      : `${rows.length}개 줄 모두 역산 기초와 회사 제시 기초가 일치(공시과목 나눔 · 재분류로 상쇄 ${offset}줄${paired ? `, 그중 반대 금액 짝 ${paired}쌍은 자동으로 묶음 — 내용 확인` : ''})하여 전기 기말잔액이 기초로 이상 없이 이월되었음을 확인하였음`,
    method, head,
    rows: rows.map((r) => [r.group === r.code ? '' : r.group, r.code, r.name, r0(r.jdr), r0(r.jcr), r0(r.close), r0(r.calcOpen), r0(r.open), r.diff, r.side === 1 ? '차' : '대']),
    stats: { rows: rows.length, offset, left: left.length },
  };
}

// ── 5 일정금액 이상(중요성) ──
export interface Bench { name: string; amount: number; rate: number; reason: string }
export const benchThreshold = (b: Bench) => Math.round(b.amount * b.rate);

/** 매출액(BENCHMARK 기본값) — 계정명에 「매출」이 있는 손익 계정의 대변 − 차변(원가 · 할인 · 환입 · 채권 제외). */
export function salesTotal(lines: JeLine[]): number {
  return lines.filter((l) => !isBsCode(l.acctCode) && /매출/.test(l.acctName) && !/원가|할인|환입|에누리|채권/.test(l.acctName)).reduce((s, l) => s + l.cr - l.dr, 0);
}

/**
 * side: 양쪽 = 차변 · 대변 줄 모두, 차변만 = 차변 금액이 양수인 줄만(대체 분개의 맞은편 줄 · 마이너스 역분개를 뺀다).
 * 나래 FY2025 실물 40줄과 계정별로 견주면 차변만이 하자보수비(1 대 3) 말고 모두 같다 — 실물이 이렇게 봤다.
 */
export function scenMateriality(lines: JeLine[], b: Bench, exclude: string[] = [], side: '양쪽' | '차변만' = '양쪽'): CheckResult {
  const th = benchThreshold(b);
  const ex = new Set(exclude);
  const exNames = [...new Set(lines.filter((l) => ex.has(l.acctCode)).map((l) => l.acctName))];
  const hit = th > 0 ? lines.filter((l) => !isBsCode(l.acctCode) && !ex.has(l.acctCode) && Math.abs(l.dr - l.cr) >= th && (side === '양쪽' || l.dr > 0)).sort((x, y) => x.date.localeCompare(y.date) || x.no.localeCompare(y.no, 'en', { numeric: true }) || x.seq - y.seq) : [];
  return {
    ...base('B01'), title: `일정금액이상전표(손익 전표, ${won(th)}원 이상)`,
    status: th > 0 ? (hit.length ? '예외' : '통과') : '자료없음',
    summary: th > 0 ? `중요성 기준(${b.name} ${won(b.amount)} × ${Math.round(b.rate * 1000) / 10}% = ${won(th)}원) 이상 손익 분개 ${hit.length}줄` : 'BENCHMARK 금액을 넣어 주세요',
    method: [`손익계산서 계정 분개${side === '차변만' ? '(차변)' : ''} 중 금액(절대값)이 중요성 기준 이상인 분개를 추출하여 검토함`, `중요성 기준 = ${b.name}(BENCHMARK) × ${Math.round(b.rate * 1000) / 10}%`, ...(exNames.length ? [`다른 조서에서 검토하는 계정은 제외함(${exNames.slice(0, 8).join(' · ')}${exNames.length > 8 ? ' 외' : ''})`] : [])],
    head: ['전표일자', '전표번호', '구분', '계정코드', '계정과목', '절대값', '차변(대변)', '차변금액', '대변금액', '적요', '거래처'],
    rows: hit.map((l) => [l.date, l.no, l.side ?? '', l.acctCode, l.acctName, r0(Math.abs(l.dr - l.cr)), r0(l.dr - l.cr), r0(l.dr), r0(l.cr), l.memo, l.cpName ?? '']),
    stats: { threshold: th, count: hit.length },
  };
}

// ── 선택 시나리오(전표 단위) ──
export interface JeParams {
  rareCount: number;
  roundUnit: number;
  salesRe: string;
  salesPartnerRe: string;
  memoWords: string;
  closingDays: number;
  holidays: string[];
}

/** 한국 공휴일(대체 · 임시 포함). 회사별로 화면에서 고칠 수 있다. */
export const KR_HOLIDAYS: string[] = [
  '2024-01-01', '2024-02-09', '2024-02-10', '2024-02-11', '2024-02-12', '2024-03-01', '2024-04-10', '2024-05-05', '2024-05-06', '2024-05-15',
  '2024-06-06', '2024-08-15', '2024-09-16', '2024-09-17', '2024-09-18', '2024-10-01', '2024-10-03', '2024-10-09', '2024-12-25',
  '2025-01-01', '2025-01-27', '2025-01-28', '2025-01-29', '2025-01-30', '2025-03-01', '2025-03-03', '2025-05-05', '2025-05-06', '2025-06-03',
  '2025-06-06', '2025-08-15', '2025-10-03', '2025-10-05', '2025-10-06', '2025-10-07', '2025-10-08', '2025-10-09', '2025-12-25',
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02', '2026-05-05', '2026-05-24', '2026-05-25', '2026-06-03',
  '2026-06-06', '2026-08-15', '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03', '2026-10-05', '2026-10-09', '2026-12-25',
];

export const defaultParams = (): JeParams => ({
  rareCount: 10,
  roundUnit: 1_000_000,
  salesRe: '매출',
  salesPartnerRe: '현금|예금|외상매출금|매출채권|받을어음|미수금|선수금|부가세예수금|부가가치세예수금|매출|계약부채|대손충당금|미청구공사|초과청구공사',
  memoWords: '수정|대체|오류|정정|조정|지시|취소|임시|가지급|가수금',
  closingDays: 0,
  holidays: KR_HOLIDAYS,
});

const VHEAD = ['전표일자', '전표번호', '주요 계정', '전표금액(차변합)', '적요(주요 줄)'];
const voucherRow = (v: Voucher, extra: (string | number | null)[] = []): (string | number | null)[] => {
  const top = [...v.lines].sort((a, b) => Math.max(Math.abs(b.dr), Math.abs(b.cr)) - Math.max(Math.abs(a.dr), Math.abs(a.cr)))[0];
  return [v.date, v.no, top?.acctName ?? '', r0(v.dr), top?.memo ?? '', ...extra];
};
const pick = (code: ScenarioCode, list: Voucher[], why: string, method: string[], extraHead: string[] = [], extra: (v: Voucher) => (string | number | null)[] = () => []): CheckResult => ({
  ...base(code), status: list.length ? '예외' : '통과',
  summary: list.length ? `${why} 전표 ${list.length}장(합계 ${won(list.reduce((s, v) => s + v.dr, 0))}원)` : `${why} 전표가 없음을 확인하였음`,
  method, head: [...VHEAD, ...extraHead], rows: list.map((v) => voucherRow(v, extra(v))), stats: { count: list.length, amount: r0(list.reduce((s, v) => s + v.dr, 0)) },
});
const noData = (code: ScenarioCode, why: string): CheckResult => ({ ...base(code), status: '자료없음', summary: why, method: [], head: VHEAD, rows: [] });

export function scenCoa(lines: JeLine[], vs: Voucher[], coa: Set<string> | null, codeOf: (c: string) => string): CheckResult {
  if (!coa?.size) return noData('B02', '계정과목표(시산표)가 없어 수행하지 못함');
  const bad = new Set(lines.filter((l) => !coa.has(codeOf(l.acctCode))).map(vkey));
  return pick('B02', vs.filter((v) => bad.has(v.key)), '계정과목표에 없는 계정을 사용한', ['분개장의 계정코드를 계정과목표(시산표)와 대조함']);
}

export function scenRare(lines: JeLine[], p: JeParams): CheckResult {
  const m = new Map<string, { name: string; dr: number; cr: number; v: Set<string> }>();
  for (const l of lines) { const a = m.get(l.acctCode) ?? { name: l.acctName, dr: 0, cr: 0, v: new Set() }; a.dr += l.dr; a.cr += l.cr; a.v.add(vkey(l)); m.set(l.acctCode, a); }
  const rare = [...m.entries()].filter(([, a]) => a.v.size <= p.rareCount).sort((a, b) => a[1].v.size - b[1].v.size || a[0].localeCompare(b[0]));
  return {
    ...base('B03'), title: `일정빈도이하전표(${p.rareCount}건 이하)`, status: rare.length ? '예외' : '통과',
    summary: rare.length ? `사용 전표가 ${p.rareCount}건 이하인 계정 ${rare.length}개 — 계정별 REF 조서에서 검토` : `사용 전표가 ${p.rareCount}건 이하인 계정이 없음`,
    method: [`계정과목별 사용 전표 수가 ${p.rareCount}건 이하인 계정을 추출하여 해당 계정 조서(REF)에서 검토함`],
    head: ['계정코드', '계정명', '전표 수', '차변합계', '대변합계', 'REF'], rows: rare.map(([c, a]) => [c, a.name, a.v.size, r0(a.dr), r0(a.cr), '']), stats: { count: rare.length },
  };
}

export function scenSalesPartner(vs: Voucher[], p: JeParams): CheckResult {
  const sales = new RegExp(p.salesRe), partner = new RegExp(p.salesPartnerRe);
  const isSales = (l: JeLine) => !isBsCode(l.acctCode) && sales.test(l.acctName) && !/원가|할인|환입|에누리/.test(l.acctName) && (l.cr > 0 || l.dr < 0);
  const list = vs.filter((v) => v.lines.some(isSales) && !v.lines.some((l) => !isSales(l) && partner.test(l.acctName)));
  return pick('B07', list, '정상 상대계정이 없는 매출', ['매출 계정이 포함된 전표의 상대계정을 보고, 정상 상대계정(현금성 · 매출채권 · 선수금 · 부가세예수금 등)이 없는 전표를 추출함'], ['상대계정'], (v) => [[...new Set(v.lines.filter((l) => !isSales(l)).map((l) => l.acctName))].slice(0, 4).join(', ')]);
}

export function scenHoliday(vs: Voucher[], p: JeParams): CheckResult {
  const hol = new Set(p.holidays);
  const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
  const list = vs.filter((v) => dow(v.date) === 0 || dow(v.date) === 6 || hol.has(v.date));
  return pick('B08', list, '주말 · 공휴일 일자', ['전표일자가 토 · 일요일 또는 공휴일인 전표를 추출함'], ['요일'], (v) => [hol.has(v.date) ? '공휴일' : dow(v.date) === 0 ? '일' : '토']);
}

export function scenClosing(vs: Voucher[], to: string, p: JeParams): CheckResult {
  const d = new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - p.closingDays);
  const f = d.toISOString().slice(0, 10);
  return pick('B09', vs.filter((v) => (v.date >= f && v.date <= to) || v.vtype === '결산'), '결산일 일자 · 결산 구분', [`전표일자가 ${p.closingDays ? `${f} ~ ` : ''}${to}(결산일)이거나 결산 구분인 전표를 추출하여 검토함`], ['구분'], (v) => [v.vtype]);
}

export function scenGaps(vs: Voucher[]): CheckResult {
  const byDay = new Map<string, number[]>();
  for (const v of vs) { const n = Number(v.no); if (!Number.isFinite(n)) continue; const k = `${v.date}|${n >= 50000 ? 'B' : 'A'}`; const a = byDay.get(k) ?? []; a.push(n); byDay.set(k, a); }
  const rows: CheckResult['rows'] = [];
  let days = 0, missing = 0;
  for (const [k, ns] of [...byDay.entries()].sort()) {
    ns.sort((a, b) => a - b);
    const set = new Set(ns), gap: number[] = [];
    for (let i = ns[0] >= 50000 ? 50001 : 1; i <= ns[ns.length - 1]; i++) if (!set.has(i)) gap.push(i);
    if (gap.length) { days++; missing += gap.length; rows.push([k.split('|')[0], ns.length, ns[ns.length - 1], gap.length, gap.slice(0, 15).join(', ') + (gap.length > 15 ? ' …' : '')]); }
  }
  return {
    ...base('B10'), status: missing ? '예외' : '통과',
    summary: missing ? `빈 번호가 있는 날 ${days}일 · 빈 번호 ${missing}개 — 삭제 · 취소 전표인지 회사에 확인` : '날짜별 전표번호에 빈 번호가 없음을 확인하였음',
    method: ['날짜별로 매기는 전표번호의 빈 번호를 찾아 삭제 · 취소된 전표인지 확인함'],
    head: ['전표일자', '전표 수', '마지막 번호', '빈 번호 수', '빈 번호'], rows, stats: { days, missing },
  };
}

export function scenRound(vs: Voucher[], p: JeParams): CheckResult {
  const list = vs.filter((v) => (v.dr >= p.roundUnit * 10 && r0(v.dr) % p.roundUnit === 0) || v.lines.some((l) => /9999/.test(String(r0(Math.max(Math.abs(l.dr), Math.abs(l.cr)))))));
  return pick('B11', list, `${won(p.roundUnit)}원 단위 라운드 · 9999 포함`, ['전표금액이 단위의 배수인 큰 금액이거나 금액에 「9999」가 들어간 전표를 추출함']);
}

export function scenMemo(vs: Voucher[], p: JeParams): CheckResult {
  const re = new RegExp(p.memoWords);
  const list = vs.filter((v) => v.lines.some((l) => re.test(l.memo)) || v.lines.every((l) => !l.memo));
  return pick('B12', list, '모호한 적요 · 적요 없는', [`적요에 「${p.memoWords.split('|').join(' · ')}」가 있거나 적요가 없는 전표를 추출함`], ['걸린 낱말'],
    (v) => [v.lines.map((l) => re.exec(l.memo)?.[0]).filter(Boolean).slice(0, 3).join(', ') || '(적요 없음)']);
}

/** B14 당기 신규 계정 — 전기 분개장(JAYTAX 에 올린 전년 건)의 계정 목록에 없는 계정을 쓴 전표. */
export function scenNewAccounts(lines: JeLine[], vs: Voucher[], prior: Map<string, string> | null): CheckResult {
  if (!prior?.size) return noData('B14', '전기 분개장이 JAYTAX 에 없어 수행하지 못함(전년 건에 분개장을 올리면 대조)');
  const fresh = new Map<string, string>();
  for (const l of lines) if (!prior.has(l.acctCode)) fresh.set(l.acctCode, l.acctName);
  const keys = new Set(lines.filter((l) => fresh.has(l.acctCode)).map(vkey));
  return pick('B14', vs.filter((v) => keys.has(v.key)), `당기 신규 계정(${[...fresh.values()].slice(0, 5).join(' · ')}${fresh.size > 5 ? ' 외' : ''})을 사용한`,
    [`전기 분개장의 계정(${prior.size}개)과 대조하여 당기에 처음 쓴 계정 ${fresh.size}개의 분개를 추출함`], ['신규 계정'],
    (v) => [[...new Set(v.lines.filter((l) => fresh.has(l.acctCode)).map((l) => l.acctName))].join(', ')]);
}

export const scenNegative = (vs: Voucher[]) => pick('B13', vs.filter((v) => v.lines.some((l) => l.dr < 0 || l.cr < 0)), '음수 금액이 있는', ['차변 · 대변에 음수 금액이 있는 전표(역분개 · 취소)를 추출함']);

export interface RunInput {
  lines: JeLine[];
  /** 회사 제시 기초 · 기말(재무상태표 계정). 영림원은 원장에서 만든 것. */ balances: BsBalance[] | null;
  /** 계정과목표(코드 모음) — 시산표 · 원장 계정 */ coa: Set<string> | null;
  from: string; to: string;
  bench: Bench;
  params: JeParams & { matExclude?: string[]; matSide?: '양쪽' | '차변만' };
  codeOf?: (c: string) => string;
  /** 분개장에 작성자 등이 있는가(더존 · 영림원은 없다) */ hasUser?: boolean;
  /** 전기 분개장 계정(코드 → 이름) — B14 */ priorAccounts?: Map<string, string> | null;
}

/** 전체 검사. 결과는 조서 순서(1 → 18). */
export function runAll(inp: RunInput): CheckResult[] {
  const codeOf = inp.codeOf ?? ((c: string) => c);
  const vs = vouchers(inp.lines);
  const user = '분개장에 작성자 · 승인자 · 입력일 필드가 없어 수행하지 못함(ERP 출력 형식)';
  return [
    checkValidity(inp.lines, inp.from, inp.to),
    checkRequired(inp.lines),
    checkBalance(vs),
    checkOpening(inp.lines, inp.balances, codeOf),
    scenMateriality(inp.lines, inp.bench, inp.params.matExclude ?? [], inp.params.matSide ?? '양쪽'),
    scenCoa(inp.lines, vs, inp.coa, codeOf),
    scenRare(inp.lines, inp.params),
    noData('B04', user),
    noData('B05', `${user} — 13_기말결산분개로 보완`),
    noData('B06', user),
    scenSalesPartner(vs, inp.params),
    scenHoliday(vs, inp.params),
    scenClosing(vs, inp.to, inp.params),
    scenGaps(vs),
    scenRound(vs, inp.params),
    scenMemo(vs, inp.params),
    scenNegative(vs),
    scenNewAccounts(inp.lines, vs, inp.priorAccounts ?? null),
  ];
}

/** 영림원 원장 시산표 → 회사 제시 잔액(재무상태표 계정). 원장 잔액 부호는 계정의 정상 방향이 +. */
export function balancesFromTb(tb: TbRow[]): BsBalance[] {
  return tb.filter((t) => isBsCode(t.acctCode)).map((t) => {
    // 원장 잔액은 정상 방향 +: 차변 계정이면 기말 = 기초 + 차 − 대. 맞지 않으면 대변 계정.
    const side: 1 | -1 = r0(t.close - (t.open + t.dr - t.cr)) === 0 ? 1 : -1;
    return { acctCode: t.acctCode, acctName: t.acctName, open: t.open, close: t.close, side };
  });
}

/**
 * 정산표 WBS 줄(계정 이름 · 전기말 · 당기말 · 방향) → 잔액표 줄. 분개장 계정과 이름으로 잇는다.
 *   · 이름이 같은 분개장 계정이 하나면 그 코드.
 *   · 「감가상각누계액-건물」 「대손충당금-외상매출금」처럼 차감 계정은 본 계정(건물) 다음 코드 가운데 같은 이름(감가상각누계액)인 첫 계정 — 더존은 202 건물 · 203 감가상각누계액.
 *   · 이름이 같은 계정이 여럿이거나 못 찾으면 코드를 비운다 — 대사 때 이름이 같은 계정을 모두 더하고, 같은 이름 줄끼리 묶음으로 본다.
 */
export function matchWbs(rows: { name: string; open: number; close: number; side: 1 | -1 }[], accts: { code: string; name: string }[]): BsBalance[] {
  // 「정기예.적금」 = 「정기예적금」, 「부가세대급금_일반전표」 = 「부가세대급금」(아마란스 하위 계정).
  const nm = (x: string) => x.replace(/_.*$/, '').replace(/[\s().·]/g, '');
  const byName = new Map<string, string[]>();
  // 하위 계정(아마란스 1350001 · 영림원 13101)은 본 계정이 따로 있으면 이름 짝에서 뺀다 — 대사 때 parentCode 로 본 계정에 더해진다.
  const codeSet = new Set(accts.map((a) => a.code));
  const isSub = (c: string) => (c.length === 7 && !c.endsWith('0000') && codeSet.has(`${c.slice(0, 3)}0000`)) || (c.length === 5 && !c.endsWith('00') && codeSet.has(`${c.slice(0, 3)}00`));
  for (const a of accts) { if (isSub(a.code)) continue; const k = nm(a.name); byName.set(k, [...(byName.get(k) ?? []), a.code]); }
  const CONTRA = /^(감가상각누계액|대손충당금|손상차손누계액|정부보조금|국고보조금|현재가치할인차금)[-_·:]?(.+)$/;
  const taken = new Set<string>();
  const out: BsBalance[] = rows.map((r) => {
    let code = '';
    const exact = byName.get(nm(r.name)) ?? [];
    if (exact.length === 1) code = exact[0];
    else if (!exact.length) {
      const m = CONTRA.exec(nm(r.name));
      if (m) {
        const assets = (byName.get(m[2]) ?? []).sort();
        const bases = (byName.get(m[1]) ?? []).filter((c) => !taken.has(c)).sort();
        for (const a of assets) { const c = bases.find((b) => b > a); if (c) { code = c; break; } }
      }
    }
    if (code) taken.add(code);
    return { acctCode: code, acctName: r.name, open: r.open, close: r.close, group: null, side: r.side };
  });
  // 본 계정(비품 · 시설장치)이 분개장에 없어 짝을 못 찾은 차감 계정 — 남은 같은 이름 계정과 정산표 순서 = 코드 순서로 짝짓는다(더존은 자산 다음 코드가 그 누계액).
  for (const base of ['감가상각누계액', '대손충당금', '손상차손누계액', '정부보조금', '국고보조금', '현재가치할인차금']) {
    const left = (byName.get(base) ?? []).filter((c) => !taken.has(c)).sort();
    const want = out.filter((b) => !b.acctCode && CONTRA.exec(nm(b.acctName))?.[1] === base);
    if (left.length && left.length === want.length) want.forEach((b, i) => { b.acctCode = left[i]; taken.add(left[i]); });
  }
  return out;
}
