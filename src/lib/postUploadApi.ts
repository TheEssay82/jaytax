// 우편 업로드 양식 — 담당자 우편번호 읽기·저장(DB). 변환 규칙은 postUpload.ts.
import { supabase, assertWrote } from './supabase';

/** 발송요청의 담당자(doc_contacts → biz_contact) 우편번호. */
export async function contactZips(contactIds: string[]): Promise<Map<string, { bizContactId: string | null; zip: string | null }>> {
  const out = new Map<string, { bizContactId: string | null; zip: string | null }>();
  const ids = [...new Set(contactIds.filter(Boolean))];
  if (!ids.length) return out;
  const { data: dc, error } = await supabase.from('doc_contacts').select('id, biz_contact_id').in('id', ids);
  if (error) throw new Error(error.message);
  const bizIds = [...new Set((dc ?? []).map((x) => x.biz_contact_id as string | null).filter((x): x is string => !!x))];
  const zip = new Map<string, string | null>();
  if (bizIds.length) {
    const { data: bc, error: e2 } = await supabase.from('biz_contact').select('id, zip_code').in('id', bizIds);
    if (e2) throw new Error(e2.message);
    for (const b of bc ?? []) zip.set(b.id as string, (b.zip_code as string | null) ?? null);
  }
  for (const d of dc ?? []) {
    const b = (d.biz_contact_id as string | null) ?? null;
    out.set(d.id as string, { bizContactId: b, zip: b ? zip.get(b) ?? null : null });
  }
  return out;
}

/** 입력한 우편번호를 거래처담당자에 저장 — 다음부터 저절로 채운다. */
export async function saveContactZip(bizContactId: string, zip: string): Promise<void> {
  const { data, error } = await supabase.from('biz_contact').update({ zip_code: zip }).eq('id', bizContactId).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '저장');
}
