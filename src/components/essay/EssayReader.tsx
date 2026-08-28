// 비로그인 공개 열람 페이지 (/essay). 인증 게이트 밖(App.tsx)에서 렌더된다.
// 흐름: 이름 등록 → 랜덤 한 편 → 별 1~5 선택 → 확정 → 다음 편 → 모두 읽으면 감사 인사.
import { useCallback, useEffect, useState } from 'react';
import {
  bgUrl,
  clearToken,
  nextPiece,
  ratePiece,
  readerState,
  registerReader,
  savedToken,
  type EssayNext,
} from '../../lib/essayApi';
import { ensureEssayFonts, themeOf } from './essayTheme';
import EssayPaper from './EssayPaper';
import StarPicker from './StarPicker';

type Phase = 'boot' | 'register' | 'reading' | 'done' | 'error';

export default function EssayReader() {
  useEffect(ensureEssayFonts, []);
  const [phase, setPhase] = useState<Phase>('boot');
  const [token, setToken] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [next, setNext] = useState<EssayNext | null>(null);
  const [stars, setStars] = useState(0);

  const applyNext = useCallback((n: EssayNext) => {
    setNext(n);
    setStars(0);
    setPhase(n.done ? 'done' : 'reading');
  }, []);

  // 이 기기에 기억된 독자면 이어보기
  useEffect(() => {
    const t = savedToken();
    if (!t) {
      setPhase('register');
      return;
    }
    let alive = true;
    readerState(t)
      .then(async (st) => {
        if (!alive) return;
        if (!st) {
          clearToken();
          setPhase('register');
          return;
        }
        setToken(t);
        setName(st.name);
        applyNext(await nextPiece(t));
      })
      .catch(() => {
        if (alive) setPhase('error');
      });
    return () => {
      alive = false;
    };
  }, [applyNext]);

  async function submitName(e: React.FormEvent) {
    e.preventDefault();
    const v = name.trim();
    if (!v) {
      setMsg('이름을 입력해 주세요.');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const r = await registerReader(v);
      setToken(r.token);
      setName(r.name);
      applyNext(await nextPiece(r.token));
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setMsg(m === 'DUP' ? '이미 등록된 이름입니다. 다른 이름을 써 주세요.' : m);
    } finally {
      setBusy(false);
    }
  }

  async function confirmStars() {
    if (!token || !next?.piece || stars < 1) return;
    setBusy(true);
    setMsg('');
    try {
      applyNext(await ratePiece(token, next.piece.id, stars));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // ── 화면 ────────────────────────────────────────────────────────────
  if (phase === 'boot') return <Plain>불러오는 중…</Plain>;
  if (phase === 'error') return <Plain>일시적인 오류로 열지 못했습니다. 잠시 후 새로고침해 주세요.</Plain>;

  if (phase === 'register') {
    return (
      <Plain>
        <form onSubmit={submitName} style={{ width: '100%', maxWidth: 380, textAlign: 'center' }}>
          <div style={{ fontSize: 13, letterSpacing: '0.22em', color: '#9c8f7a', marginBottom: 10 }}>습작 읽기</div>
          <h1 style={{ fontFamily: "'Nanum Myeongjo', serif", fontSize: 26, color: '#332c20', margin: '0 0 12px', fontWeight: 700 }}>
            읽어 주셔서 고맙습니다
          </h1>
          <p style={{ fontSize: 14, color: '#8b7c63', lineHeight: 1.75, margin: '0 0 26px' }}>
            글 몇 편을 한 편씩 보여 드립니다.
            <br />
            읽으신 뒤 별점을 남겨 주세요.
          </p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="이름"
            maxLength={20}
            autoFocus
            style={{
              width: '100%',
              padding: '13px 14px',
              fontSize: 16,
              border: '1px solid #ddd2bb',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.8)',
              color: '#332c20',
              outline: 'none',
              textAlign: 'center',
            }}
          />
          {msg && <div style={{ marginTop: 10, fontSize: 13, color: '#b04a3a' }}>{msg}</div>}
          <button
            type="submit"
            disabled={busy}
            style={{
              marginTop: 16,
              width: '100%',
              padding: '13px 14px',
              fontSize: 15,
              fontWeight: 700,
              color: '#fff',
              background: '#5c4a2e',
              border: 'none',
              borderRadius: 10,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? '들어가는 중…' : '시작하기'}
          </button>
          <div style={{ marginTop: 14, fontSize: 12, color: '#a3947c' }}>이름은 중복될 수 없습니다.</div>
        </form>
      </Plain>
    );
  }

  if (phase === 'done') {
    const total = next?.total ?? 0;
    // 아직 공개된 글이 없을 때(=공개 전)와 다 읽었을 때는 다른 인사를 보여준다.
    return (
      <Plain>
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>{total > 0 ? '🌾' : '🕯️'}</div>
          <h1 style={{ fontFamily: "'Nanum Myeongjo', serif", fontSize: 28, color: '#332c20', margin: '0 0 12px', fontWeight: 700 }}>
            {total > 0 ? '감사합니다' : '아직 준비 중입니다'}
          </h1>
          <p style={{ fontSize: 15, color: '#8b7c63', lineHeight: 1.9, margin: 0 }}>
            {total > 0 ? (
              <>
                {name}님, {total}편을 모두 읽어 주셨습니다.
                <br />
                남겨 주신 별점은 잘 받았습니다.
              </>
            ) : (
              <>
                글을 다듬고 있습니다.
                <br />
                열리면 이 링크로 다시 찾아와 주세요.
              </>
            )}
          </p>
        </div>
      </Plain>
    );
  }

  // reading
  const piece = next!.piece!;
  const theme = themeOf(piece.bgKey);
  const idx = (next!.rated ?? 0) + 1;

  return (
    <EssayPaper
      title={piece.title}
      body={piece.body}
      bgKey={piece.bgKey}
      bgImageUrl={piece.bgPath ? bgUrl(piece.bgPath) : null}
      fontKey={piece.fontKey}
      corner={
        <span>
          {name} · {idx} / {next!.total}
        </span>
      }
      footer={
        <div
          style={{
            ...theme.sheet,
            borderRadius: 14,
            padding: '22px 20px 24px',
            textAlign: 'center',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
          }}
        >
          <div style={{ fontSize: 13.5, color: theme.soft, marginBottom: 14 }}>이 글에 별점을 남겨 주세요</div>
          <StarPicker value={stars} onChange={setStars} accent={theme.accent} soft={theme.soft} disabled={busy} />
          <div style={{ height: 18, marginTop: 8, fontSize: 12.5, color: theme.soft }}>
            {stars > 0 ? `별 ${stars}개` : '별을 눌러 고르세요'}
          </div>
          <button
            type="button"
            onClick={confirmStars}
            disabled={busy || stars < 1}
            style={{
              marginTop: 10,
              minWidth: 180,
              padding: '12px 22px',
              fontSize: 15,
              fontWeight: 700,
              color: stars < 1 ? theme.soft : '#fff',
              background: stars < 1 ? 'transparent' : theme.accent,
              border: `1px solid ${stars < 1 ? theme.soft : theme.accent}`,
              borderRadius: 10,
              cursor: busy || stars < 1 ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1,
              transition: 'background .15s ease, color .15s ease',
            }}
          >
            {busy ? '기록하는 중…' : '확정'}
          </button>
          {msg && <div style={{ marginTop: 10, fontSize: 13, color: '#d05a4a' }}>{msg}</div>}
        </div>
      }
    />
  );
}

function Plain({ children }: { children: React.ReactNode }) {
  useEffect(ensureEssayFonts, []);
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'radial-gradient(120% 90% at 50% 0%, #f6efdd 0%, #eadfc6 60%, #e0d3b6 100%)',
        fontFamily: "'Noto Sans KR', system-ui, sans-serif",
        color: '#5c4a2e',
      }}
    >
      {children}
    </div>
  );
}
