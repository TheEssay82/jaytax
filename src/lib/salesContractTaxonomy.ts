// 매출유형 분류체계(코드 고정 트리) — 감사team / taxteam 계층 + leaf 플래그.
// 계약은 leaf 의 code 를 category_code 로 저장한다. 플래그가 등록폼의 추가입력을 유발한다.
export type Team = '감사team' | 'taxteam';

export interface TaxNode {
  code: string;              // 전역 유일. leaf 는 계약에 저장.
  label: string;
  children?: TaxNode[];
  // ── leaf 플래그 ──
  needsEtcName?: boolean;    // '기타' → 신고대상명칭 입력(#3)
  jangbuOptions?: boolean;   // '기장' → 부가세·원천세 포함여부(#4)
  advisoryType?: boolean;    // '회계및세무자문' → 일반/전문(#4)
  filingAgentEligible?: boolean; // taxteam 신고 부가·원천 → 기장없으면 '신고대리'(#4)
  linksConfirmation?: boolean;   // '회계감사' → 조회서 발송대상 참조(#11)
  /** 이 leaf 의 기본 발생단위(#3,6) — 폼에서 자동제시. */
  defaultUnit?: '사업장' | '법인' | '개인';
  /** 이 leaf 의 기본 청구주기 — 폼에서 자동설정(예: 회계감사=연). */
  defaultCycle?: '월' | '분기' | '반기' | '연' | '발생시' | '건';
}

export const TAXONOMY: Record<Team, TaxNode[]> = {
  '감사team': [
    { code: 'AUD.AUDIT', label: '회계감사', linksConfirmation: true, defaultUnit: '법인', defaultCycle: '연' },
    {
      code: 'AUD.SVC', label: '용역', children: [
        {
          code: 'AUD.SVC.FILING', label: '신고(세무조정포함)', children: [
            { code: 'AUD.SVC.FILING.CORP', label: '법인세', defaultUnit: '법인' },
            { code: 'AUD.SVC.FILING.INCOME', label: '소득세', defaultUnit: '개인' },
            { code: 'AUD.SVC.FILING.TRANSFER', label: '양도세', defaultUnit: '개인' },
            { code: 'AUD.SVC.FILING.INHERIT', label: '상증세', defaultUnit: '개인' },
            { code: 'AUD.SVC.FILING.SECURITIES', label: '증권거래세' },
            { code: 'AUD.SVC.FILING.RECTIFY', label: '경정청구' },
            { code: 'AUD.SVC.FILING.ETC', label: '기타', needsEtcName: true },
          ],
        },
        {
          code: 'AUD.SVC.VALUATION', label: '평가', children: [
            { code: 'AUD.SVC.VAL.ENTERPRISE', label: '기업가치(CGU포함)평가' },
            { code: 'AUD.SVC.VAL.INTANGIBLE', label: '무형자산(영업권·PPA포함)' },
            { code: 'AUD.SVC.VAL.INHERIT', label: '상증세' },
            { code: 'AUD.SVC.VAL.DERIVATIVE', label: '파생상품(옵션포함)' },
            { code: 'AUD.SVC.VAL.ETC', label: '기타', needsEtcName: true },
          ],
        },
        {
          code: 'AUD.SVC.CONSULT', label: '컨설팅', children: [
            { code: 'AUD.SVC.CON.IFRS', label: 'IFRS전환' },
            { code: 'AUD.SVC.CON.ICFR_BUILD', label: '내부회계구축' },
            { code: 'AUD.SVC.CON.ICFR_PA', label: '내부회계PA' },
            { code: 'AUD.SVC.CON.ADVISORY', label: '자문' },
            { code: 'AUD.SVC.CON.ETC', label: '기타', needsEtcName: true },
          ],
        },
      ],
    },
  ],
  'taxteam': [
    { code: 'TAX.BOOK', label: '기장', jangbuOptions: true, defaultUnit: '사업장' },
    {
      code: 'TAX.FILING', label: '신고', children: [
        { code: 'TAX.FILING.VAT', label: '부가가치세', filingAgentEligible: true, defaultUnit: '사업장' },
        { code: 'TAX.FILING.WHT', label: '원천세(연말정산포함)', filingAgentEligible: true, defaultUnit: '사업장' },
        { code: 'TAX.FILING.CORP', label: '법인세', defaultUnit: '법인' },
        { code: 'TAX.FILING.INCOME', label: '소득세', defaultUnit: '개인' },
        { code: 'TAX.FILING.TRANSFER', label: '양도소득세', defaultUnit: '개인' },
        { code: 'TAX.FILING.INHERIT', label: '상증세', defaultUnit: '개인' },
        { code: 'TAX.FILING.SECURITIES', label: '증권거래세' },
        { code: 'TAX.FILING.RECTIFY', label: '수정·경정' },
        { code: 'TAX.FILING.ETC', label: '기타', needsEtcName: true },
      ],
    },
    {
      code: 'TAX.CONSULT', label: '컨설팅', children: [
        { code: 'TAX.CON.RECTIFY', label: '수정·경정' },
        { code: 'TAX.CON.BOOK_REVIEW', label: '기장검토' },
        { code: 'TAX.CON.WHT_REVIEW', label: '원천세검토' },
        { code: 'TAX.CON.VAT_REVIEW', label: '부가세검토' },
        { code: 'TAX.CON.ADVISORY', label: '회계및세무자문', advisoryType: true },
        {
          code: 'TAX.CON.ETC', label: '기타', children: [
            { code: 'TAX.CON.ETC.RECEIPT', label: '증빙발행', defaultUnit: '사업장' },
            { code: 'TAX.CON.ETC.ETC', label: '기타', needsEtcName: true },
          ],
        },
      ],
    },
  ],
};

