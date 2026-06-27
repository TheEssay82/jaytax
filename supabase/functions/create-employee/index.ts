// Supabase Edge Function: 직원 계정 생성 (최고관리자 전용)
// 브라우저에 둘 수 없는 service_role 키를 서버(Edge)에서만 사용해 계정을 만든다.
// 배포: Supabase 대시보드 → Edge Functions → create-employee 생성 후 이 코드 붙여넣고 Deploy.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // 1) 호출자 인증 + 최고관리자 검증
    const authHeader = req.headers.get('Authorization') ?? '';
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const {
      data: { user },
    } = await caller.auth.getUser();
    if (!user) return json({ ok: false, error: '로그인이 필요합니다.' });

    const admin = createClient(url, service);
    const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).single();
    if (prof?.role !== 'superuser') return json({ ok: false, error: '권한이 없습니다 (최고관리자만 가능).' });

    // 2) 입력 검증
    const { email, password, name, role } = await req.json();
    if (!email || !password) return json({ ok: false, error: '이메일과 비밀번호는 필수입니다.' });
    if (String(password).length < 6) return json({ ok: false, error: '비밀번호는 6자 이상이어야 합니다.' });
    const allowed = ['superuser', 'accountant', 'team_lead', 'team_member'];
    const newRole = allowed.includes(role) ? role : 'team_member';

    // 3) 계정 생성 (이메일 자동 확인)
    const { data: created, error: cerr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: name || email },
    });
    if (cerr) return json({ ok: false, error: cerr.message });

    // 4) 프로필 역할·이름 설정 (가입 트리거가 만든 프로필 갱신)
    await admin
      .from('profiles')
      .update({ role: newRole, name: name || email })
      .eq('id', created.user!.id);

    return json({ ok: true, id: created.user!.id });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
