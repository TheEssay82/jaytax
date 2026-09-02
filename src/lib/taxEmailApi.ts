// 전자세금계산서 수신 이메일 — 어디로 보낼 것인가.
//
// 세금계산서는 **사업장 단위**로 나가고, 받는 곳은 대개 경리·회계팀이라
// 거래처담당자(업무 연락처)와 다르다. 그래서 정본은 `biz_place.tax_emails` 에 둔다.
//
// 다만 처음 쓰는 거래처는 그 자리가 비어 있다. 그때 기대는 것이 **과거에 실제로 보냈던 이력**이다
// (2018~2026 엑셀 `발행체크` 시트에서 긁어 모은 214개). 후보로 띄우고 고르게 한다.
import { supabase } from './supabase';

export interface EmailCandidate {
  email: string;
  /** 어디서 온 후보인가 — 화면이 출처를 밝혀야 고르는 사람이 판단할 수 있다. */
  source: '거래처정보' | '과거발행' | '거래처담당자';
  /** 과거발행이면 몇 번 썼는지·마지막이 언제인지. */
  count?: number;
  lastSeen?: string | null;
  note?: string;
}

/**
 * 이 사업장으로 보낼 이메일 후보를 모은다.
 * 순서가 곧 신뢰도다 — 거래처정보(정본) → 과거발행(많이 쓴 순) → 거래처담당자(참고).
 */
export async function listEmailCandidates(
  entityId: string | null, placeId: string | null, clientName: string,
): Promise<EmailCandidate[]> {
  const out: EmailCandidate[] = [];
  const seen = new Set<string>();
  const push = (c: EmailCandidate) => {
    const k = c.email.trim().toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k); out.push({ ...c, email: k });
  };

  // ① 사업장에 이미 적어 둔 것 — 정본.
  if (placeId) {
    const { data } = await supabase.from('biz_place').select('tax_emails').eq('id', placeId).maybeSingle();
    for (const e of ((data as { tax_emails?: string[] } | null)?.tax_emails ?? [])) {
      push({ email: e, source: '거래처정보' });
    }
  }

  // ② 과거에 실제로 보냈던 곳. 거래처로 붙은 것과 상호로 남은 것을 모두 본다.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let q = supabase.from('biz_tax_email_history')
    .select('email, seen_count, last_seen, client_name')
    .order('seen_count', { ascending: false });
  q = entityId
    ? q.or(`entity_id.eq.${entityId},client_name.eq.${clientName.replace(/,/g, ' ')}`)
    : q.eq('client_name', clientName);
  const { data: hist } = await q;
  for (const r of ((hist as any[]) ?? [])) {
    push({
      email: r.email, source: '과거발행',
      count: r.seen_count, lastSeen: r.last_seen,
      note: r.client_name && r.client_name !== clientName ? r.client_name : undefined,
    });
  }

  // ③ 거래처담당자 — 세금계산서 수신처가 아닐 수 있으니 맨 뒤에.
  if (entityId) {
    const { data: cs } = await supabase.from('biz_contact')
      .select('email, contact_name, position, place_id, active')
      .eq('entity_id', entityId);
    for (const c of ((cs as any[]) ?? [])) {
      if (!c.email || c.active === false) continue;
      if (placeId && c.place_id && c.place_id !== placeId) continue;
      push({
        email: c.email, source: '거래처담당자',
        note: `${c.contact_name ?? ''}${c.position ? ` ${c.position}` : ''}`.trim(),
      });
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return out;
}

/** 사업장에 지금 적혀 있는 세금계산서 이메일. */
export async function getPlaceTaxEmails(placeId: string): Promise<string[]> {
  const { data, error } = await supabase.from('biz_place').select('tax_emails').eq('id', placeId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { tax_emails?: string[] } | null)?.tax_emails ?? [];
}

/**
 * 사업장의 세금계산서 이메일을 갱신한다.
 *  · replace — 기존 것을 지우고 이번 것으로 바꾼다(담당이 바뀌었을 때).
 *  · append  — 기존 것에 더한다(받는 사람이 늘었을 때).
 * 어느 쪽인지는 **사람이 정해야 한다** — 함부로 지우면 지난 수신처를 잃는다.
 */
export async function savePlaceTaxEmails(
  placeId: string, emails: string[], mode: 'replace' | 'append',
): Promise<string[]> {
  const clean = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const cur = mode === 'append' ? await getPlaceTaxEmails(placeId) : [];
  const next = [...new Set([...cur.map((e) => e.toLowerCase()), ...clean])];
  const { error } = await supabase.from('biz_place').update({ tax_emails: next }).eq('id', placeId);
  if (error) throw new Error(error.message);
  return next;
}

/** 이번에 쓴 이메일을 이력에도 남긴다 — 다음에 후보로 뜨게. */
export async function recordEmailUse(
  clientName: string, emails: string[], entityId: string | null, placeId: string | null, on: string,
): Promise<void> {
  const rows = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
    .map((email) => ({
      client_name: clientName, email, seen_count: 1, last_seen: on,
      entity_id: entityId, place_id: placeId, source: 'jaytax 발행요청',
    }));
  if (!rows.length) return;
  // 이미 있으면 마지막 사용일만 밀어 준다(횟수는 크게 중요하지 않다).
  for (const r of rows) {
    const { data } = await supabase.from('biz_tax_email_history')
      .select('id, seen_count').eq('client_name', r.client_name).eq('email', r.email).maybeSingle();
    const hit = data as { id: string; seen_count: number } | null;
    if (hit) {
      await supabase.from('biz_tax_email_history')
        .update({ seen_count: (hit.seen_count ?? 0) + 1, last_seen: on, entity_id: r.entity_id, place_id: r.place_id })
        .eq('id', hit.id);
    } else {
      await supabase.from('biz_tax_email_history').insert(r);
    }
  }
}

/** 이메일 형식 확인 — 완벽할 필요는 없고, 오타를 잡을 정도면 된다. */
export const isEmail = (s: string) => /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(s.trim());

/** 여러 개를 한 칸에 담을 때의 표기 — 쉼표로 잇는다. */
export const joinEmails = (l: string[]) => [...new Set(l.map((e) => e.trim()).filter(Boolean))].join(', ');
export const splitEmails = (s: string) => s.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