// ── 헬퍼 ────────────────────────────────────────────────
const INDEX = new Map<string, { node: TaxNode; team: Team; path: TaxNode[] }>();
function walk(team: Team, nodes: TaxNode[], parents: TaxNode[]) {
  for (const n of nodes) {
    const path = [...parents, n];
    INDEX.set(n.code, { node: n, team, path });
    if (n.children) walk(team, n.children, path);
  }
}
(Object.keys(TAXONOMY) as Team[]).forEach((t) => walk(t, TAXONOMY[t], []));

export const isLeaf = (n: TaxNode) => !n.children || n.children.length === 0;
export function findNode(code: string) { return INDEX.get(code) ?? null; }
export function teamOf(code: string): Team | null { return INDEX.get(code)?.team ?? null; }
/** leaf 경로 라벨 (예: '용역 › 신고(세무조정포함) › 법인세'). */
export function pathLabel(code: string): string {
  const e = INDEX.get(code);
  return e ? e.path.map((n) => n.label).join(' › ') : code;
}
/** leaf 노드(계약에 저장 가능한 최종 항목)만. */
export function leafOf(code: string): TaxNode | null {
  const e = INDEX.get(code);
  return e && isLeaf(e.node) ? e.node : null;
}

const TEAM_SHORT: Record<Team, string> = { '감사team': '감사', 'taxteam': '기장' };
/** 매출유형 leaf 선택지 — 엑셀 드롭다운/파싱용. label 은 팀+경로로 유일(중복 라벨 구분). */
export function contractTypeOptions(): { code: string; label: string }[] {
  const out: { code: string; label: string }[] = [];
  for (const [code, e] of INDEX) {
    if (isLeaf(e.node)) out.push({ code, label: `${TEAM_SHORT[e.team]}·${e.path.map((n) => n.label).join(' › ')}` });
  }
  return out;
}

// ── 매출계약코드용 유형 니모닉(사용자 확정 2026-08-11). 팀 안에서만 유일하면 됨(팀코드로 구분). ──
export const TYPE_MNEMONIC: Record<string, string> = {
  // 감사team
  'AUD.AUDIT': 'AUD',
  'AUD.SVC.FILING.CORP': 'CT', 'AUD.SVC.FILING.INCOME': 'IT', 'AUD.SVC.FILING.TRANSFER': 'TT',
  'AUD.SVC.FILING.INHERIT': 'IH', 'AUD.SVC.FILING.SECURITIES': 'ST', 'AUD.SVC.FILING.RECTIFY': 'RC',
  'AUD.SVC.FILING.ETC': 'FETC',
  'AUD.SVC.VAL.ENTERPRISE': 'VENT', 'AUD.SVC.VAL.INTANGIBLE': 'VINT', 'AUD.SVC.VAL.INHERIT': 'VIH',
  'AUD.SVC.VAL.DERIVATIVE': 'VDRV', 'AUD.SVC.VAL.ETC': 'VETC',
  'AUD.SVC.CON.IFRS': 'CIFR', 'AUD.SVC.CON.ICFR_BUILD': 'CICB', 'AUD.SVC.CON.ICFR_PA': 'CICP',
  'AUD.SVC.CON.ADVISORY': 'CADV', 'AUD.SVC.CON.ETC': 'CETC',
  // taxteam
  'TAX.BOOK': 'BK',
  'TAX.FILING.VAT': 'VAT', 'TAX.FILING.WHT': 'WHT', 'TAX.FILING.CORP': 'CT', 'TAX.FILING.INCOME': 'IT',
  'TAX.FILING.TRANSFER': 'TT', 'TAX.FILING.INHERIT': 'IH', 'TAX.FILING.SECURITIES': 'ST',
  'TAX.FILING.RECTIFY': 'RC', 'TAX.FILING.ETC': 'FETC',
  'TAX.CON.RECTIFY': 'CRC', 'TAX.CON.BOOK_REVIEW': 'CBKR', 'TAX.CON.WHT_REVIEW': 'CWHR',
  'TAX.CON.VAT_REVIEW': 'CVTR', 'TAX.CON.ADVISORY': 'ADV',
  'TAX.CON.ETC.RECEIPT': 'RCPT', 'TAX.CON.ETC.ETC': 'CETC',
};
/** 팀코드: 감사team=A, taxteam=T. */
export function teamCode(team: Team): 'A' | 'T' { return team === '감사team' ? 'A' : 'T'; }
/** 매출유형 leaf code → 니모닉(없으면 leaf 마지막 세그먼트 대문자). */
export function typeMnemonic(code: string): string {
  return TYPE_MNEMONIC[code] ?? code.split('.').pop()!.toUpperCase();
}
/** 매출계약코드용 유형 안내표 — 화면 도움말/엑셀에서 사용. */
export function typeMnemonicTable(): { team: Team; label: string; mnemonic: string }[] {
  const out: { team: Team; label: string; mnemonic: string }[] = [];
  for (const [code, e] of INDEX) {
    if (isLeaf(e.node)) out.push({ team: e.team, label: e.path.map((n) => n.label).join(' › '), mnemonic: typeMnemonic(code) });
  }
  return out;
}
