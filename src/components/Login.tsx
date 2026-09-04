import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';

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
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F0EDE7',
      }}
    >
      <form onSubmit={handleSubmit} className="card" style={{ width: 340, padding: '28px 26px' }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
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

        {/* 습작 열람(비로그인) 링크 — 한시적. 기고가 끝나면 이 블록을 지운다. 마이그레이션 0065 참고. */}
        <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid #ece7dc', textAlign: 'center' }}>
          <a
            href="/e"
            style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-3)', textDecoration: 'none', letterSpacing: '0.02em' }}
          >
            습작 읽기 <span style={{ color: 'var(--gold)' }}>→</span>
          </a>
        </div>
      </form>
    </div>
  );
}
