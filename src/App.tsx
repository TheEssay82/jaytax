import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './components/Login';
import AppShell from './components/AppShell';
import SharedConsult from './components/SharedConsult';
import EssayReader from './components/essay/EssayReader';
import EssayAdmin from './components/essay/EssayAdmin';
import { useNumericPlusKey } from './lib/useNumericPlusKey';

function Gate() {
  useNumericPlusKey(); // 전역: 금액칸에서 '+' → '000'
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#888' }}>
        불러오는 중…
      </div>
    );
  }
  return session ? <AppShell /> : <Login />;
}

/** 습작 관리: 로그인은 필요하지만 좌측 메뉴에는 노출하지 않는 숨김 URL(/essay/admin). */
function EssayAdminGate() {
  const { session, loading } = useAuth();
  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#888' }}>불러오는 중…</div>;
  }
  return session ? <EssayAdmin /> : <Login />;
}

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '');

  // 외부 공유 페이지: 인증 게이트 앞에서 분기(비로그인 열람). 나머지는 로그인 후 앱.
  const share = window.location.pathname.match(/^\/share\/consult\/([\w-]+)$/);
  if (share) return <SharedConsult token={share[1]} />;

  // 습작(에세이) — 열람은 비로그인 공개, 관리는 로그인 + 숨김 URL. 마이그레이션 0065.
  if (path === '/essay' || path === '/e') return <EssayReader />; // /e = 문자로 보내기 좋은 짧은 주소
  if (path === '/essay/admin') {
    return (
      <AuthProvider>
        <EssayAdminGate />
      </AuthProvider>
    );
  }

  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
