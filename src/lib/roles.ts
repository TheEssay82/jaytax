// 사용자 역할(등급) 및 권한 정의 — 권한 매트릭스(2026-06-27 확정)
export type Role = 'superuser' | 'accountant' | 'team_lead' | 'team_member';

export const ROLES: Role[] = ['superuser', 'accountant', 'team_lead', 'team_member'];

export const ROLE_LABELS: Record<Role, string> = {
  superuser: '최고관리자',
  accountant: '회계사',
  team_lead: '기장팀장',
  team_member: '기장팀원',
};

/** 알 수 없는/구버전 role 값은 최소 권한(기장팀원)으로 처리 */
export function normalizeRole(r: string | null | undefined): Role {
  return (ROLES as string[]).includes(r ?? '') ? (r as Role) : 'team_member';
}

/** 권한 항목 */
export type Capability =
  | 'finalizeInvoice' // 청구서 최종 저장(확정)
  | 'manageClients' // 거래처 관리(추가/수정/삭제·일괄·엑셀)
  | 'manageTargets' // 청구대상 확정
  | 'deleteBilling' // 청구기록 삭제
  | 'viewAllStats' // 통계 전체 조회(아니면 본인것만)
  | 'changeSettings' // 수수료 설정 변경
  | 'manageUsers'; // 사용자/계정 관리

// 항목별 허용 역할 (매트릭스)
const MATRIX: Record<Capability, Role[]> = {
  // 청구서 저장: 전 직원 가능(기장팀원 포함) — 작성분 유실 방지
  finalizeInvoice: ['superuser', 'accountant', 'team_lead', 'team_member'],
  manageClients: ['superuser', 'accountant', 'team_lead'],
  manageTargets: ['superuser', 'accountant', 'team_lead'],
  deleteBilling: ['superuser', 'accountant', 'team_lead'],
  viewAllStats: ['superuser', 'accountant', 'team_lead'],
  changeSettings: ['superuser', 'accountant'],
  manageUsers: ['superuser'],
};

export function can(role: Role, cap: Capability): boolean {
  return MATRIX[cap].includes(role);
}
