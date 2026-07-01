import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { normalizeRole, type Role } from '../lib/roles';

// 세션 유휴 타임아웃 — 마지막 활동 후 이 시간이 지나면 자동 로그아웃.
// (Supabase는 리프레시 토큰으로 무기한 유지되므로, 이 계층에서 유휴 만료를 강제한다.)
const IDLE_KEY = 'jaytax:lastActive';
const IDLE_LIMIT_MS = 8 * 60 * 60 * 1000; // 8시간

const touchActivity = () => { try { localStorage.setItem(IDLE_KEY, String(Date.now())); } catch { /* ignore */ } };
const idleExceeded = (): boolean => {
  try {
    const v = localStorage.getItem(IDLE_KEY);
    return v ? Date.now() - Number(v) > IDLE_LIMIT_MS : false;
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
  const [loading, setLoading] = useState(true);
  const signedInRef = useRef(false);

  async function loadProfile(uid: string) {
    try {
      const { data } = await supabase.from('profiles').select('role, name').eq('id', uid).maybeSingle();
      setRole(normalizeRole(data?.role as string | undefined));
      setProfileName((data?.name as string) || '');
    } catch {
      setRole('team_member');
      setProfileName('');
    }
  }

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      // 복원된 세션이 유휴 만료됐으면(예: 밤새 켜둔 채 방치) 자동 로그아웃.
      if (data.session && idleExceeded()) {
        await supabase.auth.signOut();
        setSession(null);
        setLoading(false);
        return;
      }
      if (data.session) touchActivity();
      setSession(data.session);
      if (data.session?.user) await loadProfile(data.session.user.id);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      signedInRef.current = !!s;
      if (s) touchActivity();
      setSession(s);
      if (s?.user) await loadProfile(s.user.id);
      else {
        setRole('team_member');
        setProfileName('');
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // 유휴 타임아웃: 활동 시각 갱신 + 주기 점검(만료 시 로그아웃)
  useEffect(() => {
    const onActivity = () => { if (signedInRef.current) touchActivity(); };
    const winEvents: (keyof WindowEventMap)[] = ['mousedown', 'keydown', 'touchstart'];
    for (const e of winEvents) window.addEventListener(e, onActivity, { passive: true });
    // 탭 복귀 시 즉시 유휴 만료 점검
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (signedInRef.current && idleExceeded()) supabase.auth.signOut();
      else onActivity();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => {
      if (signedInRef.current && idleExceeded()) supabase.auth.signOut();
    }, 60_000);
    return () => {
      for (const e of winEvents) window.removeEventListener(e, onActivity);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, []);

  const signIn: AuthValue['signIn'] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const changePassword: AuthValue['changePassword'] = async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error: error?.message ?? null };
  };

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, role, profileName, loading, signIn, signOut, changePassword }}
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
