// 메뉴별 권한 세 단계 — 접근 · 이용 · 쓰기(사용자 2026-10-05 「권한도 세분화하여 메뉴접근가능/이용가능/쓰기가능 등으로」).
//
//   접근 = 메뉴가 보이고 열린다. **원본은 lib/menu.ts 의 menuAllowed** — 여기서 다시 적지 않는다.
//   이용 = 연 화면에서 자료를 보고 쓸 수 있다(일부 탭·본인 기록만이면 「일부」 + 사유).
//   쓰기 = 만들기·고치기·지우기. 화면의 조건(canWrite·can()·readonly)과 서버 RLS 를 함께 본 결과(2026-10-05 전수 조사).
//
// 이 표는 **설명서가 아니라 대시보드의 원본**이다. 화면 코드의 조건을 바꾸면 여기도 같이 고친다 —
// permissions.test.ts 가 모든 메뉴가 빠짐없이 적혔는지, 쓰기가 접근보다 넓지 않은지, can() 과 어긋나지 않는지 본다.
// 쓰기 잠금(profiles.readonly) 계정은 등급과 상관없이 쓰기가 막힌다(대부분 화면·서버 공통).
import type { Role } from './roles';

/** true = 가능, false = 불가, 글자 = 일부만(그 사유), null = 이 화면엔 쓰기가 없다(조회 화면). */
export type Mark = boolean | string | null;
type Rule = Partial<Record<Role, Mark>> & { all?: Mark };
export interface MenuPerm { use?: Rule; write: Rule; note?: string }

const SU_AC_TL = { superuser: true, accountant: true, team_lead: true } as const;
const AUDIT = { superuser: true, accountant: true, per_head_accountant: true } as const;
const READ_ONLY: Rule = { all: null };

