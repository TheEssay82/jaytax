// 주석·DSD 작업 단위를 읽고 쓰는 일. 규칙과 표준 틀은 dsdNotes.ts 에 있다.
//
// ⚠️ **재무제표 파일은 여기로 오지 않는다.** 엑셀도 DSD 도 브라우저 안에서 열고 끝낸다.
//    이 표에 남는 것은 「어느 회사의 어느 해를 다루는가」와 주석 목록뿐이다.
import { supabase } from './supabase';
import { template, renumber, cloneForNextYear, type Basis, type NoteRow } from './dsdNotes';

export type { Basis, NoteRow, NoteSource, NoteStatus } from './dsdNotes';

export interface Engagement {
  id: string;
  entityId: string;
  entityName: string;
  entityCode: string | null;
  fy: number;
  scope: '별도' | '연결';
  termNo: number | null;
  periodFrom: string | null;
  periodTo: string | null;
  basis: Basis;
  moneyUnit: '천원' | '원';
  status: '준비' | '진행' | '완료';
  note: string | null;
  noteCount: number;
}

type EngRow = {
  id: string; entity_id: string; fy: number; scope: '별도' | '연결';
  term_no: number | null; period_from: string | null; period_to: string | null;
  basis: Basis; money_unit: '천원' | '원'; status: '준비' | '진행' | '완료'; note: string | null;
  biz_entity: { name: string; code: string | null } | null;
  dsd_note: { count: number }[] | null;
};

function toEng(r: EngRow): Engagement {
  return {
    id: r.id,
    entityId: r.entity_id,
    entityName: r.biz_entity?.name ?? '(이름 없음)',
    entityCode: r.biz_entity?.code ?? null,
    fy: r.fy,
    scope: r.scope,
    termNo: r.term_no,
    periodFrom: r.period_from,
    periodTo: r.period_to,
    basis: r.basis,
    moneyUnit: r.money_unit,
    status: r.status,
    note: r.note,
    noteCount: r.dsd_note?.[0]?.count ?? 0,
  };
}

const SEL = 'id, entity_id, fy, scope, term_no, period_from, period_to, basis, money_unit, status, note,'
  + ' biz_entity(name, code), dsd_note(count)';

export async function listEngagements(): Promise<Engagement[]> {
  const { data, error } = await supabase
    .from('dsd_engagement')
    .select(SEL)
    .order('fy', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as EngRow[]).map(toEng);
}

export interface NewEngagement {
  entityId: string; fy: number; scope: '별도' | '연결';
  termNo: number | null; periodFrom: string; periodTo: string;
  basis: Basis; moneyUnit: '천원' | '원'; note?: string;
  /** 무엇으로 주석 목록을 채울까 — 표준 틀 / 앞 해 복제 / 비워 두기. */
  seed: 'template' | 'previous' | 'empty';
}

/**
 * 작업 단위를 만들고 **주석 목록까지 채운다.**
 *
 * 빈 목록으로 만들어 두면 결국 손으로 40줄을 넣게 된다. 그래서 만들 때 씨앗을 고르게 했다 —
 * 표준 틀(명진·넵튠 실물에서 뽑은 것)이나 **앞 해 것 복제**다. 복제가 이 시스템의 값어치가
 * 쌓이는 자리다: 코드·시트·작성주체·담당이 그대로 따라오고 진행상태만 비워진다.
 */
export async function createEngagement(v: NewEngagement): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('dsd_engagement')
    .insert({
      entity_id: v.entityId, fy: v.fy, scope: v.scope, term_no: v.termNo,
      period_from: v.periodFrom, period_to: v.periodTo,
      basis: v.basis, money_unit: v.moneyUnit, note: v.note ?? null,
      created_by: user?.id ?? null, updated_by: user?.id ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;
  const id = (data as { id: string }).id;

  let seeded: NoteRow[] = [];
  if (v.seed === 'template') {
    seeded = template(v.basis);
  } else if (v.seed === 'previous') {
    const prev = await findEngagement(v.entityId, v.fy - 1, v.scope);
    seeded = prev ? cloneForNextYear(await listNotes(prev.id)) : template(v.basis);
  }
  if (seeded.length) await replaceNotes(id, seeded);
  return id;
}

export async function findEngagement(entityId: string, fy: number, scope: string): Promise<Engagement | null> {
  const { data, error } = await supabase
    .from('dsd_engagement').select(SEL)
    .eq('entity_id', entityId).eq('fy', fy).eq('scope', scope)
    .maybeSingle();
  if (error) throw error;
  return data ? toEng(data as unknown as EngRow) : null;
}

export async function updateEngagement(id: string, patch: Partial<{
  termNo: number | null; periodFrom: string; periodTo: string;
  basis: Basis; moneyUnit: '천원' | '원'; status: '준비' | '진행' | '완료'; note: string | null;
}>): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const row: Record<string, unknown> = { updated_by: user?.id ?? null };
  if (patch.termNo !== undefined) row.term_no = patch.termNo;
  if (patch.periodFrom !== undefined) row.period_from = patch.periodFrom;
  if (patch.periodTo !== undefined) row.period_to = patch.periodTo;
  if (patch.basis !== undefined) row.basis = patch.basis;
  if (patch.moneyUnit !== undefined) row.money_unit = patch.moneyUnit;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.note !== undefined) row.note = patch.note;
  const { error } = await supabase.from('dsd_engagement').update(row).eq('id', id);
  if (error) throw error;
}

/** 되돌릴 수 없다 — 화면에서 확인창을 거친 뒤에만 부른다. */
export async function deleteEngagement(id: string): Promise<void> {
  const { error } = await supabase.from('dsd_engagement').delete().eq('id', id);
  if (error) throw error;
}

type NoteDbRow = {
  code: string; no: number | null; title: string; sheet: string | null;
  enabled: boolean; source: '감사인' | '회사'; assignee: string | null;
  status: NoteRow['status']; memo: string | null; sort_order: number;
};

export async function listNotes(engagementId: string): Promise<NoteRow[]> {
  const { data, error } = await supabase
    .from('dsd_note')
    .select('code, no, title, sheet, enabled, source, assignee, status, memo, sort_order')
    .eq('engagement_id', engagementId)
    .order('sort_order');
  if (error) throw error;
  return ((data ?? []) as NoteDbRow[]).map((r) => ({
    code: r.code, no: r.no, title: r.title, sheet: r.sheet,
    enabled: r.enabled, source: r.source, assignee: r.assignee,
    status: r.status, memo: r.memo, sortOrder: r.sort_order,
  }));
}

/**
 * 주석 목록을 통째로 갈아끼운다.
 *
 * 한 줄씩 고치지 않는 이유: 주석을 켜고 끄면 **번호가 통째로 다시 매겨진다**(renumber).
 * 부분 갱신으로는 그 재배열을 맞추기 어렵고, 40줄짜리라 한 번에 쓰는 편이 단순하다.
 */
export async function replaceNotes(engagementId: string, rows: NoteRow[]): Promise<void> {
  const fixed = renumber(rows);
  const { error: delErr } = await supabase.from('dsd_note').delete().eq('engagement_id', engagementId);
  if (delErr) throw delErr;
  if (!fixed.length) return;
  const { error } = await supabase.from('dsd_note').insert(fixed.map((r) => ({
    engagement_id: engagementId,
    code: r.code, no: r.no, title: r.title, sheet: r.sheet ?? null,
    enabled: r.enabled, source: r.source, assignee: r.assignee ?? null,
    status: r.status, memo: r.memo ?? null, sort_order: r.sortOrder,
  })));
  if (error) throw error;
}
