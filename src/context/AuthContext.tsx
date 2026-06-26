import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { normalizeRole, type Role } from '../lib/roles';

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
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role>('team_member');
  const [profileName, setProfileName] = useState('');
  const [loading, setLoading] = useState(true);

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
      setSession(data.session);
      if (data.session?.user) await loadProfile(data.session.user.id);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
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

  const signIn: AuthValue['signIn'] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, role, profileName, loading, signIn, signOut }}
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
