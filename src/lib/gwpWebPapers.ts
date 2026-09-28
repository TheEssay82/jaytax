// 웹 조서 목록 — 어느 조서를 JAYTAX 화면에서 쓰는가, 몇 차 확정에 속하는가(사용자 결정 2026-09-27).
// def 가 없는 것은 아직 만드는 중이다 — 보드에 「준비 중」으로 보여 계획을 한눈에 보게 한다.
import type { StageNo } from './gwpStage';
import type { AuditBasis } from './gwpSetup';
import type { WebPaperDef } from './gwpWeb';
import { PAPER_2110A } from './gwpPaper2110A';
import { PAPER_2110 } from './gwpPaper2110';
import { PAPER_2120A } from './gwpPaper2120A';
import { PAPER_8110 } from './gwpPaper8110';
import { PAPER_2301 } from './gwpPaper2301';
import { PAPER_2301G } from './gwpPaper2301G';
import { PAPER_2520, PAPER_2530 } from './gwpPaperQA';
import { PAPER_2700A_1, PAPER_2700A_2, PAPER_2700A_3, PAPER_2700A_4 } from './gwpPaper2700A';

export interface WebPaperEntry {
  code: string;
  title: string;
  stage: StageNo;
  /** 채우는 곳·하는 일 한 줄 */ note: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  def?: WebPaperDef<any>;
  /** 📎 — 웹으로 1차 작성 뒤 엑셀로 넘겨 별도조서를 붙인다 */ attach?: boolean;
  /** 이 조서 기준에서만(소규모 2520·2530). 없으면 모든 기준. */ bases?: AuditBasis[];
}

/** 이 조서 기준에서 보이는 웹 조서. */
export function webPapersFor(basis: AuditBasis | null | undefined): WebPaperEntry[] {
  return WEB_PAPERS.filter((w) => !w.bases || (basis != null && w.bases.includes(basis)));
}

export const WEB_PAPERS: WebPaperEntry[] = [
  { code: '2110A', title: '업무분장표', stage: 1, note: PAPER_2110A.note, def: PAPER_2110A },
  { code: '2110', title: '감사계획의 수립', stage: 1, note: PAPER_2110.note, def: PAPER_2110 },
  { code: '2120A', title: '위험평가 분석적절차', stage: 1, note: PAPER_2120A.note, def: PAPER_2120A },
  // 2301 은 기준마다 표가 다르다(2026 개정) — 소규모: 전체 재무제표 5개 + 계정별 경영진주장, 일반·K-IFRS: 재무제표 수준 위험 표.
  { code: '2301', title: '감사위험의 평가', stage: 1, note: PAPER_2301.note, def: PAPER_2301, bases: ['소규모감사기준'] },
  { code: '2301', title: '중요왜곡표시위험(재무제표 수준)', stage: 1, note: PAPER_2301G.note, def: PAPER_2301G, bases: ['일반기업회계기준', 'K-IFRS'] },
  { code: '2520', title: '정보시스템 이해', stage: 1, note: PAPER_2520.note, def: PAPER_2520, bases: ['소규모감사기준'] },
  { code: '2530', title: '통제활동의 이해', stage: 1, note: PAPER_2530.note, def: PAPER_2530, bases: ['소규모감사기준'] },
  { code: '2700A-1', title: '중요성 산정 적용지침', stage: 1, note: PAPER_2700A_1.note, def: PAPER_2700A_1 },
  { code: '2700A-2', title: '중요성(감사계획단계)', stage: 1, note: PAPER_2700A_2.note, def: PAPER_2700A_2 },
  { code: '2700A-3', title: '중요성(감사수행단계)', stage: 2, note: PAPER_2700A_3.note, def: PAPER_2700A_3 },
  { code: '2700A-4', title: '중요성(감사완결단계)', stage: 3, note: PAPER_2700A_4.note, def: PAPER_2700A_4 },
  { code: '8110ARP', title: '종결단계 분석적검토(8110ARP·8110A)', stage: 3, note: PAPER_8110.note, def: PAPER_8110 },
  { code: '3500', title: '특수관계자 등', stage: 3, note: '나중에 — 특수관계자 검토조서와 함께(웹 1차 작성 → 엑셀로 넘겨 별도조서를 붙인다)', attach: true },
];
