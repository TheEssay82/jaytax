// 웹 조서 목록 — 어느 조서를 JAYTAX 화면에서 쓰는가, 몇 차 확정에 속하는가(사용자 결정 2026-09-27).
// def 가 없는 것은 아직 만드는 중이다 — 보드에 「준비 중」으로 보여 계획을 한눈에 보게 한다.
import type { StageNo } from './gwpStage';
import type { WebPaperDef } from './gwpWeb';
import { PAPER_2110A } from './gwpPaper2110A';

export interface WebPaperEntry {
  code: string;
  title: string;
  stage: StageNo;
  /** 채우는 곳·하는 일 한 줄 */ note: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  def?: WebPaperDef<any>;
  /** 📎 — 웹으로 1차 작성 뒤 엑셀로 넘겨 별도조서를 붙인다 */ attach?: boolean;
}

export const WEB_PAPERS: WebPaperEntry[] = [
  { code: '2110A', title: '업무분장표', stage: 1, note: PAPER_2110A.note, def: PAPER_2110A },
  { code: '2110', title: '감사계획의 수립', stage: 1, note: '감사일정·실사장소·보고서 예정일' },
  { code: '2120A', title: '위험평가 분석적절차', stage: 1, note: '자료함의 전기 DSD 로 당기 열을 채운다' },
  { code: '2301', title: '감사위험의 평가', stage: 1, note: '계정별 위험 — 작년 판단·양식 작성사례로 추천, 확인 후 확정' },
  { code: '2700A-1', title: '중요성 산정 적용지침', stage: 1, note: 'Benchmark·적용률 고르기' },
  { code: '2700A-2', title: '중요성(감사계획단계)', stage: 1, note: '기준 금액은 전기 재무제표에서' },
  { code: '2700A-3', title: '중요성(감사수행단계)', stage: 2, note: '1차 값을 기본으로, 바뀐 것만' },
  { code: '2700A-4', title: '중요성(감사완결단계)', stage: 3, note: '2차 값을 기본으로. 8110ARP 기준으로 이어진다' },
  { code: '8110ARP', title: '종결단계 분석적검토', stage: 3, note: '자료함의 확정 정산표로 당기 숫자, 증감 큰 줄만 Explanation' },
  { code: '3500', title: '특수관계자 등', stage: 3, note: '웹으로 1차 작성 → 엑셀로 넘겨 별도조서를 붙인다', attach: true },
];
