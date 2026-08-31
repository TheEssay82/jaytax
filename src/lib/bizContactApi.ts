// 거래처담당자(외부 연락처) biz_contact 데이터 접근 + 기존 doc_contacts 1회성 이관. 거래처관리 2.0.0 step3.
import { supabase, assertWrote } from './supabase';

export interface BizContact {
  id: string;
  entityId: string;
  placeId: string | null;
  contactName: string;
  honorific: string;
  position: string;
  phone: string;
  fax: string;
  email: string;
  address: string;
  isPrimary: boolean;
  note: string;
  createdAt?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const toContact = (r: any): BizContact => ({
  id: r.id, entityId: r.entity_id, placeId: r.place_id, contactName: r.contact_name || '',
  honorific: r.honorific || '님', position: r.position || '', phone: r.phone || '', fax: r.fax || '', email: r.email || '',
  address: r.address || '', isPrimary: !!r.is_primary, note: r.note || '', createdAt: r.created_at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listBizContacts(): Promise<BizContact[]> {
  const { data, error } = await supabase.from('biz_contact').select('*').order('contact_name');
  if (error) throw new Error(error.message);
  return (data as unknown[]).map(toContact);
}

export interface ContactInput {
  entityId: string; placeId?: string | null; contactName: string; honorific?: string; position?: string;
  phone?: string; fax?: string; email?: string; address?: string; isPrimary?: boolean; note?: string;
}
function toRow(c: Partial<ContactInput>): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  const s = (k: string, v: unknown) => { if (v !== undefined) r[k] = v; };
  s('entity_id', c.entityId); s('place_id', c.placeId ?? undefined); s('contact_name', c.contactName);
  s('honorific', c.honorific); s('position', c.position); s('phone', c.phone); s('fax', c.fax); s('email', c.email);
  s('address', c.address); s('is_primary', c.isPrimary); s('note', c.note);
  return r;
}
export async function createBizContact(input: ContactInput): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('biz_contact').insert({ ...toRow(input), created_by: u.user?.id ?? null }).select('id').single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}
export async function updateBizContact(id: string, patch: Partial<ContactInput>): Promise<void> {
  const { data, error } = await supabase.from('biz_contact').update(toRow(patch)).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '저장');
}
export async function deleteBizContact(id: string): Promise<void> {
  const { data, error } = await supabase.from('biz_contact').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '삭제');
}
