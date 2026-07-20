// 조회서 조회처 명세 — 엑셀 양식 다운로드 / 업로드 파싱
// 용도 3가지
//  1) 빈 양식 다운로드: 거래처에 보내 조회처 목록을 받아오는 용도
//  2) 기존 명세 다운로드: 전기 리스트를 내려받아 손본 뒤 다시 올리는 용도
//  3) 업로드: 위 양식을 읽어 조회처 명세로 변환
import * as XLSX from 'xlsx';
import { ITEM_KINDS, DEFAULT_CONTACT, type ItemInput, type ItemKind } from './confirmApi';

const HEADERS = [
  'No.', '구분', '금융기관명', '조회방식', '주소', '우편번호', '전화번호',
  '부서', '담당자명', '직책', '비고',
] as const;

const GUIDE = `구분: ${ITEM_KINDS.join(' / ')}   ·   조회방식: 전자조회 / 우편   ·   전자조회면 주소·우편번호는 비워 두세요`;

function sheetFrom(rows: (string | number)[][]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([[GUIDE], [...HEADERS], ...rows]);
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: HEADERS.length - 1 } }];
  ws['!cols'] = HEADERS.map((h) => {
    if (h === '주소' || h === '비고') return { wch: 40 };
    if (h === '금융기관명') return { wch: 22 };
    if (h === 'No.') return { wch: 5 };
    return { wch: 13 };
  });
  ws['!freeze'] = { xSplit: 0, ySplit: 2 };
  return ws;
}

/** 빈 양식 — 거래처 배포용. 예시 한 줄을 넣어 형식을 알려준다. */
export function downloadBlankTemplate(companyName?: string): void {
  const sample = [1, '은행', '（예시）국민은행', '전자조회', '', '', '', '', DEFAULT_CONTACT, '', ''];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFrom([sample]), '조회처목록');
  XLSX.writeFile(wb, `금융기관조회서_조회처양식${companyName ? `_${companyName}` : ''}.xlsx`);
}

/** 기존 명세 다운로드 — 전기 리스트를 손봐서 다시 올릴 때 */
export function downloadItems(companyName: string, fiscalYear: number, items: ItemInput[]): void {
  const rows = items.map((it, i) => [
    it.seq || i + 1,
    it.kind,
    it.institution,
    it.isElectronic ? '전자조회' : '우편',
    it.isElectronic ? '' : it.address,
    it.isElectronic ? '' : it.postalCode,
    it.phone,
    it.dept,
    it.contactName,
    it.contactTitle,
    it.note,
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFrom(rows), '조회처목록');
  XLSX.writeFile(wb, `금융기관조회서_${companyName}_${fiscalYear}.xlsx`);
}

export interface ParseResult {
  items: ItemInput[];
  /** 무시했거나 고쳐 읽은 행 안내 — 사용자에게 그대로 보여준다 */
  warnings: string[];
}

/** 헤더 행을 찾는다. 양식이 아니어도 '금융기관명'/'거래처명' 열이 있으면 읽는다. */
function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? '').replace(/\s/g, ''));
    if (cells.some((c) => c === '금융기관명' || c === '거래처명') && cells.some((c) => c === '구분')) return i;
  }
  return -1;
}

const norm = (v: unknown) => String(v ?? '').trim();

/** 조서 꼬리말(1차/2차 회수율 확인란) — 여기서부터는 조회처 명세가 아니다. */
const FOOTER = ['1차회수율', '2차회수율', '확인및조치', '합계', '일자', '담당', '서명'];
function isFooterRow(kindRaw: string, institution: string): boolean {
  const a = kindRaw.replace(/\s/g, '');
  const b = institution.replace(/\s/g, '');
  return FOOTER.includes(a) || FOOTER.includes(b);
}

/** 구분 값 보정 — 2025 파일의 '증권회사·보험회사·여신전문금융회사·비은행금융회사' 표기를 흡수 */
function normalizeKind(raw: string): ItemKind | null {
  const s = raw.replace(/\s/g, '');
  if (!s) return null;
  if ((ITEM_KINDS as readonly string[]).includes(s)) return s as ItemKind;
  if (s.startsWith('은행')) return '은행';
  if (s.startsWith('증권')) return '증권';
  if (s.startsWith('보증')) return '보증기관';
  if (s.startsWith('여신')) return '여신전문';
  if (s.startsWith('비은행')) return '비은행금융';
  if (s.startsWith('보험')) return '보험';
  return null;
}

