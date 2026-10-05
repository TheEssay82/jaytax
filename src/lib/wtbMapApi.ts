// 정산표 이월 — 회사별로 고른 계정 짝(마이그 0164 wtb_account_map).
//
// 사용자 2026-10-05 「회사별로 고른 짝을 저장해주세요」: 받을 줄 없는 계정에 고른 「이 줄에 더하기」·「넣지 않기」를
// 이월 정산표를 만들 때 저장하고, 다음 이월(기말 갱신·내년 중간)에서 같은 계정이면 그대로 쓴다.
// 「새 줄로 넣기」는 저장하지 않는다 — 다음 해 정산표에 그 이름의 줄이 생겨 저절로 맞는다.
import { supabase } from './supabase';
import { pairKey, type WtbPlace } from './wtbRoll';

export interface WtbMap {
  id: string; sheet: string; sourceKey: string; sourceName: string; sourceGroup: string | null;
  action: 'row' | 'skip'; targetLabel: string | null; targetFsli: string | null; targetRow: number | null;
  updatedEmail: string | null; updatedAt: string;
}
type Row = {
  id: string; sheet: string; source_key: string; source_name: string; source_group: string | null;
  action: 'row' | 'skip'; target_label: string | null; target_fsli: string | null; target_row: number | null;
  updated_email: string | null; updated_at: string;
};
const SEL = 'id, sheet, source_key, source_name, source_group, action, target_label, target_fsli, target_row, updated_email, updated_at';
const to = (r: Row): WtbMap => ({
  id: r.id, sheet: r.sheet, sourceKey: r.source_key, sourceName: r.source_name, sourceGroup: r.source_group,
  action: r.action, targetLabel: r.target_label, targetFsli: r.target_fsli, targetRow: r.target_row,
  updatedEmail: r.updated_email, updatedAt: r.updated_at,
});

export async function listWtbMaps(entityId: string): Promise<WtbMap[]> {
  const { data, error } = await supabase.from('wtb_account_map').select(SEL).eq('entity_id', entityId).order('sheet').order('source_name');
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Row[]).map(to);
}

export interface WtbMapInput {
  sheet: string; name: string; group?: string;
  action: 'row' | 'skip'; label?: string; fsli?: string; row?: number;
}
/** 고른 짝을 저장(같은 회사·표·계정이면 덮어쓴다). */
export async function saveWtbMaps(entityId: string, items: WtbMapInput[]): Promise<void> {
  if (!items.length) return;
  const { data: u } = await supabase.auth.getUser();
  const rows = items.map((x) => ({
    entity_id: entityId, sheet: x.sheet, source_key: pairKey(x.name, x.group), source_name: x.name, source_group: x.group ?? null,
    action: x.action, target_label: x.label ?? null, target_fsli: x.fsli ?? null, target_row: x.row ?? null,
    updated_by: u.user?.id ?? null, updated_email: u.user?.email ?? null, updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from('wtb_account_map').upsert(rows, { onConflict: 'entity_id,sheet,source_key' });
  if (error) throw new Error(error.message);
}

export async function deleteWtbMap(id: string): Promise<void> {
  const { error } = await supabase.from('wtb_account_map').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** 저장된 짝 → 이월에 넘길 「이 줄에 더하기」(넣지 않기는 화면의 고른 값으로만). */
export function mapsToPlaces(maps: WtbMap[]): WtbPlace[] {
  return maps.filter((m) => m.action === 'row' && m.targetLabel).map((m) => ({
    name: m.sourceName, sheet: m.sheet, to: 'row' as const, label: m.targetLabel!, row: m.targetRow ?? undefined, group: m.sourceGroup ?? undefined,
  }));
}
