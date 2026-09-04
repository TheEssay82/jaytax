// 2차 인증 — 등록·해제(본인) 모달.
import { useEffect, useState } from 'react';
import { useEscape } from '../lib/useEscape';
import { startEnroll, confirmEnroll, listFactors, unenroll, assuranceLevel, type TotpFactor, type EnrollStart } from '../lib/mfaApi';

export default function MfaModal({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [factors, setFactors] = useState<TotpFactor[] | null>(null);
  const [enroll, setEnroll] = useState<EnrollStart | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [aal, setAal] = useState<string | null>(null);

  const load = async () => {
    try { setFactors(await listFactors()); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setFactors([]); }
    setAal((await assuranceLevel()).current);
  };
  useEffect(() => { void load(); }, []);

  const active = (factors ?? []).filter((f) => f.status === 'verified');

  async function begin() {
    setBusy(true); setErr('');
    try { setEnroll(await startEnroll()); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function finish() {
    if (!enroll) return;
    setBusy(true); setErr('');
    try {
      await confirmEnroll(enroll.factorId, code);
      setEnroll(null); setCode(''); setDone(true);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function remove(f: TotpFactor) {
    if (!confirm('2차 인증을 해제합니다.\n\n해제하면 이 계정은 비밀번호만으로 로그인됩니다. 진행할까요?')) return;
    setBusy(true); setErr('');
    try { await unenroll(f.id); setDone(false); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 70,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, width: '100%' }}>
        <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          🔐 2차 인증
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>

        {factors === null ? (
          <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-3)', padding: '12px 0' }}>불러오는 중…</div>
        ) : active.length && !enroll ? (
          <>
            <div className="alert-s" style={{ fontSize: 'var(--fs-1)' }}>
              ✅ <b>2차 인증이 켜져 있습니다.</b> 로그인할 때마다 인증 앱의 숫자 6자리를 묻습니다.
            </div>
            {active.map((f) => (
              <div key={f.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-2)',
                border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 10px', marginTop: 8,
              }}>
                <span>📱 {f.friendlyName}</span>
                <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}>
                  {f.createdAt?.slice(0, 10)} 등록
                </span>
                <button className="btn-sm btn-sm-del" disabled={busy} onClick={() => void remove(f)}>해제</button>
              </div>
            ))}
            {aal !== 'aal2' && (
              <div className="alert-w" style={{ fontSize: 'var(--fs-1)', marginTop: 8 }}>
                해제는 <b>2차 인증을 통과한 세션에서만</b> 됩니다. 지금 세션은 통과 전이라 해제가 막힙니다 —
                로그아웃 후 다시 로그인해 6자리를 입력하고 오세요. (기기를 잃은 사람이 아니라 남이 풀어 버리는 일을 막습니다)
              </div>
            )}
          </>
        ) : enroll ? (
          <>
            <div className="alert-i" style={{ fontSize: 'var(--fs-1)' }}>
              인증 앱(Google Authenticator·Authy 등)으로 <b>아래 QR을 찍으세요.</b>
              그런 다음 앱에 뜬 <b>숫자 6자리</b>를 입력하면 켜집니다.
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
              {/* Supabase 는 **이미 data URI 로** 준다(data:image/svg+xml;utf-8,…).
                  그대로 쓰고, 혹시 날 SVG 로 오는 버전이면 그때만 감싼다 — 두 번 감싸면 안 뜬다. */}
              <img
                alt="2차 인증 QR"
                src={enroll.qrSvg.startsWith('data:')
                  ? enroll.qrSvg
                  : `data:image/svg+xml;utf8,${encodeURIComponent(enroll.qrSvg)}`}
                style={{ width: 190, height: 190, border: '1px solid var(--rule)', borderRadius: 6, background: '#fff' }}
              />
            </div>
            <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', marginBottom: 8 }}>
              QR을 못 찍으면 앱에 이 키를 직접 넣으세요 —{' '}
              <code style={{ fontSize: 'var(--fs-1)', background: '#f5efdd', padding: '1px 4px', borderRadius: 3, wordBreak: 'break-all' }}>
                {enroll.secret}
              </code>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="숫자 6자리" inputMode="numeric" autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) void finish(); }}
                style={{ flex: 1, fontSize: 18, letterSpacing: 6, textAlign: 'center' }}
              />
              <button className="btn-p" disabled={busy || code.length !== 6} onClick={() => void finish()}>
                {busy ? '확인 중…' : '켜기'}
              </button>
            </div>
            <button className="btn-sm" style={{ marginTop: 8 }} disabled={busy}
              onClick={() => { setEnroll(null); setCode(''); setErr(''); }}>
              그만두기
            </button>
          </>
        ) : (
          <>
            <div className="alert-w" style={{ fontSize: 'var(--fs-1)' }}>
              ⚠️ <b>2차 인증이 꺼져 있습니다.</b> 비밀번호가 새면 그것만으로 들어올 수 있습니다.
              <br />「개인정보의 안전성 확보조치 기준」 제6조제2항 — 외부에서 접속하는 경우
              <b>안전한 인증수단(2차 인증)</b> 또는 <b>안전한 접속수단(VPN 등)</b> 중 하나를 갖춰야 하며,
              <b>2026-10-31부터 시행</b>됩니다(부칙 제2025-9호).
            </div>
            <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', margin: '10px 0' }}>
              휴대폰의 인증 앱이 30초마다 바꿔 주는 숫자 6자리를 로그인할 때 함께 묻습니다.
              문자(SMS)를 쓰지 않는 이유는 번호를 또 받아 보관해야 하고 가로채기에도 약하기 때문입니다.
            </div>
            <button className="btn-p" disabled={busy} onClick={() => void begin()}>
              {busy ? '준비 중…' : '🔐 2차 인증 켜기'}
            </button>
          </>
        )}

        {done && <div className="alert-s" style={{ fontSize: 'var(--fs-1)', marginTop: 8 }}>✅ 켜졌습니다.</div>}
        {err && <div className="alert-e" style={{ fontSize: 'var(--fs-1)', marginTop: 8 }}>{err}</div>}
      </div>
    </div>
  );
}