/** 업로드 파일 → 조회처 명세. 첫 시트만 읽는다. */
export async function parseItemsFile(file: File): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('시트를 읽을 수 없습니다.');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });

  const h = findHeaderRow(rows);
  if (h < 0) {
    throw new Error("양식을 알아볼 수 없습니다. '구분'과 '금융기관명' 열이 있는 양식을 올려 주세요.");
  }
  const head = (rows[h] || []).map((c) => String(c ?? '').replace(/\s/g, ''));
  const col = (...names: string[]) => head.findIndex((c) => names.includes(c));

  const cKind = col('구분');
  const cName = col('금융기관명', '거래처명');
  const cWay = col('조회방식');
  const cAddr = col('주소');
  const cPost = col('우편번호');
  const cPhone = col('전화번호');
  const cDept = col('부서');
  const cPerson = col('담당자명', '담당자');
  const cTitle = col('직책');
  const cNote = col('비고', '특이사항');

  const items: ItemInput[] = [];
  const warnings: string[] = [];
  // 표기 정리는 행마다 알리면 시끄러우므로 매핑별로 묶어서 한 줄로 알린다.
  const fixed = new Map<string, number>();

  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const institution = norm(r[cName]);
    if (!institution) continue; // 빈 행(양식의 여유 행)은 조용히 건너뛴다
    const kindRaw = norm(r[cKind]);
    if (isFooterRow(kindRaw, institution)) break; // 조서 꼬리말(회수율 확인란)부터는 명세가 아니다
    const kind = normalizeKind(kindRaw);
    if (!kind) {
      warnings.push(`${i + 1}행 '${institution}' — 구분('${kindRaw}')을 알 수 없어 건너뜀`);
      continue;
    }
    if (kindRaw.replace(/\s/g, '') !== kind) {
      const key = `'${kindRaw}' → '${kind}'`;
      fixed.set(key, (fixed.get(key) ?? 0) + 1);
    }

    const addr = cAddr >= 0 ? norm(r[cAddr]) : '';
    const way = cWay >= 0 ? norm(r[cWay]) : '';
    // 조회방식 열이 없던 2025 양식은 주소칸에 '전자조회'라고 적어 구분했다. 둘 다 인식한다.
    const isElectronic = way.replace(/\s/g, '') === '전자조회' || addr.replace(/\s/g, '') === '전자조회';

    items.push({
      seq: items.length + 1,
      kind,
      institution,
      isElectronic,
      address: isElectronic ? '' : addr,
      postalCode: isElectronic || cPost < 0 ? '' : norm(r[cPost]),
      phone: cPhone >= 0 ? norm(r[cPhone]) : '',
      dept: cDept >= 0 ? norm(r[cDept]) : '',
      contactName: (cPerson >= 0 ? norm(r[cPerson]) : '') || DEFAULT_CONTACT,
      contactTitle: cTitle >= 0 ? norm(r[cTitle]) : '',
      note: cNote >= 0 ? norm(r[cNote]) : '',
    });
  }

  if (!items.length) throw new Error('읽어들일 조회처가 없습니다. 금융기관명이 채워진 행이 있는지 확인해 주세요.');
  // 표기 정리는 묶음 안내를 앞에 둔다(개별 문제 행보다 덜 급한 정보라서).
  const summary = [...fixed.entries()].map(([k, n]) => `구분 표기 정리 ${k} ${n}건`);
  return { items, warnings: [...summary, ...warnings] };
}

// ── 진행현황 조서 출력 ──────────────────────────────────────
import type { Confirmation, ConfirmItem, Progress } from './confirmApi';
import { summarize, pct } from './confirmApi';

const d = (s: string | null) => (s ? s.replace(/-/g, '.') : '');

/**
 * 거래처별 진행현황 조서(.xlsx) — 2025 control sheet 의 개별 시트 형태를 따른다.
 * 머리(회사명·기준일·담당회계사·발송일) / 본문(조회처 명세 + 발송·회수) / 꼬리(회수율 확인란).
 */
