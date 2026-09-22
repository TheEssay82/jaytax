// 발행 업무의 사람·규칙 — **DB 를 건드리지 않는 순수 모듈**이라 테스트에서 그대로 부른다.
//
// invoiceMonthApi 는 supabase 를 물고 있어(import.meta.env) node --test 로 못 읽는다.
// 그래서 상수·판정만 여기 두고 invoiceMonthApi 가 다시 내보낸다(기존 import 경로는 그대로 쓴다).

/** taxteam 월 확인 담당자 — 이 3인이 각자 확인을 눌러야 최종확인이 열린다. */
export const CHECKERS = ['김민섭', '김동주', '정남지'] as const;
/** 최종확인·발행완료를 누를 수 있는 사람. 김민섭이 원칙이고 부재 시 팀장·최고관리자. */
export const FINAL_APPROVER = '김민섭';
/** taxteam 작성일(발행기준일)은 매월 24일 고정. */
export const ISSUE_DAY = 24;

/** 감사팀 발행요청 화면의 세 자리. 요청=회계사가 올리는 곳, 발행=끊는 곳, 이력=끝난 것. */
export type AuditInvoicePane = 'request' | 'issue' | 'history';
/**
 * 그 화면을 열었을 때 먼저 보일 자리.
 * 발행 담당(김민섭)은 「끊으러」 들어오므로 🖨️ 발행 처리로 연다(2026-09-22 지시).
 * 이름이 아직 안 온 동안('')은 요청으로 두고, 이름이 도착하면 화면이 한 번 바로잡는다.
 */
export function defaultAuditInvoicePane(profileName: string): AuditInvoicePane {
  return profileName === FINAL_APPROVER ? 'issue' : 'request';
}
