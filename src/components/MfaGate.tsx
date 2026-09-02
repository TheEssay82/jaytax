// 로그인 후 2차 인증 관문.
//
// 비밀번호만 맞힌 세션(aal1)은 **화면을 보면 안 된다**. 등록된 인증수단이 있는데
// 아직 6자리를 통과하지 않았으면 여기서 앱 전체를 가린다.
//
// 서버(RLS)가 aal 로 막지는 않으므로 이것은 어디까지나 화면 관문이다 —
// 진짜 방어는 비밀번호와 TOTP 로 세션을 얻는 단계에 있다. 다만 통과 전 화면에
// 개인정보를 그려 놓지 않는 것만으로도 어깨너머·자리 비움 상황을 크게 줄인다.
import { useEffect, useState, type ReactNode } from 'react';
import { needsMfaChallenge, verifyLogin } from '../lib/mfaApi';
import { useAuth } from '../context/AuthContext';

export default function MfaGate({ children }: { children: ReactNode }) {
  const { session, signOut } = useAuth();
  const [need, setNeed] = useState<boolean | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    if (!session) { setNeed(false); return; }
    void needsMfaChallenge()
      .then((v) => { if (alive) setNeed(v); })
      .catch(() => { if (alive) setNeed(false); });   // 판정 실패로 사람을 잠그지 않는다
    return () => { alive = false; };
  }, [session]);

  async function submit() {
    setBusy(true); setErr('');
    try {
      await verifyLogin(code);
      setNeed(false); setCode('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setCode('');
    } finally { setBusy(false); }
  }

  if (need !== true) return <>{children}</>;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#1A2B52', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div className="card" style={{ maxWidth: 380, width: '100%' }}>
        <div className="chdr">🔐 2차 인증</div>
        <div style={{ fontSize: 12, color: '#444', margin: '4px 0 12px' }}>
          인증 앱에 지금 떠 있는 <b>숫자 6자리</b>를 입력해 주세요.
        </div>
        <input
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000" inputMode="numeric" autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) void submit(); }}
          style={{ width: '100%', fontSize: 24, letterSpacing: 10, textAlign: 'center', padding: '8px 0' }}
        />
        <button className="btn-p" style={{ width: '100%', marginTop: 10 }}
          disabled={busy || code.length !== 6} onClick={() => void submit()}>
          {busy ? '확인 중…' : '확인'}
        </button>
        {err && <div className="alert-e" style={{ fontSize: 11.5, marginTop: 8 }}>{err}</div>}
        <button className="btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={() => void signOut()}>
          다른 계정으로 로그인
        </button>
        <div style={{ fontSize: 10.5, color: '#888', marginTop: 10, lineHeight: 1.5 }}>
          휴대폰을 잃어버려 들어올 수 없다면 최고관리자에게 해제를 요청하세요.
        </div>
      </div>
    </div>
  );
}
