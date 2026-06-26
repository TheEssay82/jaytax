// 도메인 타입 정의 — 원본 HTML(ver.4.6)의 데이터 모델을 TypeScript로 옮긴 것

export type BizType = '법인' | '개인';

/** 업무량 선택지 라벨 (원본 pills 옵션과 동일) */
export type VisitCount = '없음' | '2회이하' | '5회이하' | '10회이하' | '10회초과';
export type PhoneCount = '없음' | '10회이하' | '30회이하' | '60회이하' | '60회초과';
export type Difficulty = '해당없음' | '쉬움' | '보통' | '어려움';
export type WorkAmount = 'X' | '적음' | '보통' | '많음';
export type YesNo = 'O' | 'X';
export type EvCount = '없음' | '2회이하' | '5회이하' | '10회이하' | '10회초과';
export type ModelFeeMode = 'default' | 'none' | 'custom';

/** 누진 구간: flat(정액, 첫 구간) 또는 rate(누진율). upTo 단위는 원, 9.9e15 = ∞ 센티넬 */
export interface Bracket {
  upTo: number;
  flat?: number;
  rate?: number;
}

/** 거래처 (원본 localStorage `ind_cli4`) */
export interface Client {
  id: string;
  bizType: BizType;
  companyName: string;
  tradeName: string;
  taxId: string;
  repName: string;
  manager: string;
  bankAccount: string;
  isModel: boolean;
  /** 귀속연도별 매출액 {year: amount} */
  revenues: Record<string, number>;
  /** 귀속연도별 담당자 {year: name} */
  managers?: Record<string, string>;
  /** 귀속연도별 성실신고 {year: boolean} */
  modelYears?: Record<string, boolean>;
  /** 상실 연도 */
  lossYears?: number[];
  createdAt?: string;
  updatedAt?: string;
}

/** 위저드 입력 상태 (원본 `mkS()`) — 청구서 1건의 입력값 전체 */
export interface WizardState {
  selClientId: string | null;
  bizType: BizType;
  companyName: string;
  tradeName: string;
  taxId: string;
  repName: string;
  manager: string;
  revenue: string;
  fiscalYear: number;
  isModel: boolean;
  bankAccount: string;
  issuedDate: string;
  payMonth: string;
  payDay: string;
  visitCount: VisitCount;
  visitDiff: Difficulty;
  phoneCount: PhoneCount;
  phoneDiff: Difficulty;
  장부P: YesNo;
  장부A: WorkAmount;
  장부D: Difficulty;
  결산P: YesNo;
  결산A: WorkAmount;
  결산D: Difficulty;
  조정P: YesNo;
  조정A: WorkAmount;
  조정D: Difficulty;
  원가P: YesNo;
  원가A: WorkAmount;
  원가D: Difficulty;
  원가T: string;
  evCount: EvCount;
  otherContent: string;
  otherAmt: string;
  penaltyContent: string;
  penaltyAmt: string;
  discContent: string;
  discAmt: string;
  modelFeeMode: ModelFeeMode;
  modelFeeAmt: string;
}

/** calcS() 산출 결과 */
export interface CalcResult {
  rev: number;
  isLaw: boolean;
  baseFee: number;
  scale: number;
  A: number;
  modelFee: number;
  r4: number;
  f4: number;
  r5: number;
  f5: number;
  r6: number;
  f6: number;
  Btot: number;
  evFee: number;
  otherFee: number;
  penFee: number;
  f7: number;
  C: number;
  disc: number;
  D: number;
  VAT: number;
  grand: number;
}

/** 청구기록 (원본 `ind_hist4`) = WizardState + CalcResult + 메타 */
export interface BillingRecord extends WizardState, CalcResult {
  id: string;
  savedAt: string;
  cfgVersionId: string;
  cfgVersionLabel: string;
}

/** 업데이트요청 상태 */
export type RequestStatus = '미접수' | '개발중' | '개발완료' | '미반영종료';

/** 업데이트요청 댓글 */
export interface RequestComment {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

/** 업데이트요청 (원본 `ind_reqs4`) */
export interface UpdateRequest {
  id: string;
  requester: string;
  content: string;
  status: RequestStatus;
  comments: RequestComment[];
  createdAt: string;
  updatedAt?: string;
}

/** 설정 (원본 `ind_cfg4` / DEF) */
export interface AppConfig {
  성실신고기본: number;
  방문횟수: Record<string, number>;
  전화횟수: Record<string, number>;
  상담난이도: Record<string, number>;
  업무해당: Record<string, number>;
  업무량: Record<string, number>;
  업무난이도: Record<string, number>;
  증빙금액: Record<string, number>;
  lawBrackets: Bracket[];
  perBrackets: Bracket[];
  cfgVersionLabel: string;
  cfgVersionId: string;
  cfgHistory: unknown[];
  helpTexts: Record<string, string>;
}
