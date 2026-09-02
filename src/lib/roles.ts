// 사용자 역할(등급) 및 권한 정의 — 권한 매트릭스(2026-06-27 확정)
// per_head_accountant(인당회계사): 외부 위촉 성격의 제한 등급이지만 **조회 범위는 계속 넓어졌다**.
//   · 2026-08 거래처관리 조회 허용(biz_* SELECT 개방, 쓰기·PII복호는 차단)
//   · 2026-09-03 기장등청구관리·세무조정수수료관리·회계및세무상담관리 **조회** 허용
//     (마이그 0121 로 perhead_block_select RESTRICTIVE 정책 제거). 쓰기는 등급별 정책이 그대로 막는다.
//   아직 숨기는 것: 발송요청 처리 · ERP 발행내역 대사 · 통계 · AI 사용량 · 기초 미수금 입력 · 설정 · 사용자 관리.
export type Role = 'superuser' | 'accountant' | 'team_lead' | 'team_member' | 'per_head_accountant' | 'external';

export const ROLES: Role[] = ['superuser', 'accountant', 'team_lead', 'team_member', 'per_head_accountant', 'external'];

export const ROLE_LABELS: Record<Role, string> = {
  superuser: '최고관리자',
  accountant: '회계사',
  team_lead: '기장팀장',
  team_member: '기장팀원',
  per_head_accountant: '인당회계사',
  external: '외부인',
};

/** 인당회계사가 접근 가능한 대분류(그룹) id. 조회 전용이다. */
export const PER_HEAD_ALLOWED_GROUPS = new Set<string>([
  'general', 'clients-hub', 'billing-req', 'billing', 'advisory',
]);
/**
 * 인당회계사에게 숨기는 세부 탭 id.
 * 대분류를 열어 주되 안에서 몇 개는 접는다 — 발송요청 처리(쓰기 업무),
 * ERP 발행내역 대사(원본 대사는 내부 업무), 통계(회계사·관리자용).
 * 나머지(설정·AI 사용량·사용자 관리)는 권한(cap)으로, 기초 미수금 입력은 onlyFor 로 이미 막힌다.
 */
export const PER_HEAD_HIDDEN_TABS = new Set<string>(['doc-process', 'erp-reconcile', 'stats']);
/** 인당회계사가 접근 가능한 우측 아이콘 메뉴 id — 업데이트요청만. */
export const PER_HEAD_ALLOWED_ICONS = new Set<string>(['requests']);

/** 외부인이 접근 가능한 메뉴 id (기능 시연용, 공개 참조데이터·AI만). 고객정보 화면(거래처관리·상담기록·청구)은
 *  제외하고, 쓰기는 readonly로, 고객정보 테이블 읽기는 RLS(is_external)로 별도 차단한다. */
export const EXTERNAL_ALLOWED_TABS = new Set<string>([
  'wizard', // 청구서 작성 (기능 시연 — 거래처명 등 식별정보는 서버 마스킹, 저장 불가)
  'std-kifrs', // 회계기준 검색 (공개 기준서)
  'std-tax', // 세법 검색 (공개 법령)
  'consult', // 상담진행 (AI 회신 시연 — 저장 불가)
]);

/** 알 수 없는/구버전 role 값은 최소 권한(기장팀원)으로 처리 */
export function normalizeRole(r: string | null | undefined): Role {
  return (ROLES as string[]).includes(r ?? '') ? (r as Role) : 'team_member';
}

/** 권한 항목 */
export type Capability =
  | 'saveInvoice' // 청구서 임시저장(작성중 draft) — 전 직원(팀원 포함). 확정(final)은 finalizeInvoice(팀장+)
  | 'finalizeInvoice' // 청구서 확정 — 팀장+
  | 'viewClients' // 거래처 관리 메뉴 접근 — 전 직원(팀원 포함). 팀원은 일부 필드만 수정(등록·삭제 불가)
  | 'manageClients' // 거래처 관리 전체(추가/수정/삭제·일괄·엑셀) — 팀장+
  | 'manageTargets' // 청구대상 확정
  | 'deleteBilling' // 청구기록 삭제
  | 'viewAllBilling' // 청구기록 전체 조회(아니면 본인것만) — 전 직원(팀원 포함)
  | 'viewAllStats' // 통계 전체 조회(아니면 본인것만)
  | 'changeSettings' // 수수료 설정 변경
  | 'manageUsers' // 사용자/계정 관리
  | 'viewAiUsage' // AI(상담) 사용량 집계 열람 — 최고관리자 전용
  | 'finalizeConsult' // 상담기록 확정(초안↔확정) — 작성자 외에도 확정권한자 허용
  | 'viewDispatch' // 문서발송 › 발송요청 처리 '조회' — 처리권한자 + 회계사(조회전용)
  | 'processDispatch'; // 문서발송 › 발송요청 처리(상태변경·발송일·등기번호) — 최고관리자·기장팀장·기장팀원

// 항목별 허용 역할 (매트릭스)
const MATRIX: Record<Capability, Role[]> = {
  // 임시저장(작성중 draft): 전 직원(팀원 포함, 본인 초안만 — RLS) / 확정(final): 팀장+
  saveInvoice: ['superuser', 'accountant', 'team_lead', 'team_member'],
  finalizeInvoice: ['superuser', 'accountant', 'team_lead'],
  // 거래처관리 메뉴 접근: 전 직원(팀원은 일부 필드 수정만) / 전체 CRUD: 팀장+
  // 인당회계사도 세무조정 대상선정을 본다(조회만) — 2026-09-03.
  viewClients: ['superuser', 'accountant', 'team_lead', 'team_member', 'per_head_accountant'],
  manageClients: ['superuser', 'accountant', 'team_lead'],
  manageTargets: ['superuser', 'accountant', 'team_lead'],
  deleteBilling: ['superuser', 'accountant', 'team_lead'],
  // 청구기록 전체 조회: 전 직원(기장팀원 포함). 통계 전체조회(viewAllStats)와는 분리.
  viewAllBilling: ['superuser', 'accountant', 'team_lead', 'team_member'],
  viewAllStats: ['superuser', 'accountant', 'team_lead'],
  changeSettings: ['superuser', 'accountant'],
  manageUsers: ['superuser'],
  viewAiUsage: ['superuser'],
  finalizeConsult: ['superuser', 'accountant', 'team_lead'],
  // 발송요청 처리 조회: 처리권한자 + 회계사(조회 전용). 인당회계사·외부인 제외.
  viewDispatch: ['superuser', 'team_lead', 'team_member', 'accountant'],
  // 발송요청 처리(쓰기): 최고관리자·기장팀장·기장팀원(회계사·인당회계사·외부인 제외)
  processDispatch: ['superuser', 'team_lead', 'team_member'],
};

export function can(role: Role, cap: Capability): boolean {
  return MATRIX[cap].includes(role);
}
