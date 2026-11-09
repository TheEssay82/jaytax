// 회사 전용 주소 — /kifrs1118_<회사키>(예: /kifrs1118_neptune). 사용자 2026-11-09 「주소는 별도로」.
// jaytax 의 다른 메뉴는 보이지 않고 1118 월결산 화면 하나만 뜬다. 로그인 · 2단계 인증 · RLS 는 본 앱과 같다.
import { useAuth } from '../../context/AuthContext';
import Ifrs18Tab from './Ifrs18Tab';

export default function Ifrs18Page({ clientKey }: { clientKey: string }) {
  const { profileName, signOut } = useAuth();
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #F8FAFC)' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', background: 'var(--navy)', color: '#fff' }}>
        <b>📐 K-IFRS 1118 월결산</b>
        <span style={{ opacity: 0.75, fontSize: 'var(--fs-1)' }}>인덕회계법인 · jaytax</span>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-1)' }}>{profileName}</span>
        <button className="btn-sm" onClick={() => { void signOut(); }}>로그아웃</button>
      </header>
      <main style={{ maxWidth: 1280, margin: '0 auto', padding: 16 }}>
        <Ifrs18Tab fixedKey={clientKey} />
      </main>
    </div>
  );
}
