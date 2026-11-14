// 기말감사일정 — 읽고 쓰기(마이그 0194, 사용자 2026-11-15). 계산은 auditSchedule.ts.
import { supabase } from './supabase';
import type { ScheduleItem, ScheduleKind, ScheduleSetting } from './auditSchedule';

interface ItemRow {
  id: string; entity_id: string | null; company: string; kind: ScheduleKind; task: string;
  days_needed: number | string; days_uncertain: boolean; confirmed: boolean; sort: number; note: string | null; staff: string[] | null;
}

export async function listSchedule(fy: number): Promise<ScheduleItem[]> {
  const { data, error } = await supabase.from('audit_schedule_item')
    .select('id, entity_id, company, kind, task, days_needed, days_uncertain, confirmed, sort, note, staff')
    .eq('fiscal_year', fy).order('sort').order('created_at');
  if (error) throw error;
  const rows = (data ?? []) as ItemRow[];
  const days = new Map<string, Map<string, string>>();
  if (rows.length) {
    const { data: d, error: e2 } = await supabase.from('audit_schedule_day').select('item_id, day, mark').in('item_id', rows.map((r) => r.id));
    if (e2) throw e2;
    for (const x of (d ?? []) as { item_id: string; day: string; mark: string }[]) {
      const m = days.get(x.item_id) ?? new Map<string, string>();
      m.set(x.day, x.mark ?? '');
      days.set(x.item_id, m);
    }
  }
  return rows.map((r) => ({
    id: r.id, entityId: r.entity_id, company: r.company, kind: r.kind, task: r.task,
    daysNeeded: Number(r.days_needed), daysUncertain: r.days_uncertain, confirmed: r.confirmed, sort: r.sort, note: r.note, staff: r.staff ?? [],
    days: days.get(r.id) ?? new Map(),
  }));
}

export async function getSetting(fy: number): Promise<ScheduleSetting> {
  const { data, error } = await supabase.from('audit_schedule_setting').select('teams, start_day, deadline, deadline_other, closed').eq('fiscal_year', fy).maybeSingle();
  if (error) throw error;
  if (!data) return { teams: 1, startDay: `${fy + 1}-01-25`, deadline: `${fy + 1}-03-22`, deadlineOther: `${fy + 1}-03-31`, closed: false };
  return { teams: data.teams, startDay: data.start_day, deadline: data.deadline, deadlineOther: data.deadline_other, closed: data.closed };
}

export async function saveSetting(fy: number, s: ScheduleSetting): Promise<void> {
  const { error } = await supabase.from('audit_schedule_setting')
    .upsert({ fiscal_year: fy, teams: s.teams, start_day: s.startDay, deadline: s.deadline, deadline_other: s.deadlineOther, closed: s.closed });
  if (error) throw error;
}

export interface ItemInput { entityId: string | null; company: string; kind: ScheduleKind; task: string; daysNeeded: number; daysUncertain: boolean; sort: number; staff: string[] }

export async function addItem(fy: number, x: ItemInput): Promise<void> {
  const { error } = await supabase.from('audit_schedule_item').insert({
    fiscal_year: fy, entity_id: x.entityId, company: x.company.trim(), kind: x.kind, task: x.task.trim(),
    days_needed: x.daysNeeded, days_uncertain: x.daysUncertain, sort: x.sort, staff: x.staff,
  });
  if (error) throw error;
}

export async function updateItem(id: string, patch: Partial<{ kind: ScheduleKind; task: string; daysNeeded: number; daysUncertain: boolean; confirmed: boolean; note: string | null; sort: number; staff: string[] }>): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.kind !== undefined) row.kind = patch.kind;
  if (patch.task !== undefined) row.task = patch.task;
  if (patch.daysNeeded !== undefined) row.days_needed = patch.daysNeeded;
  if (patch.daysUncertain !== undefined) row.days_uncertain = patch.daysUncertain;
  if (patch.confirmed !== undefined) row.confirmed = patch.confirmed;
  if (patch.note !== undefined) row.note = patch.note;
  if (patch.sort !== undefined) row.sort = patch.sort;
  if (patch.staff !== undefined) row.staff = patch.staff;
  const { error } = await supabase.from('audit_schedule_item').update(row).eq('id', id);
  if (error) throw error;
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase.from('audit_schedule_item').delete().eq('id', id);
  if (error) throw error;
}

/** 칸 하나 — 넣거나(글 포함) 빼기. */
export async function setDay(itemId: string, day: string, on: boolean, mark = ''): Promise<void> {
  if (on) {
    const { error } = await supabase.from('audit_schedule_day').upsert({ item_id: itemId, day, mark });
    if (error) throw error;
  } else {
    const { error } = await supabase.from('audit_schedule_day').delete().eq('item_id', itemId).eq('day', day);
    if (error) throw error;
  }
}

/** 이 연도 감사 계약(AUD.AUDIT) 거래처 — 「계약에서 불러오기」. */
export async function auditContractsFor(fy: number): Promise<{ entityId: string; name: string; code: string; cpa: string | null; contractCode: string }[]> {
  const { data, error } = await supabase.from('biz_sales_contract')
    .select('entity_id, cpa, contract_code, biz_entity:entity_id(name, code)')
    .eq('team', '감사team').eq('fiscal_year', fy).eq('category_code', 'AUD.AUDIT');
  if (error) throw error;
  return ((data ?? []) as unknown as { entity_id: string; cpa: string | null; contract_code: string | null; biz_entity: { name: string; code: string } | null }[])
    .map((r) => ({ entityId: r.entity_id, name: r.biz_entity?.name ?? '', code: r.biz_entity?.code ?? '', cpa: r.cpa, contractCode: r.contract_code ?? '' }));
}

/** 계약 → 구분 짐작(새로 불러올 때 처음 값 — 화면에서 고친다): 지정감사(법인(지정))=상장, 사모투자·오큘러스·블라인드=PEF, 투자목적회사·이니어스인…=SPC, 나머지 외감. */
export function guessKind(name: string, cpa: string | null): ScheduleKind {
  if (cpa === '법인(지정)') return '상장';
  if (/사모투자|오큘러스|블라인드/.test(name)) return 'PEF';
  if (/투자목적회사|이니어스인/.test(name)) return 'SPC';
  return '외감';
}

/** 상장사 주총일 — 회사 이름 → 날짜. */
export async function listAgm(fy: number): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('audit_schedule_company').select('company, agm_date').eq('fiscal_year', fy);
  if (error) throw error;
  return new Map(((data ?? []) as { company: string; agm_date: string | null }[]).filter((r) => r.agm_date).map((r) => [r.company, r.agm_date!]));
}
export async function saveAgm(fy: number, company: string, agm: string | null): Promise<void> {
  const { error } = await supabase.from('audit_schedule_company').upsert({ fiscal_year: fy, company, agm_date: agm || null });
  if (error) throw error;
}
