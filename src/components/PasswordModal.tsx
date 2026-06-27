// 비밀번호 변경 모달 — 로그인한 본인의 비밀번호 변경
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function PasswordModal({ onClose }: { onClose: () => void }) {
  const { changePassword } = useAuth();
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  async function submit() {
    if (pw1.length < 6) {
      setErr('비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    if (pw1 !== pw2) {
      setErr('두 비밀번호가 일치하지 않습니다.');
      return;
    }
    setBusy(true);
    setErr('');
    const { error } = await changePassword(pw1);
    setBusy(false);
    if (error) setErr('변경 실패: ' + error);
    else setDone(true);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
        <div className="chdr">🔑 비밀번호 변경</div>
        {done ? (
          <>
            <div className="alert-ok" style={{ marginTop: 8 }}>
              ✓ 비밀번호가 변경되었습니다.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-p" onClick={onClose}>
                확인
              </button>
            </div>
          </>
        ) : (
          <>
            {err && <div className="alert-w" style={{ marginTop: 8 }}>{err}</div>}
            <div className="frow" style={{ gridTemplateColumns: '1fr' }}>
              <label className="fl">새 비밀번호</label>
              <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="6자 이상" />
            </div>
            <div className="frow" style={{ gridTemplateColumns: '1fr', borderTop: 'none' }}>
              <label className="fl">새 비밀번호 확인</label>
              <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="다시 입력" />
            </div>
            <div style={{ display: 'flex', gap: 7, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-s" onClick={onClose} disabled={busy}>
                취소
              </button>
              <button className="btn-p" onClick={submit} disabled={busy}>
                {busy ? '변경 중…' : '변경'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
