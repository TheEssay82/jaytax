// 사용자 역할(등급) 및 권한 정의 — 권한 매트릭스(2026-06-27 확정)
// per_head_accountant(인당회계사): 외부 위촉 성격의 제한 등급. '일반업무관리'와 '업데이트요청'만 노출하고
//   문서발송관리의 '발송요청 처리'는 숨긴다. 고객 민감 데이터(거래처·청구·상담·자료실)는 외부인과 동일하게
//   RLS에서 읽기 차단(is_perhead) — 메뉴 숨김 + API 차단 이중.
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

/** 인당회계사가 접근 가능한 대분류(그룹) id — 일반업무관리만. */
export const PER_HEAD_ALLOWED_GROUPS = new Set<string>(['general']);
/** 인당회계사에게 숨기는 세부 탭 id — 문서발송관리 › 발송요청 처리. */
export const PER_HEAD_HIDDEN_TABS = new Set<string>(['doc-process']);
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
  | 'processDispatch'; // 문서발송 › 발송요청 처리(상태변경·발송일·등기번호) — 최고관리자·기장팀장·기장팀원

// 항목별 허용 역할 (매트릭스)
const MATRIX: Record<Capability, Role[]> = {
  // 임시저장(작성중 draft): 전 직원(팀원 포함, 본인 초안만 — RLS) / 확정(final): 팀장+
  saveInvoice: ['superuser', 'accountant', 'team_lead', 'team_member'],
  finalizeInvoice: ['superuser', 'accountant', 'team_lead'],
  // 거래처관리 메뉴 접근: 전 직원(팀원은 일부 필드 수정만) / 전체 CRUD: 팀장+
  viewClients: ['superuser', 'accountant', 'team_lead', 'team_member'],
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
  // 발송요청 처리: 최고관리자·기장팀장·기장팀원(회계사·인당회계사·외부인 제외)
  processDispatch: ['superuser', 'team_lead', 'team_member'],
};

export function can(role: Role, cap: Capability): boolean {
  return MATRIX[cap].includes(role);
}