export function exportConfirmationSheet(conf: Confirmation, items: ConfirmItem[]): void {
  const p = summarize(items);
  const aoa: (string | number)[][] = [
    ['금융기관조회서(적극적 조회) Control Sheet'],
    [],
    ['회사명', conf.companyName, '', '조회서발송', '일    자', d(p.firstSentDate)],
    ['조회발송기준일', d(conf.baseDate), '', '', '담    당', ''],
    ['담당회계사', conf.accountantName, '', '', '서    명', ''],
    [],
    ['No.', '구분', '금융기관명', '조회방식', '주소', '우편번호', '전화번호',
     '부서', '담당자명', '직책', '등기번호', '발송일', '회수', '반송사유', '발송대상'],
  ];

  items.forEach((it, i) => {
    aoa.push([
      i + 1,
      it.kind,
      it.institution,
      it.isElectronic ? '전자조회' : '실물발송',
      it.isElectronic ? '전자조회' : it.address,
      it.isElectronic ? '' : it.postalCode,
      it.phone,
      it.dept,
      it.contactName,
      it.contactTitle,
      it.isElectronic ? '' : it.trackingNo,
      d(it.sentDate),
      it.collectStatus === '회수완료' ? 'O' : it.collectStatus === '반송' ? '반송' : '',
      it.returnReason,
      it.sent ? 1 : '',
    ]);
  });

  aoa.push([]);
  aoa.push(['합계', '', '', '', '', '', '', '', '', '', '', '', `${p.collected}`, '', `${p.sent}`]);
  aoa.push([
    '발송', `전자 ${p.elecSent}/${p.elecTotal}`, `실물 ${p.postSent}/${p.postTotal}`,
    `합계 ${p.sent}/${p.total} (${pct(p.sent, p.total)}%)`,
  ]);
  aoa.push([
    '회수', `전자 ${p.elecCollected}/${p.elecSent}`, `실물 ${p.postCollected}/${p.postSent}`,
    `합계 ${p.collected}/${p.sent} (${pct(p.collected, p.sent)}%)`,
    p.returned ? `반송 ${p.returned}건` : '',
  ]);
  aoa.push([]);
  aoa.push(['', '1차 회수율', '일    자', '', '조치내용']);
  aoa.push(['', '확인및조치', '담    당']);
  aoa.push(['', '', '서    명']);
  aoa.push([]);
  aoa.push(['', '2차 회수율', '일    자', '', '조치내용']);
  aoa.push(['', '확인및조치', '담    당']);
  aoa.push(['', '', '서    명']);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 5 }, { wch: 12 }, { wch: 24 }, { wch: 10 }, { wch: 40 }, { wch: 9 }, { wch: 14 },
    { wch: 12 }, { wch: 18 }, { wch: 9 }, { wch: 18 }, { wch: 11 }, { wch: 7 }, { wch: 26 }, { wch: 9 },
  ];
  ws['!freeze'] = { xSplit: 0, ySplit: 7 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '조회서');
  XLSX.writeFile(wb, `금융기관조회서_${conf.companyName}_${conf.fiscalYear}_진행현황.xlsx`);
}

/** 연도 총괄 — 거래처 한 줄씩. 2025 파일의 '조회서 총괄시트'에 대응한다. */
export function exportYearSummary(
  year: number,
  rows: { conf: Confirmation; progress: Progress }[],
): void {
  const head = [
    '거래처명', '조회서 구분', '조회처수', '전자조회', '실물발송',
    '발송', '발송률(%)', '회수', '회수률(%)', '반송',
    '전자 발송/회수', '실물 발송/회수', '최초발송일', '최종발송일', '담당회계사', '기준일',
  ];
  const body = rows.map(({ conf: c, progress: p }) => [
    c.companyName, '금융기관조회서', p.total, p.elecTotal, p.postTotal,
    p.sent, pct(p.sent, p.total), p.collected, pct(p.collected, p.sent), p.returned,
    `${p.elecSent}/${p.elecCollected}`, `${p.postSent}/${p.postCollected}`,
    d(p.firstSentDate), d(p.lastSentDate), c.accountantName, d(c.baseDate),
  ]);

  const t = rows.reduce(
    (a, { progress: p }) => {
      a.total += p.total; a.elec += p.elecTotal; a.post += p.postTotal;
      a.sent += p.sent; a.collected += p.collected; a.returned += p.returned;
      a.elecSent += p.elecSent; a.elecCol += p.elecCollected;
      a.postSent += p.postSent; a.postCol += p.postCollected;
      return a;
    },
    { total: 0, elec: 0, post: 0, sent: 0, collected: 0, returned: 0, elecSent: 0, elecCol: 0, postSent: 0, postCol: 0 },
  );

  const aoa: (string | number)[][] = [
    [`${year} 회계연도 금융기관조회서 총괄`],
    [],
    head,
    ...body,
    [],
    ['합계', '', t.total, t.elec, t.post, t.sent, pct(t.sent, t.total), t.collected, pct(t.collected, t.sent), t.returned,
     `${t.elecSent}/${t.elecCol}`, `${t.postSent}/${t.postCol}`],
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = head.map((h) => ({ wch: h === '거래처명' ? 28 : h.length > 8 ? 15 : 11 }));
  ws['!freeze'] = { xSplit: 0, ySplit: 3 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '총괄');
  XLSX.writeFile(wb, `금융기관조회서_총괄_${year}.xlsx`);
}
