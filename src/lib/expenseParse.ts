// 팀결산 경비 귀속 — ERP 지출결의서 엑셀 읽기(브라우저 안에서, 저장 전).
//
// 받는 모양 셋을 머리글 이름으로 가려 읽는다:
//   ① ERP 「지출결의서 검색 › 상세검색」 결과 엑셀(검색결과 지출결의서 상세리스트) — 기본
//   ② 정우철 작업본(지출결의서 상세출력 + 개인/법카 · 클라이언트명 · 업무사용 · 개인사용 · 김준성/조현규 · 검토메모)
//   ③ 작년 송현주 양식(… 개인/법카 · 클라이언트명 · 업무사용 · 개인사용 · 비고)
// ②③ 의 사람 판단 칸은 **제안으로만** 가져온다(확정은 화면에서 줄마다).
export interface ParsedExpense {
  exjunpyoNo: string;
  lineNo: number;
  evidDate: string | null;
  title: string;
  description: string;
  account: string;
  vendor: string;
  supply: number;
  vat: number;
  total: number;
  invSlip: string;
  acctSlip: string;
  wfNo: string;
  writer: string;
  cardType: string;
  /** 작업본에 이미 적힌 판단(있으면) */
  prior?: { client: string | null; work: number | null; kjs: number; jhg: number; memo: string | null; excluded: boolean };
}

const t = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const n = (v: unknown) => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;
const toDate = (v: unknown): string | null => {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  const s = t(v).replace(/\./g, '-');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/** 시트 한 장(2차원 배열)에서 줄을 뽑는다. 머리글을 못 찾으면 null. */
export function parseExpenseRows(raw: unknown[][]): ParsedExpense[] | null {
  const hi = raw.findIndex((r) => r.some((c) => t(c) === '지출내역') && r.some((c) => t(c) === '공급가액'));
  if (hi < 0) return null;
  const h = raw[hi].map(t);
  const at = (...names: string[]) => { for (const nm of names) { const i = h.indexOf(nm); if (i >= 0) return i; } return -1; };
  const atLike = (re: RegExp) => h.findIndex((x) => re.test(x));
  const col = {
    no: (() => { const i = at('지출결의서번호', '지출결의서 번호'); return i >= 0 ? i : atLike(/지출결의서.*번호/); })(),
    line: at('라인번호', '번호'),
    date: at('증빙일자', '지출일자'),
    title: at('제목'),
    desc: at('지출내역'),
    acct: at('계정과목(차변)', '계정과목'),
    vendor: at('거래처명'),
    sup: at('공급가액'), vat: at('세액'), tot: at('합계'),
    inv: at('거래전표번호'), slip: at('회계전표번호'), wf: at('전자결재번호'),
    writer: at('라인사원명', '작성자', '귀속자'),
    card: at('개인/법카'),
    client: at('클라이언트명'), work: at('업무사용'), personal: at('개인사용'),
    kjs: at('김준성'), jhg: at('조현규'), memo: at('검토메모', '비고'),
  };
  if (col.no < 0 || col.desc < 0) return null;
  const out: ParsedExpense[] = [];
  let lastNo = '';
  const seen = new Map<string, number>();
  for (const r of raw.slice(hi + 1)) {
    let no = t(r[col.no]);
    if (/^합\s*계|^합계/.test(no) || r.some((c) => /^합\s*계$/.test(t(c)) && t(r[col.desc]) === '')) continue;
    if (!no && t(r[col.desc])) no = lastNo;                // 병합 셀로 번호가 비는 줄
    if (!/^\d{2}-\d{4}-\d{4}$/.test(no)) continue;
    lastNo = no;
    const desc = t(r[col.desc]);
    const sup = n(r[col.sup]);
    if (!desc && !sup) continue;
    const k = no; const ln = col.line >= 0 && n(r[col.line]) ? n(r[col.line]) : (seen.get(k) ?? 0) + 1;
    seen.set(k, ln);
    const title = col.title >= 0 ? t(r[col.title]) : '';
    const cardRaw = col.card >= 0 ? t(r[col.card]) : '';
    const p: ParsedExpense = {
      exjunpyoNo: no, lineNo: ln, evidDate: col.date >= 0 ? toDate(r[col.date]) : null, title,
      description: desc, account: col.acct >= 0 ? t(r[col.acct]) : '', vendor: col.vendor >= 0 ? t(r[col.vendor]) : '',
      supply: sup, vat: col.vat >= 0 ? n(r[col.vat]) : 0, total: col.tot >= 0 ? n(r[col.tot]) : sup,
      invSlip: col.inv >= 0 ? t(r[col.inv]) : '', acctSlip: col.slip >= 0 ? t(r[col.slip]) : '', wfNo: col.wf >= 0 ? t(r[col.wf]) : '',
      writer: col.writer >= 0 ? t(r[col.writer]) : '',
      cardType: cardRaw || (/신용카드/.test(title) ? '법카' : title ? '개인' : ''),
    };
    if (col.client >= 0 && (t(r[col.client]) || t(r[col.work]))) {
      const work = col.work >= 0 && t(r[col.work]) !== '' ? n(r[col.work]) : (col.personal >= 0 && t(r[col.personal]) !== '' ? sup - n(r[col.personal]) : null);
      const kjs = col.kjs >= 0 ? n(r[col.kjs + 1] ?? r[col.kjs]) : 0;   // 작업본은 「김준성 | 금액」 두 칸 — 금액은 다음 칸
      const jhg = col.jhg >= 0 ? n(r[col.jhg + 1] ?? r[col.jhg]) : 0;
      // 업무 0 · 개인 0 으로 적힌 줄 = 결산 제외(외상매출금 전환 등)
      const excluded = sup > 0 && work === 0 && col.personal >= 0 && t(r[col.personal]) !== '' && n(r[col.personal]) === 0 && !kjs && !jhg;
      p.prior = {
        excluded,
        client: t(r[col.client]) || null, work,
        kjs, jhg,
        memo: col.memo >= 0 ? (t(r[col.memo]) || null) : null,
      };
    }
    out.push(p);
  }
  return out;
}

/** 엑셀 파일 → 줄. 「지출내역·공급가액」 머리글이 있는 첫 시트를 쓴다. */
export async function parseExpenseFile(file: File): Promise<{ rows: ParsedExpense[]; sheet: string }> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  for (const name of wb.SheetNames) {
    const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '', raw: true });
    const rows = parseExpenseRows(raw);
    if (rows && rows.length) return { rows, sheet: name };
  }
  throw new Error('「지출내역」·「공급가액」 머리글이 있는 지출결의서 상세 시트를 찾지 못했습니다. ERP ▸ 지출결의서 검색 ▸ 상세검색 결과 엑셀을 올려 주세요.');
}

/** 정산기간: fy = 끝나는 해. FY2026 = 2025-07-01 ~ 2026-06-30 */
export const fyRange = (fy: number) => ({ from: `${fy - 1}-07-01`, to: `${fy}-06-30` });
/** 오늘 기준 기본 연도 — 가장 최근에 끝난 정산기간(10월이면 그해 6월 끝난 기간). */
export const defaultFy = (today = new Date()) => (today.getMonth() + 1 >= 7 ? today.getFullYear() : today.getFullYear() - 1);
/** 작성자 → 바구니. 송현주는 정우철 바구니(사용자 2026-10-19). */
export const basketOf = (writer: string): string | null =>
  writer === '송현주' ? '정우철' : (['정우철', '조현규', '김준성'].includes(writer) ? writer : null);
