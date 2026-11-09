// K-IFRS 제1118호 월결산 — 회사 SAP 분개장 하나로 1118 손익계산서를 만든다(사용자 2026-11-09). supabase 를 물지 않는다.
//
// 회사는 신설 CoA 를 쓰지 않고 **기존 계정 그대로** 기표한다고 본다. 그래도 되는 까닭:
//   넵튠 SAP 손익 계정은 이미 원천별로 나뉘어 있다(외환차익-외상매출금 / -미지급금 / -예금 / -환전,
//   이자수익-예금 / -대여금 / -임차보증금 …). 그래서 「계정 하나 = 범주 하나」 판단표(accounts)만으로
//   FY2026 반기 인덕 T6 결과가 원 단위까지 재현됐다(1,560개 분석 라인 중 계정 안에서 범주가 갈린 것은 2건).
// 남는 것은 세 가지다:
//   ① 계리보고서로만 아는 금액(사외적립자산 이자수익 · 기타장기 이자원가) → actuarial(연간 × 경과월 ÷ 12)
//   ② 같은 계정에 투자 · 재무 거래가 섞일 수 있는 「주의계정」 → 같은 전표에 투자 · 재무 BS 계정이 있으면
//      검토 대상으로 띄우고(상대계정 자동 분석), 사람이 판단한 것(judgments)을 옮긴다
//   ③ 그 밖의 수동 조정(manual)
//
// 금액 부호: 분개장 · 시산 · 조정은 **차변+**(비용 +, 수익 −). 손익계산서 · 주석은 **수익+**.
// 원장 데이터(분개장)는 브라우저 안에서만 읽는다 — 서버로 보내는 것은 판단표 · 판단 기록뿐이다.

export const CATS = ['영업', '투자', '재무', '법인세', '임시'] as const;
export type Cat = (typeof CATS)[number];
export const L1001S = ['영업수익', '영업비용', '기타수익', '기타비용', '금융수익', '금융비용', '법인세비용', '임시계정'] as const;
export type L1001 = (typeof L1001S)[number];
export const LINES_1118 = [
  '영업수익', '영업비용', '기타영업수익', '무형자산손상차손', '기타영업비용',
  '종속기업·관계기업 관련 손익', '투자수익', '대여금 손상차손', '기타투자비용',
  '재무수익', '재무비용', '법인세비용',
] as const;
export type Line1118 = (typeof LINES_1118)[number];
export type Special = '' | '무형자산손상' | '종속관계' | '대여금손상';
export const BS_ATTRS = ['영업', '투자', '재무', '현금', '중립', '법인세'] as const;
export type BsAttr = (typeof BS_ATTRS)[number];

/** 손익 계정 하나의 판단. kcat = 크래프톤(모회사) 매핑 범주, ncat = 회사 판단이 다를 때만. */
export interface AcctRule {
  gl: string;
  name: string;
  l1001: L1001;
  kcat: Cat;
  ncat?: Cat | null;
  special?: Special;
  /** 주석(#6~#8) 세부항목. 비면 1118 표시항목 */ detail?: string;
  /** 주의계정 — 같은 계정에 투자 · 재무 거래가 섞일 수 있다 */ watch?: boolean;
  note?: string;
}
export interface ActuarialItem {
  key: string;
  label: string;
  /** 회사가 이 금액을 섞어 기표하는 계정 */ srcGl: string;
  target: Line1118;
  /** 연간 금액(원천 계정 기준 차변+) */ annual: number;
  /** 월할 대신 직접 넣은 당기 금액 */ override?: number | null;
  note?: string;
}
export interface ManualAdj { srcGl: string; target: Line1118; amount: number; reason: string }
export interface Ifrs18Config {
  clientKey: string;
  clientName: string;
  /** 판단표를 어디서 가져왔나(예: 「인덕 T1 FY26 반기 · 크래프톤 매핑 2026.10.20」) */ source?: string;
  accounts: AcctRule[];
  bsAttr: Record<string, BsAttr>;
  actuarial: ActuarialItem[];
  manual?: ManualAdj[];
}
export type Decision = '영업 유지' | '조정';
export interface Judgment {
  docNo: string;
  gl: string;
  decision: Decision;
  /** 비우면 제안 항목 */ target?: Line1118 | null;
  reason: string;
  byName?: string | null;
  at?: string | null;
}

