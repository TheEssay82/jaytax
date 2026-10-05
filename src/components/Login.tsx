import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';

// 로그인 화면 — 왼쪽 소개 영상 · 오른쪽 로그인을 **한 장의 카드**로(2026-10-06 「화면 크기와 로그인 칸이 안 맞아 균형이 어긋나 보인다」).
// 두 칸은 높이가 같고 가운데 선으로 나뉜다. 좁은 화면(820px 아래)에서는 로그인이 위, 영상이 아래로 쌓인다.
// 영상은 누를 때만 내려받는다(preload none) — 로그인만 하는 직원에게는 첫 화면 그림만 간다.
const CSS = `
.login-shell { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #F0EDE7; padding: 24px 16px; }
.login-card { width: min(1080px, 100%); display: grid; grid-template-columns: minmax(0, 1fr) 360px; background: #fff;
  border: 1px solid var(--rule); border-radius: 16px; box-shadow: 0 10px 34px rgba(26, 43, 82, .12); overflow: hidden; }
.login-media { padding: 28px; display: flex; flex-direction: column; justify-content: center; gap: 12px; background: #F7F8FB; border-right: 1px solid var(--rule); }
.login-media video { width: 100%; aspect-ratio: 16 / 9; display: block; border-radius: 10px; background: #fff; box-shadow: 0 4px 16px rgba(26, 43, 82, .12); }
.login-form { padding: 36px 34px; display: flex; flex-direction: column; justify-content: center; }
@media (max-width: 820px) {
  .login-card { grid-template-columns: 1fr; }
  .login-form { order: -1; padding: 28px 24px; }
  .login-media { border-right: 0; border-top: 1px solid var(--rule); padding: 18px; }
}
`;

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signIn(email.trim(), password);
    if (error) setError('로그인 실패: 이메일 또는 비밀번호를 확인하세요.');
    setBusy(false);
  }

  return (
    <div className="login-shell">
      <style>{CSS}</style>
      <div className="login-card">
        <div className="login-media">
          <video src="/promo/jaytax-intro.mp4" poster="/promo/jaytax-intro.jpg" controls preload="none" playsInline />
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8, rowGap: 2, color: 'var(--navy)' }}>
            <b style={{ fontSize: 'var(--fs-2)', whiteSpace: 'nowrap' }}>JAYTAX 소개 영상</b>
            <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>3분 · 정산표 이월 · 주석·DSD 검증 · 일반조서 · 조회서</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div style={{ textAlign: 'center', marginBottom: 26 }}>
            <div
              style={{
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontSize: 42,
                fontWeight: 500,
                letterSpacing: 12,
                color: 'var(--navy)',
                paddingLeft: 12,
                lineHeight: 1.1,
              }}
            >
              JAY
            </div>
            <div style={{ height: 1, background: 'var(--gold)', width: '86%', margin: '8px auto 11px' }} />
            <div style={{ fontSize: 'var(--fs-0)', letterSpacing: 4, color: 'var(--navy)' }}>JIWON ACCOUNTING</div>
            <div style={{ fontSize: 'var(--fs-0)', letterSpacing: 4, color: 'var(--navy)', marginTop: 3 }}>FOR YOU</div>
            <div style={{ fontSize: 'var(--fs-2)', letterSpacing: 2, color: 'var(--ink-2)', marginTop: 7 }}>
              세무회계사무소 지원
            </div>
          </div>
          {error && <div className="alert-w" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="frow" style={{ gridTemplateColumns: '1fr' }}>
            <label className="fl">이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@jaytax.co.kr"
              required
            />
          </div>
          <div className="frow" style={{ gridTemplateColumns: '1fr', borderTop: 'none' }}>
            <label className="fl">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button className="btn-p" type="submit" disabled={busy} style={{ width: '100%', marginTop: 14 }}>
            {busy ? '로그인 중…' : '로그인'}
          </button>
        </form>
      </div>
    </div>
  );
}
