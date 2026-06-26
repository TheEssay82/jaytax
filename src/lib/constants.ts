// 기본 설정값 — 원본 HTML(ver.4.6) DEF 객체를 그대로 옮긴 것
import type { AppConfig, Bracket, WizardState } from '../types';

/** 법인 기준수수료 누진 구간 */
export const LAW_BRACKETS: Bracket[] = [
  { upTo: 1e8, flat: 500000 },
  { upTo: 2e8, rate: 0.0018 },
  { upTo: 3e8, rate: 0.0016 },
  { upTo: 5e8, rate: 0.0013 },
  { upTo: 1e9, rate: 0.001 },
  { upTo: 1.5e9, rate: 0.0008 },
  { upTo: 3e9, rate: 0.0007 },
  { upTo: 5e9, rate: 0.0005 },
  { upTo: 7.5e9, rate: 0.0004 },
  { upTo: 1e10, rate: 0.00035 },
  { upTo: 2e10, rate: 0.00025 },
  { upTo: 3e10, rate: 0.0002 },
  { upTo: 5e10, rate: 0.00015 },
  { upTo: 9.9e15, rate: 0.0001 },
];

/** 개인 기준수수료 누진 구간 */
export const PER_BRACKETS: Bracket[] = [
  { upTo: 1e8, flat: 400000 },
  { upTo: 2e8, rate: 0.0017 },
  { upTo: 3e8, rate: 0.0015 },
  { upTo: 5e8, rate: 0.0012 },
  { upTo: 1e9, rate: 0.0009 },
  { upTo: 1.5e9, rate: 0.0008 },
  { upTo: 3e9, rate: 0.0007 },
  { upTo: 5e9, rate: 0.0006 },
  { upTo: 7.5e9, rate: 0.0005 },
  { upTo: 1e10, rate: 0.0004 },
  { upTo: 2e10, rate: 0.0003 },
  { upTo: 3e10, rate: 0.0002 },
  { upTo: 5e10, rate: 0.0001 },
  { upTo: 9.9e15, rate: 0.00008 },
];

/** 위저드 단계 라벨 */
export const STEP_LABELS = ['거래처 선택', '기본정보', '업무량', '수수료 확인', '금액 조정', '청구서'];

export const HELP_TEXTS: Record<string, string> = {
  방문:
    '방문 상담 횟수 기준입니다.\n사무실·현장 방문을 포함한 실제 방문 횟수로 산정합니다.\n\n- 없음: 방문 없음\n- 2회 이하: 연 1~2회\n- 5회 이하: 연 3~5회\n- 10회 이하: 연 6~10회\n- 10회 초과: 연 11회 이상',
  전화:
    '전화·문자·카카오톡 등 비대면 상담 횟수 기준입니다.\n업무 관련 연락의 총 횟수로 산정합니다.\n\n- 없음: 연락 없음\n- 10회 이하: 연 1~10회\n- 30회 이하: 연 11~30회\n- 60회 이하: 연 31~60회\n- 60회 초과: 연 61회 이상',
  장부:
    '계약 외 추가 기장 업무입니다.\n월별 거래명세 입력, 세금계산서·영수증 처리,\n급여명세 작성 등 기본 계약 범위를 초과한 업무를 기준으로 합니다.',
  결산:
    '연말결산 업무입니다.\n재무제표(손익계산서·재무상태표) 작성, 감가상각 계산,\n퇴직급여 계산 등 결산 관련 전반적인 업무를 포함합니다.',
  조정:
    '세무조정 업무입니다 (공인회계사 작성).\n세무조정계산서 작성, 소득금액 조정,\n익금산입/손금불산입 처리 등 세무조정 관련 업무 전반입니다.',
  원가:
    '원가계산 업무입니다.\n제조원가명세서, 공사원가계산서 등\n원가계산 관련 명세 작성 업무입니다.',
  증빙:
    '세금계산서 발행·수취 건수 기준입니다.\n현금영수증, 적격증빙 처리 건수를 포함합니다.\n\n- 없음: 0건\n- 2회 이하: 1~2건\n- 5회 이하: 3~5건\n- 10회 이하: 6~10건\n- 10회 초과: 11건 이상',
};

/** 기본 설정 (DEF) */
export const DEFAULT_CONFIG: AppConfig = {
  성실신고기본: 2000000,
  방문횟수: { 없음: 0, '2회이하': 0.02, '5회이하': 0.04, '10회이하': 0.06, '10회초과': 0.1 },
  전화횟수: { 없음: 0, '10회이하': 0.02, '30회이하': 0.04, '60회이하': 0.06, '60회초과': 0.1 },
  상담난이도: { 해당없음: 0, 쉬움: 0, 보통: 0.02, 어려움: 0.05 },
  업무해당: { O: 0.1, X: 0 },
  업무량: { X: 0, 적음: 0.02, 보통: 0.05, 많음: 0.1 },
  업무난이도: { 해당없음: 0, 쉬움: 0.05, 보통: 0.1, 어려움: 0.15 },
  증빙금액: { 없음: 0, '2회이하': 10000, '5회이하': 30000, '10회이하': 50000, '10회초과': 100000 },
  lawBrackets: LAW_BRACKETS,
  perBrackets: PER_BRACKETS,
  cfgVersionLabel: '기본',
  cfgVersionId: 'v0',
  cfgHistory: [],
  helpTexts: HELP_TEXTS,
};

export const CURRENT_YEAR = new Date().getFullYear();
/** 귀속연도 목록: 당해년도 포함 최근 4개년 */
export const REV_YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3];
/** 선택 가능한 전체 연도 범위 (2020 ~ CY+2) */
export const ALL_YEARS = Array.from({ length: CURRENT_YEAR + 3 - 2020 }, (_, i) => CURRENT_YEAR + 2 - i);

/** 위저드 초기 상태 (원본 mkS()) */
export function makeWizardState(): WizardState {
  return {
    selClientId: null,
    bizType: '법인',
    companyName: '',
    tradeName: '',
    taxId: '',
    repName: '',
    manager: '',
    revenue: '',
    fiscalYear: CURRENT_YEAR - 1,
    isModel: false,
    bankAccount: '',
    issuedDate: new Date().toISOString().split('T')[0],
    payMonth: '',
    payDay: '31',
    visitCount: '없음',
    visitDiff: '해당없음',
    phoneCount: '없음',
    phoneDiff: '해당없음',
    장부P: 'X',
    장부A: 'X',
    장부D: '해당없음',
    결산P: 'X',
    결산A: 'X',
    결산D: '해당없음',
    조정P: 'X',
    조정A: 'X',
    조정D: '해당없음',
    원가P: 'X',
    원가A: 'X',
    원가D: '해당없음',
    원가T: '',
    evCount: '없음',
    otherContent: '',
    otherAmt: '',
    penaltyContent: '',
    penaltyAmt: '',
    discContent: '',
    discAmt: '',
    modelFeeMode: 'default',
    modelFeeAmt: '',
  };
}