export interface JLine {
  docNo: string;
  /** YYYY-MM-DD */ date: string;
  gl: string;
  glName: string;
  dr: number;
  cr: number;
  memo: string;
  vendor: string;
  /** SAP 임시전표(구분 X) — 시산(PKG)에 없으므로 셈에서 뺀다 */ temp: boolean;
}

// ── 분개장 읽기 ────────────────────────────────────────────────
// SAP 에서 내려받은 그대로 받는다. 열 순서는 보지 않고 **머리글 이름**으로 찾는다
// (회사가 열을 골라 옮기다 틀리는 일을 없애려고 — 사용자 2026-11-09 「복사-붙여넣기가 번거롭다」).
const HEADS: Record<string, string[]> = {
  docNo: ['전표번호'],
  date: ['전기일'],
  gl: ['G/L 계정', 'G/L계정', 'G/L'],
  glName: ['G/L 계정명', 'G/L계정명'],
  dr: ['차변금액(로컬)'],
  cr: ['대변금액(로컬)'],
  memo: ['라인텍스트'],
  vendor: ['고객/구매처코드명', '거래처명'],
  temp: ['임시전표구분'],
};
const REQUIRED = ['docNo', 'date', 'gl', 'glName', 'dr', 'cr'] as const;

const s = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => {
  if (typeof v === 'number') return v;
  const t = String(v ?? '').replace(/[,\s]/g, '');
  if (!t) return 0;
  const neg = /^\(.*\)$/.test(t);
  const n = Number(t.replace(/[()]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
};
function toYmd(v: unknown): string {
  // 엑셀 날짜를 Date 로 받으면 시간대 때문에 하루 밀릴 수 있다(KST 자정 = UTC 전날 15시) — 반나절 더해 날짜만 취한다.
  if (v instanceof Date) return new Date(v.getTime() + 43200000).toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const t = s(v).replace(/[./]/g, '-');
  const m = t.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : t;
}

export interface ParsedSap { lines: JLine[]; head: number; missing: string[]; skipped: number }

/** SAP 분개장 시트의 행 배열(header:1) → 표준 줄. 머리글은 앞 20행에서 찾는다. */
export function parseSapJournal(rows: unknown[][]): ParsedSap {
  let head = -1;
  let col: Record<string, number> = {};
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const cells = (rows[r] ?? []).map(s);
    const found: Record<string, number> = {};
    for (const [k, names] of Object.entries(HEADS)) {
      const i = cells.findIndex((c) => names.includes(c));
      if (i >= 0) found[k] = i;
    }
    if (REQUIRED.every((k) => k in found)) { head = r; col = found; break; }
  }
  if (head < 0) {
    const first = (rows[0] ?? []).map(s);
    return { lines: [], head: -1, missing: REQUIRED.filter((k) => !HEADS[k].some((n) => first.includes(n))).map((k) => HEADS[k][0]), skipped: 0 };
  }
  const lines: JLine[] = [];
  let skipped = 0;
  for (let r = head + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const gl = s(row[col.gl]).replace(/\.0+$/, '');
    const docNo = s(row[col.docNo]).replace(/\.0+$/, '');
    if (!/^\d{6,10}$/.test(gl) || !docNo) { skipped++; continue; }
    lines.push({
      docNo, date: toYmd(row[col.date]), gl, glName: s(row[col.glName]),
      dr: num(row[col.dr]), cr: num(row[col.cr]),
      memo: col.memo != null ? s(row[col.memo]) : '', vendor: col.vendor != null ? s(row[col.vendor]) : '',
      temp: col.temp != null && s(row[col.temp]).toUpperCase() === 'X',
    });
  }
  return { lines, head, missing: [], skipped };
}

// ── 판단 ──────────────────────────────────────────────────────
export const isPl = (gl: string) => gl[0] >= '4';
export const catOf = (a: AcctRule): Cat => a.ncat || a.kcat;
const incomeLike = (l: L1001) => l === '기타수익' || l === '금융수익' || l === '영업수익';

/** 1118 표시항목 — 범주 × 1001 항목 × 특수구분. 엑셀 모델(참고1 H열)과 같은 규칙. */
export function line1118(a: AcctRule): Line1118 | '임시계정' | '확인필요' {
  const c = catOf(a);
  const l = a.l1001;
  if (c === '임시') return '임시계정';
  if (c === '법인세') return '법인세비용';
  if (c === '영업') {
    if (a.special === '무형자산손상') return '무형자산손상차손';
    if (l === '영업수익' || l === '영업비용') return l;
    return l === '기타수익' || l === '금융수익' ? '기타영업수익' : '기타영업비용';
  }
  if (c === '투자') {
    if (a.special === '종속관계') return '종속기업·관계기업 관련 손익';
    if (a.special === '대여금손상') return '대여금 손상차손';
    return incomeLike(l) ? '투자수익' : '기타투자비용';
  }
  if (c === '재무') return l === '기타수익' || l === '금융수익' ? '재무수익' : '재무비용';
  return '확인필요';
}

/** 주의계정 라인을 다른 범주로 옮길 때의 제안 항목 — 같은 전표 투자 · 재무 계정의 속성으로. */
export function suggestTarget(a: AcctRule | undefined, attr: BsAttr): Line1118 | null {
  if (!a) return null;
  const inc = a.l1001 === '기타수익' || a.l1001 === '금융수익';
  if (attr === '투자') return inc ? '투자수익' : '기타투자비용';
  if (attr === '재무') return inc ? '재무수익' : '재무비용';
  return null;
}

export const keyOf = (docNo: string, gl: string) => `${docNo}|${gl}`;

// ── 계산 ──────────────────────────────────────────────────────
export interface TbRow {
  gl: string; name: string; amt: number; registered: boolean;
  l1001: L1001 | '확인필요'; cat: Cat | '확인필요'; l1118: string; detail: string; watch: boolean;
}
export interface WatchLine {
  docNo: string; date: string; gl: string; glName: string; amt: number; memo: string;
  cpName: string; cpAttr: BsAttr; suggest: Line1118 | null;
  decision: Decision | '미판단';
}
export interface Move {
  kind: '계리' | '판단' | '수동';
  label: string;
  srcGl: string;
  src: string;
  target: string;
  /** 차변+ */ amount: number;
}
export interface Check { id: string; label: string; ok: boolean; fix: string }
export interface Ifrs18Result {
  year: number; month: number;
  lineCount: number; tempCount: number;
  tb: TbRow[];
  unregisteredBs: string[];
  watch: WatchLine[];
  moves: Move[];
  /** 수익+ */ pl1118: Record<string, number>;
  pl1001: Record<string, number>;
  bridge: { label: string; amount: number; note: string }[];
  notes: { line: string; detail: string; amount: number }[];
  checks: Check[];
}

const r0 = (n: number) => Math.round(n);

export function compute(lines: JLine[], cfg: Ifrs18Config, judgments: Judgment[], year: number, month: number): Ifrs18Result {
  const acc = new Map(cfg.accounts.map((a) => [a.gl, a]));
  const live = lines.filter((l) => !l.temp);

  // 1) 시산 = 분개장 손익 계정 합계(임시전표 제외). 크래프톤 PKG 시산과 같다(FY26 반기 실측 차이 0).
  const sum = new Map<string, { name: string; amt: number }>();
  for (const l of live) {
    if (!isPl(l.gl)) continue;
    const t = sum.get(l.gl) ?? { name: l.glName, amt: 0 };
    t.amt += l.dr - l.cr;
    sum.set(l.gl, t);
  }
  const tb: TbRow[] = [...sum.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([gl, v]) => {
    const a = acc.get(gl);
    if (!a) return { gl, name: v.name, amt: r0(v.amt), registered: false, l1001: '확인필요', cat: '확인필요', l1118: '확인필요', detail: '', watch: false };
    const l = line1118(a);
    return { gl, name: a.name || v.name, amt: r0(v.amt), registered: true, l1001: a.l1001, cat: catOf(a), l1118: l, detail: a.detail || l, watch: !!a.watch };
  });

  // 2) 주의계정 — 같은 전표에 투자 · 재무 속성 BS 계정이 있는 라인.
  const attrOf = (gl: string): BsAttr | null => cfg.bsAttr[gl] ?? null;
  const unregisteredBs = [...new Set(live.filter((l) => !isPl(l.gl) && !attrOf(l.gl)).map((l) => l.gl))].sort();
  const irByDoc = new Map<string, JLine>();
  for (const l of live) {
    if (isPl(l.gl)) continue;
    const a = attrOf(l.gl);
    if ((a === '투자' || a === '재무') && !irByDoc.has(l.docNo)) irByDoc.set(l.docNo, l);
  }
  const jmap = new Map(judgments.map((j) => [keyOf(j.docNo, j.gl), j]));
  const watch: WatchLine[] = [];
  for (const l of live) {
    const a = acc.get(l.gl);
    if (!a?.watch) continue;
    const cp = irByDoc.get(l.docNo);
    if (!cp) continue;
    const cpAttr = attrOf(cp.gl)!;
    watch.push({
      docNo: l.docNo, date: l.date, gl: l.gl, glName: a.name, amt: r0(l.dr - l.cr), memo: l.memo,
      cpName: cp.glName, cpAttr, suggest: suggestTarget(a, cpAttr),
      decision: jmap.get(keyOf(l.docNo, l.gl))?.decision ?? '미판단',
    });
  }

  // 3) 옮길 금액 — 계리 · 판단(조정) · 수동. 원천 항목에서 빼서 대상 항목에 넣는다.
  const moves: Move[] = [];
  const srcLine = (gl: string) => { const a = acc.get(gl); return a ? line1118(a) : '확인필요'; };
  for (const x of cfg.actuarial) {
    const amt = x.override != null ? x.override : r0((x.annual * month) / 12);
    if (!amt) continue;
    moves.push({ kind: '계리', label: x.label, srcGl: x.srcGl, src: srcLine(x.srcGl), target: x.target, amount: amt });
  }
  const docGl = new Map<string, number>();
  for (const l of live) docGl.set(keyOf(l.docNo, l.gl), (docGl.get(keyOf(l.docNo, l.gl)) ?? 0) + l.dr - l.cr);
  for (const j of judgments) {
    if (j.decision !== '조정') continue;
    const amt = r0(docGl.get(keyOf(j.docNo, j.gl)) ?? 0);
    if (!amt) continue;
    const w = watch.find((x) => x.docNo === j.docNo && x.gl === j.gl);
    const target = j.target || w?.suggest || '확인필요';
    moves.push({ kind: '판단', label: `${j.docNo} ${j.reason}`.trim(), srcGl: j.gl, src: srcLine(j.gl), target, amount: amt });
  }
  for (const m of cfg.manual ?? []) {
    if (!m.amount) continue;
    moves.push({ kind: '수동', label: m.reason, srcGl: m.srcGl, src: srcLine(m.srcGl), target: m.target, amount: r0(m.amount) });
  }

  // 4) 손익계산서
  const pl1118: Record<string, number> = {};
  for (const n of LINES_1118) pl1118[n] = 0;
  for (const t of tb) pl1118[t.l1118] = (pl1118[t.l1118] ?? 0) - t.amt;
  for (const m of moves) {
    pl1118[m.src] = (pl1118[m.src] ?? 0) + m.amount;
    pl1118[m.target] = (pl1118[m.target] ?? 0) - m.amount;
  }
  const v = (k: string) => pl1118[k] ?? 0;
  pl1118['영업손익'] = v('영업수익') + v('영업비용') + v('기타영업수익') + v('무형자산손상차손') + v('기타영업비용');
  pl1118['재무손익 및 법인세비용차감전손익'] = v('영업손익') + v('종속기업·관계기업 관련 손익') + v('투자수익') + v('대여금 손상차손') + v('기타투자비용');
  pl1118['법인세비용차감전순손익'] = v('재무손익 및 법인세비용차감전손익') + v('재무수익') + v('재무비용');
  pl1118['당기순손익'] = v('법인세비용차감전순손익') + v('법인세비용');

  const pl1001: Record<string, number> = {};
  for (const n of L1001S) pl1001[n] = 0;
  for (const t of tb) if (t.l1001 !== '확인필요') pl1001[t.l1001] -= t.amt;
  pl1001['영업이익'] = pl1001['영업수익'] + pl1001['영업비용'];
  pl1001['법인세비용차감전순이익'] = pl1001['영업이익'] + pl1001['기타수익'] + pl1001['기타비용'] + pl1001['금융수익'] + pl1001['금융비용'];
  pl1001['당기순이익'] = pl1001['법인세비용차감전순이익'] + pl1001['법인세비용'] + pl1001['임시계정'];

  // 5) 브릿지 — 1001 영업이익 → 1118 영업손익
  const sumBy = (f: (t: TbRow) => boolean) => tb.filter(f).reduce((s2, t) => s2 - t.amt, 0);
  const opLines = new Set(['영업수익', '영업비용', '기타영업수익', '무형자산손상차손', '기타영업비용']);
  const tbOp = sumBy((t) => opLines.has(t.l1118));
  const bridge = [
    { label: '1001 영업이익', amount: pl1001['영업이익'], note: '' },
    { label: '＋ 영업비용 중 영업 아닌 것 제외', amount: -sumBy((t) => t.l1001 === '영업비용' && t.cat !== '영업'), note: '예: 순이자원가 → 재무' },
    { label: '＋ 기타수익 중 영업', amount: sumBy((t) => t.l1001 === '기타수익' && t.cat === '영업'), note: '외환차이(영업 원천) · 잡이익 · 리스처분이익 등' },
    { label: '＋ 금융수익 중 영업', amount: sumBy((t) => t.l1001 === '금융수익' && t.cat === '영업'), note: '파생상품(선물환) · 임차보증금 이자' },
    { label: '＋ 기타비용 중 영업', amount: sumBy((t) => t.l1001 === '기타비용' && t.cat === '영업'), note: '외환차이 · 무형자산손상 · 처분손실 · 잡손실 등' },
    { label: '＋ 금융비용 중 영업', amount: sumBy((t) => t.l1001 === '금융비용' && t.cat === '영업'), note: '파생상품 거래 · 평가손실' },
    { label: '＋ 계리 금액 · 조정 중 영업 영향', amount: pl1118['영업손익'] - tbOp, note: '' },
  ];
  bridge.push({ label: '→ 1118 영업손익', amount: bridge.reduce((s2, b) => s2 + b.amount, 0), note: '' });

  // 6) 주석 금액(#6~#8) — 1118 표시항목 × 세부항목, 조정은 따로 한 줄
  const noteMap = new Map<string, number>();
  for (const t of tb) {
    if (t.l1118 === '영업수익' || t.l1118 === '영업비용' || t.l1118 === '법인세비용' || t.amt === 0) continue;
    const k = `${t.l1118}\u0000${t.detail}`;
    noteMap.set(k, (noteMap.get(k) ?? 0) - t.amt);
  }
  for (const m of moves) {
    for (const [ln, sg] of [[m.src, 1], [m.target, -1]] as const) {
      if (ln === '영업수익' || ln === '영업비용' || ln === '법인세비용') continue;
      const k = `${ln}\u0000계리 금액 · 조정`;
      noteMap.set(k, (noteMap.get(k) ?? 0) + sg * m.amount);
    }
  }
  const order = (ln: string) => LINES_1118.indexOf(ln as Line1118);
  const notes = [...noteMap.entries()].map(([k, amount]) => { const [line, detail] = k.split('\u0000'); return { line, detail, amount }; })
    .sort((a, b) => order(a.line) - order(b.line) || a.detail.localeCompare(b.detail));

  // 7) 마감 확인(자동)
  const checks: Check[] = [
    { id: 'lines', label: '분개장이 읽혔음', ok: live.length > 0, fix: 'SAP 분개장 xlsx 를 다시 올리기' },
    { id: 'reg', label: '손익 계정이 모두 판단표에 등록됨', ok: tb.every((t) => t.registered), fix: '미등록 계정을 판단표에 추가(인덕 문의)' },
    { id: 'chk', label: '1118 표시항목 「확인필요」 0', ok: tb.every((t) => t.l1118 !== '확인필요') && moves.every((m) => m.src !== '확인필요' && m.target !== '확인필요'), fix: '판단표의 1001 항목 · 범주 확인' },
    { id: 'temp', label: '임시계정 잔액 0', ok: tb.filter((t) => t.l1118 === '임시계정').every((t) => t.amt === 0), fix: 'SAP 임시 · 전환 계정 정리 후 다시 내려받기' },
    { id: 'bs', label: 'BS 계정 속성 모두 등록', ok: unregisteredBs.length === 0, fix: '미등록 BS 계정 속성 추가(인덕 문의)' },
    { id: 'watch', label: '주의계정 미판단 라인 0', ok: watch.every((w) => w.decision !== '미판단'), fix: 'STEP 4 에서 판단 기록' },
    { id: 'ni', label: '당기순이익 1001 = 1118', ok: r0(pl1001['당기순이익'] - pl1118['당기순손익']) === 0, fix: '인덕 문의' },
    { id: 'bridge', label: '영업손익 브릿지 = 1118 영업손익', ok: r0(bridge[bridge.length - 1].amount - pl1118['영업손익']) === 0, fix: '인덕 문의' },
  ];

  return { year, month, lineCount: live.length, tempCount: lines.length - live.length, tb, unregisteredBs, watch, moves, pl1118, pl1001, bridge, notes, checks };
}

export const PL1118_ORDER: { label: string; key: string; sub?: boolean }[] = [
  { label: 'Ⅰ. 영업수익', key: '영업수익' }, { label: 'Ⅱ. 영업비용', key: '영업비용' }, { label: 'Ⅲ. 기타영업수익', key: '기타영업수익' },
  { label: 'Ⅳ. 무형자산손상차손', key: '무형자산손상차손' }, { label: 'Ⅴ. 기타영업비용', key: '기타영업비용' }, { label: 'Ⅵ. 영업손익', key: '영업손익', sub: true },
  { label: '  종속기업·관계기업 관련 손익', key: '종속기업·관계기업 관련 손익' }, { label: '  투자수익', key: '투자수익' },
  { label: '  대여금 손상차손', key: '대여금 손상차손' }, { label: '  기타투자비용', key: '기타투자비용' },
  { label: 'Ⅶ. 재무손익 및 법인세비용차감전손익', key: '재무손익 및 법인세비용차감전손익', sub: true },
  { label: '  재무수익', key: '재무수익' }, { label: '  재무비용', key: '재무비용' },
  { label: 'Ⅷ. 법인세비용차감전순손익', key: '법인세비용차감전순손익', sub: true }, { label: '  법인세수익(비용)', key: '법인세비용' },
  { label: 'Ⅸ. 당기순손익', key: '당기순손익', sub: true },
];
export const PL1001_ORDER: { label: string; key: string; sub?: boolean }[] = [
  { label: '영업수익', key: '영업수익' }, { label: '영업비용', key: '영업비용' }, { label: '영업이익', key: '영업이익', sub: true },
  { label: '기타수익', key: '기타수익' }, { label: '기타비용', key: '기타비용' }, { label: '금융수익', key: '금융수익' }, { label: '금융비용', key: '금융비용' },
  { label: '법인세비용차감전순이익', key: '법인세비용차감전순이익', sub: true }, { label: '법인세비용', key: '법인세비용' },
  { label: '당기순이익', key: '당기순이익', sub: true },
];

/** 판단표 파일(JSON) 검사 — 올리기 전에 모양만 본다. */
export function validateConfig(x: unknown): { ok: true; cfg: Ifrs18Config } | { ok: false; error: string } {
  const c = x as Partial<Ifrs18Config>;
  if (!c || typeof c !== 'object') return { ok: false, error: 'JSON 이 아닙니다' };
  if (!c.clientKey || !/^[a-z0-9-]{2,40}$/.test(c.clientKey)) return { ok: false, error: 'clientKey(영문 소문자·숫자·-) 가 필요합니다' };
  if (!c.clientName) return { ok: false, error: 'clientName 이 필요합니다' };
  if (!Array.isArray(c.accounts) || !c.accounts.length) return { ok: false, error: 'accounts(계정 판단표) 가 비었습니다' };
  for (const a of c.accounts) {
    if (!a.gl || !(L1001S as readonly string[]).includes(a.l1001) || !(CATS as readonly string[]).includes(a.kcat))
      return { ok: false, error: `계정 ${a.gl ?? '?'}: gl · l1001 · kcat 을 확인하세요` };
    if (a.ncat && !(CATS as readonly string[]).includes(a.ncat)) return { ok: false, error: `계정 ${a.gl}: ncat 값이 이상합니다` };
  }
  if (!c.bsAttr || typeof c.bsAttr !== 'object') return { ok: false, error: 'bsAttr(BS 속성) 가 필요합니다' };
  if (!Array.isArray(c.actuarial)) return { ok: false, error: 'actuarial 이 배열이 아닙니다' };
  return { ok: true, cfg: c as Ifrs18Config };
}
