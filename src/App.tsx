import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './components/Login';
import AppShell from './components/AppShell';
import SharedConsult from './components/SharedConsult';

function Gate() {
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

export default function App() {
  // 외부 공유 페이지: 인증 게이트 앞에서 분기(비로그인 열람). 나머지는 로그인 후 앱.
  const share = window.location.pathname.match(/^\/share\/consult\/([\w-]+)$/);
  if (share) return <SharedConsult token={share[1]} />;

  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
