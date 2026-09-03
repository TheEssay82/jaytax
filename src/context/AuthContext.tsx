import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { normalizeRole, type Role } from '../lib/roles';
import { logAccess, checkLoginGate, recordLoginFailure, recordLoginSuccess, lockMessage, remainMessage } from '../lib/accessLogApi';

// 세션 하드 캡 — 로그인 시각 기준으로 이 시간이 지나면 활동 여부와 무관하게 강제 로그아웃.
// (Supabase는 리프레시 토큰으로 무기한 유지되므로, 이 계층에서 만료를 강제한다.)
// 근무시간(점심 포함 약 8시간, 9:30~17:30)에 맞춰 출근 로그인 후 하루는 유지되게 8시간.
const LOGIN_KEY = 'jaytax:loginAt';
const SESSION_LIMIT_MS = 8 * 60 * 60 * 1000; // 8시간 (로그인 시각 기준 하드 캡)

const markLogin = () => { try { localStorage.setItem(LOGIN_KEY, String(Date.now())); } catch { /* ignore */ } };
const sessionExpired = (): boolean => {
  try {
    const v = localStorage.getItem(LOGIN_KEY);
    if (!v) return false; // 기록이 없으면 만료로 보지 않는다(복원 시 지금 시각으로 채움)
    return Date.now() - Number(v) > SESSION_LIMIT_MS;
  } catch {
    return false;
  }
};

interface AuthValue {
  session: Session | null;
  user: User | null;
  /** 현재 사용자 역할 (profiles.role) */
  role: Role;
  /** 담당자 이름 (profiles.name) — 통계 본인필터 기준 */
  profileName: string;
  /** 읽기전용 계정 여부 (profiles.readonly) — 저장·변경·삭제가 서버에서 차단됨 */
  readonly: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /** 로그인한 본인의 비밀번호 변경 */
  changePassword: (newPassword: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role>('team_member');
  const [profileName, setProfileName] = useState('');
  const [readonly, setReadonly] = useState(false);
  const [loading, setLoading] = useState(true);
  const signedInRef = useRef(false);

  async function loadProfile(uid: string) {
    try {
      const { data } = await supabase.from('profiles').select('role, name, readonly').eq('id', uid).maybeSingle();
      setRole(normalizeRole(data?.role as string | undefined));
      setProfileName((data?.name as string) || '');
      setReadonly(!!data?.readonly);
    } catch {
      setRole('team_member');
      setProfileName('');
      setReadonly(false);
    }
  }

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      // 복원된 세션이 로그인 후 8시간을 넘겼으면(예: 어제 로그인한 채 방치) 강제 로그아웃.
      if (data.session && sessionExpired()) {
        void supabase.auth.signOut();
        setSession(null);
        setLoading(false);
        return;
      }
      // 로그인 시각 기록이 없는 기존 세션은 지금을 기준으로 삼는다(이후 8시간 캡 적용).
      if (data.session) { signedInRef.current = true; if (!localStorage.getItem(LOGIN_KEY)) markLogin(); }
      setSession(data.session);
      setLoading(false); // 세션 확인 즉시 화면 표시(프로필/역할은 뒤따라 로드) — 로딩 화면에서 멈추지 않게
      if (data.session?.user) void loadProfile(data.session.user.id);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      signedInRef.current = !!s;
      // 로그인 시각은 '실제 로그인' 때만 기록한다. 토큰 자동갱신(TOKEN_REFRESHED)·초기세션 이벤트로
      // 리셋하면 하드 캡이 계속 밀려 강제 로그아웃이 동작하지 않는다(새로고침으로도 연장 불가하게).
      if (event === 'SIGNED_IN') markLogin();
      setSession(s);
      // ⚠️ onAuthStateChange 콜백은 GoTrue 락을 쥔 채 실행된다. 이 안에서 supabase 호출을 await 하면
      // 데드락(로그인/새로고침 직후 화면이 안 뜨는 원인). 프로필 로드는 콜백 밖(다음 틱)으로 미룬다.
      if (s?.user) {
        const uid = s.user.id;
        setTimeout(() => { void loadProfile(uid); }, 0);
      } else {
        setRole('team_member');
        setProfileName('');
        setReadonly(false);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // 하드 캡: 60초마다 로그인 후 8시간 경과 점검 + 탭 복귀 시 즉시 점검(만료 시 강제 로그아웃)
  useEffect(() => {
    const check = () => { if (signedInRef.current && sessionExpired()) supabase.auth.signOut(); };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(check, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, []);

  const signIn: AuthValue['signIn'] = async (email, password) => {
    // ① 잠겨 있으면 비밀번호를 보내지도 않는다 (고시 제5조제6항).
    const gate = await checkLoginGate(email);
    if (gate.locked) return { error: lockMessage(gate) };

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      // ② 실패를 남긴다. 이 경로는 세션이 없어 anon 으로 부를 수 있는 RPC 를 쓴다.
      const after = await recordLoginFailure(email);
      if (after.locked) return { error: lockMessage(after) };
      return { error: (error.message ?? '') + remainMessage(after) };
    }
    // ③ 성공 — 실패 카운터를 풀고 접속기록을 남긴다.
    //    접속기록을 onAuthStateChange 의 SIGNED_IN 에 걸면 탭 복귀·토큰 갱신·HMR 로도 튀어
    //    실제로 로그인하지 않은 줄이 쌓인다(2초마다 한 줄씩 쌓였다). 로그인은 여기서 딱 한 번이다.
    void recordLoginSuccess(email);
    void logAccess('login');
    return { error: null };
  };

  const signOut = async () => {
    // 로그아웃은 **세션이 살아 있을 때** 남겨야 한다 — 끊고 나면 누구인지 알 수 없다.
    await logAccess('logout');
    await supabase.auth.signOut();
  };

  const changePassword: AuthValue['changePassword'] = async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error: error?.message ?? null };
  };

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, role, profileName, readonly, loading, signIn, signOut, changePassword }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
