// JAYTAX DB 의 쏭비서 함수(ssong_*)만 부른다 — 표를 직접 읽거나 쓰지 않는다.
// anon 키 + x-ssong-key 헤더. 열쇠 확인·마스킹·접속기록은 DB 함수 안에서 한다(0200).

export class JaytaxError extends Error {}

function env(name: string): string {
  const v = (process.env[name] ?? '').trim();
  if (!v) throw new JaytaxError(`서버 설정이 빠졌습니다: ${name}`);
  return v;
}

/** 쏭비서에게 허용된 함수만. 이름을 밖에서 받지 않는다. */
export type SsongRpc =
  | 'ssong_submit' | 'ssong_my_requests' | 'ssong_search_clients' | 'ssong_search_contacts'
  | 'ssong_list_contracts' | 'ssong_doc_send_status' | 'ssong_list_staff'
  | 'ssong_daily_digest' | 'ssong_revenue_summary' | 'ssong_billing_watch' | 'ssong_audit_watch'
  | 'ssong_tg_claim' | 'ssong_tg_recall' | 'ssong_tg_remember'
  | 'ssong_engagement_status' | 'ssong_consult_history' | 'ssong_invoice_requests'
  | 'ssong_fss_updates' | 'ssong_fss_search';

export async function rpc<T = unknown>(name: SsongRpc, args: Record<string, unknown> = {}): Promise<T> {
  const url = env('SUPABASE_URL').replace(/\/+$/, '');
  const anon = env('SUPABASE_ANON_KEY');
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      'Content-Type': 'application/json',
      'x-ssong-key': env('SSONG_DB_KEY'),
      'User-Agent': 'ssong-mcp/0.1',
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { const j = JSON.parse(text) as { message?: string }; if (j.message) msg = j.message; } catch { /* 그대로 */ }
    throw new JaytaxError(msg || `JAYTAX 응답 ${res.status}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}
