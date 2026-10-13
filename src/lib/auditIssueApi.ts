// 감사이슈 LOG — 감사 건(거래처×연도)마다 이슈 아이템과 경과 기록(마이그 0171, 사용자 2026-10-14).
//
// 옛 엑셀 ISSUELOG 의 열을 그대로 잇되 세 가지를 바꿨다:
//   결론+CLEAR? → 상태 하나 · 본문 뒤 「==> …」 덧붙임 → 경과 기록(쌓기만) · 긴급여부(반기/중간/기말) → 처리 시점.
// 우리 내부용이다. 회사에 가는 것은 강평자료뿐(강평 연결은 나중).
import { supabase } from './supabase';

export const ISSUE_CATEGORIES = ['공통', '별도', '연결', '관리'] as const;
export const ISSUE_IMPORTANCE = ['높음', '중간', '낮음'] as const;
export const ISSUE_STAGES = ['계획', '중간', '기말'] as const;
export const ISSUE_STATUSES = ['진행중', '완료', '이월'] as const;

export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];
export type IssueImportance = (typeof ISSUE_IMPORTANCE)[number];
export type IssueStage = (typeof ISSUE_STAGES)[number];
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export interface AuditIssue {
  id: string;
  engagementId: string;
  no: number;
  category: IssueCategory;
  importance: IssueImportance;
  title: string;
  body: string;
  account: string | null;
  ourStaff: string[];
  clientContact: string | null;
  dueStage: IssueStage;
  decisionNeeded: boolean;
  status: IssueStatus;
  conclusion: string | null;
  carriedFrom: string | null;
  closedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IssueLog {
  id: string;
  issueId: string;
  body: string;
  statusTo: IssueStatus | null;
  createdName: string | null;
  createdAt: string;
}

/** 입력 칸 — 새로 만들 때와 고칠 때 같은 모양. */
export interface IssueInput {
  category: IssueCategory;
  importance: IssueImportance;
  title: string;
  body: string;
  account: string;
  ourStaff: string[];
  clientContact: string;
  dueStage: IssueStage;
  decisionNeeded: boolean;
  status: IssueStatus;
  conclusion: string;
}

type Row = {
  id: string; engagement_id: string; no: number; category: IssueCategory; importance: IssueImportance;
  title: string; body: string; account: string | null; our_staff: string[] | null; client_contact: string | null;
  due_stage: IssueStage; decision_needed: boolean; status: IssueStatus; conclusion: string | null;
  carried_from: string | null; closed_at: string | null; created_by: string | null; created_at: string; updated_at: string;
};

const SEL = 'id, engagement_id, no, category, importance, title, body, account, our_staff, client_contact, due_stage,'
  + ' decision_needed, status, conclusion, carried_from, closed_at, created_by, created_at, updated_at';

function toIssue(r: Row): AuditIssue {
  return {
    id: r.id, engagementId: r.engagement_id, no: r.no, category: r.category, importance: r.importance,
    title: r.title, body: r.body ?? '', account: r.account, ourStaff: r.our_staff ?? [], clientContact: r.client_contact,
    dueStage: r.due_stage, decisionNeeded: r.decision_needed, status: r.status, conclusion: r.conclusion,
    carriedFrom: r.carried_from, closedAt: r.closed_at, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

const blank = (s: string) => (s.trim() ? s.trim() : null);
function toRow(x: IssueInput) {
  return {
    category: x.category, importance: x.importance, title: x.title.trim(), body: x.body.trim(),
    account: blank(x.account), our_staff: x.ourStaff.map((s) => s.trim()).filter(Boolean),
    client_contact: blank(x.clientContact), due_stage: x.dueStage, decision_needed: x.decisionNeeded,
    status: x.status, conclusion: blank(x.conclusion),
  };
}

export function emptyIssueInput(prev?: Partial<IssueInput>): IssueInput {
  return {
    category: '별도', importance: '중간', title: '', body: '', account: '', ourStaff: [], clientContact: '',
    dueStage: '기말', decisionNeeded: false, status: '진행중', conclusion: '', ...prev,
  };
}

export function issueToInput(i: AuditIssue): IssueInput {
  return {
    category: i.category, importance: i.importance, title: i.title, body: i.body, account: i.account ?? '',
    ourStaff: i.ourStaff, clientContact: i.clientContact ?? '', dueStage: i.dueStage, decisionNeeded: i.decisionNeeded,
    status: i.status, conclusion: i.conclusion ?? '',
  };
}

/** 한 건의 이슈 전부(번호순). */
export async function listIssues(engagementId: string): Promise<AuditIssue[]> {
  const { data, error } = await supabase.from('audit_issue').select(SEL).eq('engagement_id', engagementId).order('no');
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map(toIssue);
}

/** 건마다 이슈 수(전체·진행중) — 회사 목록의 숫자. */
export async function issueCounts(): Promise<Map<string, { all: number; open: number; decision: number }>> {
  const { data, error } = await supabase.from('audit_issue').select('engagement_id, status, decision_needed');
  if (error) throw error;
  const m = new Map<string, { all: number; open: number; decision: number }>();
  for (const r of (data ?? []) as { engagement_id: string; status: IssueStatus; decision_needed: boolean }[]) {
    const c = m.get(r.engagement_id) ?? { all: 0, open: 0, decision: 0 };
    c.all++;
    if (r.status === '진행중') { c.open++; if (r.decision_needed) c.decision++; }
    m.set(r.engagement_id, c);
  }
  return m;
}

/** 모든 회사의 진행중 이슈 — 「전체 진행중」 보기. */
export async function listOpenIssues(): Promise<AuditIssue[]> {
  const { data, error } = await supabase.from('audit_issue').select(SEL).eq('status', '진행중').order('created_at');
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map(toIssue);
}

export async function listIssueLogs(issueIds: string[]): Promise<Map<string, IssueLog[]>> {
  const m = new Map<string, IssueLog[]>();
  if (!issueIds.length) return m;
  const { data, error } = await supabase.from('audit_issue_log')
    .select('id, issue_id, body, status_to, created_name, created_at').in('issue_id', issueIds).order('created_at');
  if (error) throw error;
  for (const r of (data ?? []) as { id: string; issue_id: string; body: string; status_to: IssueStatus | null; created_name: string | null; created_at: string }[]) {
    const a = m.get(r.issue_id) ?? [];
    a.push({ id: r.id, issueId: r.issue_id, body: r.body, statusTo: r.status_to, createdName: r.created_name, createdAt: r.created_at });
    m.set(r.issue_id, a);
  }
  return m;
}

export async function createIssue(engagementId: string, x: IssueInput): Promise<AuditIssue> {
  const { data, error } = await supabase.from('audit_issue')
    .insert({ engagement_id: engagementId, no: 0, ...toRow(x) }).select(SEL).single();
  if (error) throw error;
  return toIssue(data as unknown as Row);
}

/** 고치기. 상태가 바뀌면 경과에 한 줄 남긴다(엑셀에서 「==> 완료」를 덧붙이던 일). */
export async function updateIssue(prev: AuditIssue, x: IssueInput, byName: string): Promise<AuditIssue> {
  const { data, error } = await supabase.from('audit_issue').update(toRow(x)).eq('id', prev.id).select(SEL).single();
  if (error) throw error;
  if (prev.status !== x.status) {
    await addIssueLog(prev.id, `상태 ${prev.status} → ${x.status}${x.conclusion.trim() && x.status === '완료' ? ` · 결론: ${x.conclusion.trim()}` : ''}`, byName, x.status);
  }
  return toIssue(data as unknown as Row);
}

export async function addIssueLog(issueId: string, body: string, byName: string, statusTo: IssueStatus | null = null): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from('audit_issue_log')
    .insert({ issue_id: issueId, body: body.trim(), created_name: byName || null, status_to: statusTo, created_by: u.user?.id });
  if (error) throw error;
}

/** 잘못 만든 이슈 지우기 — 만든 사람 본인 것만(서버도 같은 선). */
export async function deleteIssue(id: string): Promise<void> {
  const { error, count } = await supabase.from('audit_issue').delete({ count: 'exact' }).eq('id', id);
  if (error) throw error;
  if (!count) throw new Error('지우지 못했습니다 — 만든 사람만 지울 수 있습니다.');
}

/**
 * 진행중 이슈를 다음 해 건으로 넘긴다. 다음 해 건(같은 회사·같은 별도/연결)이 있어야 한다.
 * 원래 이슈는 「이월」로 닫고, 새 이슈는 carried_from 으로 잇는다. 작년 경과는 원래 이슈에 남아 화면에서 함께 보인다.
 */
export async function carryOver(issues: AuditIssue[], toEngagementId: string, byName: string, toFy: number): Promise<number> {
  let n = 0;
  for (const i of issues) {
    if (i.status !== '진행중') continue;
    const { data, error } = await supabase.from('audit_issue').insert({
      engagement_id: toEngagementId, no: 0, carried_from: i.id,
      ...toRow({ ...issueToInput(i), status: '진행중', conclusion: '' }),
    }).select('id').single();
    if (error) throw error;
    await addIssueLog((data as { id: string }).id, `FY${toFy - 1} #${i.no} 에서 이월`, byName);
    await updateIssue(i, { ...issueToInput(i), status: '이월' }, byName);
    n++;
  }
  return n;
}

/** carried_from 을 거슬러 올라가 작년 이슈들(경과를 함께 보이려고). */
export async function listIssuesByIds(ids: string[]): Promise<AuditIssue[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('audit_issue').select(SEL).in('id', ids);
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map(toIssue);
}
