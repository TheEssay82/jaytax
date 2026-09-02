// 2차 인증(TOTP) — Supabase Auth MFA 얇은 감싸개.
//
// 개인정보보호법 「안전성 확보조치 기준」 제6조. 외부 접속은 2차 인증을 거쳐야 하고,
// **2026-10-30 고시 개정으로 전체 사용자로 확대**된다. 그 전에 자리를 만들어 둔다.
//
// 왜 TOTP 인가 — SMS 는 번호를 또 받아 보관해야 하고(개인정보가 늘어난다) 가로채기에도 약하다.
// 인증 앱(Google Authenticator·Authy 등)은 저장할 개인정보가 없다.
import { supabase } from './supabase';

export interface TotpFactor {
  id: string;
  friendlyName: string;
  /** 'verified' 만 실제로 쓰인다. 'unverified' 는 등록하다 만 찌꺼기. */
  status: string;
  createdAt: string;
}

/** 등록을 시작하면 받는 것 — QR 은 SVG 문자열, 수동입력용 비밀키도 함께 준다. */
export interface EnrollStart {
  factorId: string;
  qrSvg: string;
  secret: string;
}

/**
 * 지금 이 세션의 인증 단계.
 *  - current 'aal1' + next 'aal2' → **2차 인증을 아직 통과하지 않았다**(막아야 한다).
 *  - current 'aal2'              → 통과했다.
 *  - next 'aal1'                 → 등록된 인증수단이 없다(막을 것도 없다).
 */
export async function assuranceLevel(): Promise<{ current: string | null; next: string | null }> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return { current: null, next: null };
  return { current: data.currentLevel, next: data.nextLevel };
}

/** 2차 인증을 통과해야 하는 상태인가. */
export async function needsMfaChallenge(): Promise<boolean> {
  const { current, next } = await assuranceLevel();
  return current === 'aal1' && next === 'aal2';
}

/**
 * 내가 등록해 둔 인증수단.
 *
 * **`data.totp` 를 보면 안 된다** — 거기엔 검증이 끝난 것만 담긴다. 등록하다 만
 * 찌꺼기(unverified)는 `data.all` 에만 있고, 그것이 보이지 않으면 치울 수도 없어
 * 다음 등록이 이름 충돌로 막힌다. `all` 에서 TOTP 만 골라 상태까지 그대로 넘긴다.
 */
export async function listFactors(): Promise<TotpFactor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw new Error(error.message);
  return (data.all ?? [])
    .filter((f) => f.factor_type === 'totp')
    .map((f) => ({
      id: f.id,
      friendlyName: f.friendly_name ?? '인증 앱',
      status: f.status,
      createdAt: f.created_at,
    }));
}

/**
 * 등록 시작 — QR 을 받는다. 아직 켜진 것은 아니다.
 * 사용자가 앱에 담고 6자리를 맞혀야(confirmEnroll) 완료된다.
 *
 * 등록하다 만 찌꺼기(unverified)가 쌓이면 다음 등록이 이름 충돌로 막힌다 — 먼저 치운다.
 */
export async function startEnroll(friendlyName = '인증 앱'): Promise<EnrollStart> {
  for (const f of await listFactors()) {
    if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => undefined);
  }
  // 이름은 **현지 날짜·시각**으로 붙인다. UTC 로 찍으면 새벽에 등록한 것이 어제 날짜가 된다.
  const stamp = new Date().toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `${friendlyName} ${stamp}`,
  });
  if (error) throw new Error(error.message);
  return { factorId: data.id, qrSvg: data.totp.qr_code, secret: data.totp.secret };
}

/** 6자리를 맞혀 등록을 마친다. 성공하면 이 세션은 바로 aal2 가 된다. */
export async function confirmEnroll(factorId: string, code: string): Promise<void> {
  const { data: ch, error: ce } = await supabase.auth.mfa.challenge({ factorId });
  if (ce) throw new Error(ce.message);
  const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: code.trim() });
  if (error) throw new Error(readable(error.message));
}

/** 로그인 후 2차 인증 — 등록된 수단으로 6자리를 확인한다. */
export async function verifyLogin(code: string): Promise<void> {
  const factors = await listFactors();
  const f = factors.find((x) => x.status === 'verified');
  if (!f) throw new Error('등록된 2차 인증 수단이 없습니다.');
  const { data: ch, error: ce } = await supabase.auth.mfa.challenge({ factorId: f.id });
  if (ce) throw new Error(ce.message);
  const { error } = await supabase.auth.mfa.verify({ factorId: f.id, challengeId: ch.id, code: code.trim() });
  if (error) throw new Error(readable(error.message));
}

/**
 * 해제. **2차 인증을 통과한 세션에서만** 된다 —
 * 아니면 기기를 잃은 사람이 아니라 남이 풀어 버릴 수 있다.
 */
export async function unenroll(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw new Error(readable(error.message));
}

/** GoTrue 오류 원문이 영어라 그대로 보여 주면 안 된다. */
function readable(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('invalid') && m.includes('code')) return '숫자 6자리가 맞지 않습니다. 앱에 지금 떠 있는 번호로 다시 시도해 주세요.';
  if (m.includes('expired')) return '입력 시간이 지났습니다. 앱에 새로 뜬 번호로 다시 시도해 주세요.';
  if (m.includes('rate') || m.includes('too many')) return '시도가 너무 잦습니다. 잠시 후 다시 시도해 주세요.';
  if (m.includes('aal2') || m.includes('assurance')) return '2차 인증을 통과한 뒤에만 해제할 수 있습니다.';
  return msg;
}
