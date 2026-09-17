import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './components/Login';
import AppShell from './components/AppShell';
import MfaGate from './components/MfaGate';
import SharedConsult from './components/SharedConsult';
import EssayAdmin from './components/essay/EssayAdmin';
import { useNumericPlusKey } from './lib/useNumericPlusKey';

function Gate() {
  useNumericPlusKey(); // 전역: 금액칸에서 '+' → '000'
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--ink-3)' }}>
        불러오는 중…
      </div>
    );
  }
  return session ? <MfaGate><AppShell /></MfaGate> : <Login />;
}

/** 습작 열람이 끝났음을 알리는 한 장. 작품·평가는 건드리지 않는다. */
function EssayClosed() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f6f1e7', color: '#4a4237', fontFamily: 'inherit' }}>
      <div style={{ textAlign: 'center', lineHeight: 1.9, padding: 24 }}>
        <div style={{ fontSize: 20, letterSpacing: '0.06em' }}>습작 읽기를 마쳤습니다</div>
        <div style={{ fontSize: 14, color: '#8a8073', marginTop: 6 }}>읽어 주시고 순위를 매겨 주신 분들께 감사드립니다.</div>
      </div>
    </div>
  );
}

/** 습작 관리: 로그인은 필요하지만 좌측 메뉴에는 노출하지 않는 숨김 URL(/essay/admin). */
function EssayAdminGate() {
  const { session, loading } = useAuth();
  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--ink-3)' }}>불러오는 중…</div>;
  }
  return session ? <MfaGate><EssayAdmin /></MfaGate> : <Login />;
}

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '');

  // 외부 공유 페이지: 인증 게이트 앞에서 분기(비로그인 열람). 나머지는 로그인 후 앱.
  const share = window.location.pathname.match(/^\/share\/consult\/([\w-]+)$/);
  if (share) return <SharedConsult token={share[1]} />;

  // 습작(에세이) — 2026-09-18 열람을 닫았다(기고 마감). 주소를 아는 사람에게는 닫힘 안내만 보이고,
  // 통계는 관리(/essay/admin, 로그인 + 최고관리자)에서만 본다. 완전 제거는 마이그레이션 0065 롤백 참고.
  if (path === '/essay' || path === '/e') return <EssayClosed />;
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
