// 거래처담당자(외부 연락처) biz_contact 데이터 접근 + 기존 doc_contacts 1회성 이관. 거래처관리 2.0.0 step3.
import { supabase, assertWrote } from './supabase';
import { parseCorpForm } from './bizRegistryApi';

export interface BizContact {
  id: string;
  entityId: string;
  placeId: string | null;
  contactName: string;
  honorific: string;
  position: string;
  phone: string;
  email: string;
  address: string;
  isPrimary: boolean;
  note: string;
  createdAt?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const toContact = (r: any): BizContact => ({
  id: r.id, entityId: r.entity_id, placeId: r.place_id, contactName: r.contact_name || '',
  honorific: r.honorific || '님', position: r.position || '', phone: r.phone || '', email: r.email || '',
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
  phone?: string; email?: string; address?: string; isPrimary?: boolean; note?: string;
}
function toRow(c: Partial<ContactInput>): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  const s = (k: string, v: unknown) => { if (v !== undefined) r[k] = v; };
  s('entity_id', c.entityId); s('place_id', c.placeId ?? undefined); s('contact_name', c.contactName);
  s('honorific', c.honorific); s('position', c.position); s('phone', c.phone); s('email', c.email);
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

// ── 기존 doc_contacts 1회성 이관 ───────────────────────────
function norm(s: string): string {
  return (s || '').replace(/\s+/g, '').replace(/㈜|㈲|\(주\)|주식회사|\(유\)|유한회사|\(합자\)|합자회사|사모투자합자회사/gi, '').toLowerCase();
}
export interface ContactImportRow {
  key: string; contactName: string; company: string; entityId: string | null; entityLabel: string;
  honorific: string; phone: string; email: string; address: string; note: string; exists: boolean;
}
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function previewContactImport(): Promise<ContactImportRow[]> {
  const [ct, dc, ent, existing] = await Promise.all([
    supabase.from('doc_contacts').select('id, client_id, contact_name, honorific, phone, email, address, note'),
    supabase.from('doc_clients').select('id, company_name'),
    supabase.from('biz_entity').select('id, code, name'),
    supabase.from('biz_contact').select('entity_id, contact_name, phone'),
  ]);
  for (const r of [ct, dc, ent, existing]) if (r.error) throw new Error(r.error.message);
  const clientName = new Map((dc.data as any[]).map((d) => [d.id, d.company_name as string]));
  const entByNorm = new Map<string, { id: string; label: string }>();
  for (const e of ent.data as any[]) entByNorm.set(norm(parseCorpForm(e.name).name), { id: e.id, label: `${e.code} ${e.name}` });
  const existKeys = new Set((existing.data as any[]).map((r) => `${r.entity_id}|${(r.contact_name || '').trim()}|${(r.phone || '').trim()}`));
  return (ct.data as any[]).map((c) => {
    const company = clientName.get(c.client_id) || '';
    const match = entByNorm.get(norm(parseCorpForm(company).name)) ?? null;
    const exists = !!match && existKeys.has(`${match.id}|${(c.contact_name || '').trim()}|${(c.phone || '').trim()}`);
    return {
      key: c.id, contactName: c.contact_name || '', company, entityId: match?.id ?? null, entityLabel: match?.label ?? '(미매칭)',
      honorific: c.honorific || '님', phone: c.phone || '', email: c.email || '', address: c.address || '', note: c.note || '', exists,
    };
  }).sort((a, b) => a.company.localeCompare(b.company, 'ko'));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface ContactImportResult { created: number; skipped: number; unmatched: number }
export async function runContactImport(rows: ContactImportRow[]): Promise<ContactImportResult> {
  const res: ContactImportResult = { created: 0, skipped: 0, unmatched: 0 };
  for (const r of rows) {
    if (!r.entityId) { res.unmatched++; continue; }
    if (r.exists) { res.skipped++; continue; }
    await createBizContact({
      entityId: r.entityId, contactName: r.contactName.trim(), honorific: r.honorific || '님',
      phone: r.phone, email: r.email, address: r.address, note: r.note,
    });
    res.created++;
  }
  return res;
}