export const MENU_PERMS: Record<string, MenuPerm> = {
  // ── 거래처관리 ── 인당회계사는 서버(is_perhead)가 거래처·계약 쓰기를 막는다.
  'biz-register': { write: { all: true, team_member: '일부: 고치기만(거래처·사업장 등록·삭제 불가)', per_head_accountant: false }, note: '주민번호·홈택스 비밀번호 열람은 서버가 따로 판단 · 엑셀 가져오기는 최고관리자' },
  'biz-contract': { use: { all: true, team_member: '일부: 피벗·요약 표는 안 보임' }, write: { all: true, per_head_accountant: false } },
  'biz-contacts': { write: { all: true, per_head_accountant: false } },
  'biz-status': { write: { ...SU_AC_TL, team_member: false, per_head_accountant: false, all: false }, note: '쓰기는 예산 편집뿐(회계사·팀장·최고관리자)' },

  // ── 기장등청구관리 ──
  'invoice-request': {
    write: { superuser: true, team_lead: true, accountant: '일부: 최종확인·발행완료 제외', team_member: '일부: 최종확인·발행완료 제외(김민섭은 가능), 직원 확인은 김민섭·김동주·정남지', per_head_accountant: false },
  },
  'audit-invoice': {
    use: { all: true },
    write: { superuser: true, team_lead: true, accountant: '일부: 발행완료 제외', team_member: '일부: 발행완료 제외(김민섭은 가능)', per_head_accountant: '일부: 감사팀 발행요청 작성(발행완료 제외)' },
    note: '담당회계사 칸은 본인이 담당인 줄에서만 보인다',
  },
  'erp-reconcile': { write: { superuser: true, team_lead: true, accountant: '일부: 마감·해제 제외', team_member: '일부: 마감·해제 제외(김민섭은 가능)', per_head_accountant: false } },
  'receivable': { write: { all: true, per_head_accountant: false } },
  'staff-revenue': {
    use: { all: true, team_member: '일부: 예산 탭 안 보임' },
    write: { superuser: '일부: 예산', accountant: '일부: 예산', team_lead: '일부: 예산', per_head_accountant: '일부: 예산', team_member: false },
    note: '예산은 정남지·김민섭·김동주에게 안 보임',
  },
  'receivable-opening': { write: { all: true, per_head_accountant: false } },

  // ── 세무조정수수료관리 ──
  'targets': {
    write: { ...SU_AC_TL, team_member: '일부: 사업자번호·대표자·가상계좌·성실신고만', per_head_accountant: false },
    note: '청구대상 확정은 회계사·팀장·최고관리자',
  },
  'wizard': { write: { ...SU_AC_TL, team_member: '일부: 임시저장만(확정은 팀장 이상)', per_head_accountant: false, external: '시연 — 저장 불가' } },
  'history': {
    use: { all: true, per_head_accountant: '일부: 본인 기록만' },
    write: { ...SU_AC_TL, team_member: '일부: 본인 초안만 고치기·지우기', per_head_accountant: false },
  },
  'stats': { use: { ...SU_AC_TL, team_member: '일부: 본인 것만' }, write: READ_ONLY },
  'settings': { write: { all: true } },

  // ── 회계및세무상담관리 ──
  'std-kifrs': { write: READ_ONLY },
  'std-tax': { write: READ_ONLY },
  'consult': { write: { all: true, external: '시연 — 저장 불가' } },
  'consult-log': { write: { all: '일부: 본인 상담만', superuser: '일부: 본인 상담 + 남의 상담 확정', accountant: '일부: 본인 상담 + 남의 상담 확정', team_lead: '일부: 본인 상담 + 남의 상담 확정' } },
  'ai-usage': { write: READ_ONLY },

  // ── 감사업무관리 ── 조회서는 기장팀도 발송·회수를 처리한다(사용자 2026-10-05).
  'inquiry-send': { write: { all: true } },
  'conf-register': { write: { all: true } },
  'conf-dispatch': { write: { all: true } },
  'conf-collect': { write: { all: true } },
  'conf-status': { write: { all: true } },
  'wtb': { write: { ...AUDIT }, note: '만든 정산표는 그 건 자료함에 남는다' },
  'dsd': { write: { ...AUDIT, external: '시연 — 조회만' }, note: '「외부인에게 보여 주기」 표시는 최고관리자' },
  'gwp': { write: { ...AUDIT } },
  'je': { use: { all: '준비 중' }, write: READ_ONLY },

  // ── 일반업무관리 ──
  'doc-send-work': {
    use: { all: true, per_head_accountant: '일부: 발송 처리 탭 안 보임' },
    write: { superuser: true, team_lead: true, team_member: true, accountant: '일부: 발송요청만(처리는 조회)', per_head_accountant: '일부: 발송요청만' },
    note: '완전 삭제·휴지통 되살리기는 최고관리자',
  },
  'doc-status': { write: READ_ONLY },
  'evidence': { write: { ...SU_AC_TL, team_member: '일부: 올리기 + 본인 자료만 고치기', per_head_accountant: '일부: 올리기 + 본인 자료만 고치기' } },
  'vacation': { use: { all: '준비 중' }, write: READ_ONLY },
  'estimate': { use: { all: '준비 중' }, write: READ_ONLY },

  // ── 우측 아이콘 ──
  'requests': { write: { all: '일부: 올리기·댓글, 지우기는 본인 요청만', superuser: true }, note: '처리 상태 바꾸기는 최고관리자' },
  'users': { write: { all: true }, note: '본인 등급·잠금은 못 바꾼다' },
  'access-log': { write: READ_ONLY },
  'retention': { write: { all: true } },
  'backlog': { write: READ_ONLY },
  'service-limits': { write: READ_ONLY },
};

/** 메뉴 하나·등급 하나의 세 단계. access 는 menu.ts 에서 구해 넘긴다. */
export function levels(id: string, role: Role, access: boolean): { access: boolean; use: Mark; write: Mark } {
  const p = MENU_PERMS[id];
  if (!access) return { access: false, use: false, write: false };
  const pick = (r: Rule | undefined, dflt: Mark): Mark => (r ? (role in r ? r[role]! : r.all !== undefined ? r.all : dflt) : dflt);
  const use = pick(p?.use, true);
  if (use === false) return { access: true, use: false, write: false };
  const write = pick(p?.write, false);
  return { access: true, use, write: write === null ? null : use === '준비 중' ? null : write };
}
