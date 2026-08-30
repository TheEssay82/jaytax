// 비로그인 공개 열람 페이지 (/essay, /e). 인증 게이트 밖(App.tsx)에서 렌더된다.
// 흐름: 이름 등록 → 한 편씩 읽기(랜덤) → 전편을 읽으면 순위 정하기 + 한 줄 평 → 확정 → 감사 인사.
import { useCallback, useEffect, useState } from 'react';
import {
  bgUrl,
  clearToken,
  markRead,
  nameSuggestions,
  nextPiece,
  rankingSheet,
  readerState,
  registerReader,
  savedToken,
  submitRanking,
  type EssayNext,
  type RankingSheet,
} from '../../lib/essayApi';
import { ensureEssayFonts, themeOf } from './essayTheme';
import EssayPaper from './EssayPaper';
import RankingBoard from './RankingBoard';

type Phase = 'boot' | 'register' | 'reading' | 'ranking' | 'thanks' | 'closed' | 'empty' | 'error';

export default function EssayReader() {
  useEffect(ensureEssayFonts, []);
  const [phase, setPhase] = useState<Phase>('boot');
  const [token, setToken] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  /** 이름이 겹쳤을 때 눌러서 바로 쓸 수 있는 대안들 */
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [next, setNext] = useState<EssayNext | null>(null);
  const [sheet, setSheet] = useState<RankingSheet | null>(null);

  /** 다 읽었으면 순위 화면으로, 아니면 다음 편으로. 공개작이 없으면 준비중 안내.
   *  순위표를 받아오는 await 동안 'reading' 인 채로 다시 그려지면 안 되므로,
   *  화면 전환에 필요한 것을 모두 갖춘 뒤에 한꺼번에 상태를 바꾼다. */
  const applyNext = useCallback(async (n: EssayNext, t: string) => {
    if (!n.done) {
      setNext(n);
      setPhase('reading');
      return;
    }
    if (n.total === 0) {
      setNext(n);
      setPhase('empty');
      return;
    }
    const s = await rankingSheet(t);
    setSheet(s);
    setNext(n);
    setPhase('ranking');
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
        // 이미 순위를 낸 사람은 감사 화면부터(원하면 거기서 다시 정할 수 있다).
        // 확정 후 일정 시간이 지나 잠긴 사람은 마감 안내만 본다.
        if (st.submitted) {
          setSheet(await rankingSheet(t));
          setPhase(st.locked ? 'closed' : 'thanks');
          return;
        }
        await applyNext(await nextPiece(t), t);
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
    setSuggestions([]);
    try {
      const r = await registerReader(v);
      setToken(r.token);
      setName(r.name);
      await applyNext(await nextPiece(r.token), r.token);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      if (m === 'DUP') {
        setMsg('이미 쓰고 있는 이름입니다. 아래에서 고르거나 다르게 적어 주세요.');
        setSuggestions(await nameSuggestions(v));
      } else {
        setMsg(m);
      }
    } finally {
      setBusy(false);
    }
  }

  async function finishPiece() {
    if (!token || !next?.piece) return;
    setBusy(true);
    setMsg('');
    try {
      await applyNext(await markRead(token, next.piece.id), token);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveRanking(order: string[], comment: string) {
    if (!token) return;
    setBusy(true);
    setMsg('');
    try {
      await submitRanking(token, order, comment);
      setSheet(await rankingSheet(token));
      setPhase('thanks');
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

  if (phase === 'empty') {
    return (
      <Plain>
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>🕯️</div>
          <h1 style={headline}>아직 준비 중입니다</h1>
          <p style={sub}>
            글을 다듬고 있습니다.
            <br />
            열리면 이 링크로 다시 찾아와 주세요.
          </p>
        </div>
      </Plain>
    );
  }

  if (phase === 'register') {
    return (
      <Plain>
        <form onSubmit={submitName} style={{ width: '100%', maxWidth: 380, textAlign: 'center' }}>
          <div style={{ fontSize: 13, letterSpacing: '0.22em', color: '#9c8f7a', marginBottom: 10 }}>습작 읽기</div>
          <h1 style={{ ...headline, fontSize: 26 }}>읽어 주셔서 고맙습니다</h1>
          <p style={{ ...sub, fontSize: 14, margin: '0 0 26px' }}>
            글을 한 편씩 보여 드립니다.
            <br />
            다 읽으신 뒤 좋았던 순서대로 순위를 매겨 주세요.
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
              boxSizing: 'border-box',
            }}
          />
          <div
            style={{
              marginTop: 12,
              fontSize: 12.5,
              lineHeight: 1.7,
              color: '#8b7c63',
              background: 'rgba(255,255,255,0.55)',
              border: '1px solid #e6ddc9',
              borderRadius: 10,
              padding: '10px 12px',
              textAlign: 'left',
            }}
          >
            <b style={{ color: '#5c4a2e' }}>지금 열어둔 이 창에서 끝까지 읽어 주세요.</b>
            <br />
            중간에 다른 앱이나 다른 기기로 옮기면 이어서 볼 수 없습니다. 카카오톡으로 링크를 받으셨다면 카카오톡 안에서 그대로 읽으시면 됩니다.
          </div>
          {msg && <div style={{ marginTop: 10, fontSize: 13, color: '#b04a3a' }}>{msg}</div>}
          {suggestions.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setName(s);
                    setMsg('');
                    setSuggestions([]);
                  }}
                  style={{
                    padding: '8px 14px',
                    fontSize: 14,
                    color: '#5c4a2e',
                    background: 'rgba(255,255,255,0.85)',
                    border: '1px solid #ddd2bb',
                    borderRadius: 999,
                    cursor: 'pointer',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
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
          <div style={{ marginTop: 14, fontSize: 12, color: '#a3947c' }}>다른 분과 겹치지 않는 이름으로 적어 주세요.</div>
        </form>
      </Plain>
    );
  }

  if (phase === 'ranking' && sheet) {
    return (
      <RankingBoard
        pieces={sheet.pieces}
        initialOrder={sheet.myOrder}
        initialComment={sheet.comment}
        submitted={sheet.submitted}
        busy={busy}
        error={msg}
        onSubmit={saveRanking}
      />
    );
  }

  if ((phase === 'thanks' || phase === 'closed') && sheet) {
    const closed = phase === 'closed';
    const ordered = sheet.myOrder.map((id) => sheet.pieces.find((p) => p.id === id)).filter(Boolean);
    return (
      <Plain>
        <div style={{ textAlign: 'center', maxWidth: 460, width: '100%' }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>{closed ? '🔒' : '🌾'}</div>
          <h1 style={headline}>{closed ? '평가가 마감되었습니다' : '감사합니다'}</h1>
          <p style={{ ...sub, marginBottom: 22 }}>
            {closed ? (
              <>
                {sheet.name}님의 순위는 잘 저장되었습니다.
                <br />
                읽어 주셔서 고맙습니다.
              </>
            ) : (
              <>
                {sheet.name}님이 정해 주신 순위입니다.
                <br />
                큰 도움이 되었습니다.
              </>
            )}
          </p>
          <ol style={{ textAlign: 'left', margin: '0 0 18px', padding: 0, listStyle: 'none' }}>
            {ordered.map((p, i) => (
              <li
                key={p!.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 14px',
                  background: 'rgba(255,252,244,0.75)',
                  border: '1px solid #e6ddc9',
                  borderRadius: 10,
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: i === 0 ? '#5c4a2e' : '#cdc0a6',
                    color: '#fff',
                    fontSize: 12.5,
                    fontWeight: 700,
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ fontFamily: "'Nanum Myeongjo', serif", fontSize: 15.5, color: '#3d3527' }}>{p!.title}</span>
              </li>
            ))}
          </ol>
          {sheet.comment && (
            <div style={{ fontSize: 13.5, color: '#8b7c63', fontStyle: 'italic', marginBottom: 18 }}>“{sheet.comment}”</div>
          )}
          {!closed && (
            <button
              type="button"
              onClick={() => {
                setMsg('');
                setPhase('ranking');
              }}
              style={{
                padding: '10px 18px',
                fontSize: 13.5,
                color: '#5c4a2e',
                background: 'rgba(255,255,255,0.8)',
                border: '1px solid #ddd2bb',
                borderRadius: 999,
                cursor: 'pointer',
              }}
            >
              순위 다시 정하기
            </button>
          )}
        </div>
      </Plain>
    );
  }

  // reading — 상태가 어긋난 순간에도 흰 화면이 뜨지 않도록 방어한다
  if (!next?.piece) return <Plain>불러오는 중…</Plain>;
  const piece = next.piece;
  const theme = themeOf(piece.bgKey);
  const idx = (next.read ?? 0) + 1;
  const last = idx === next.total;

  return (
    <EssayPaper
      title={piece.title}
      body={piece.body}
      bgKey={piece.bgKey}
      bgImageUrl={piece.bgPath ? bgUrl(piece.bgPath) : null}
      fontKey={piece.fontKey}
      corner={
        <span>
          {name} · {idx} / {next.total}
        </span>
      }
      footer={
        <div
          style={{
            ...theme.sheet,
            borderRadius: 14,
            padding: '20px 20px 22px',
            textAlign: 'center',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
          }}
        >
          <div style={{ fontSize: 13.5, color: theme.soft, marginBottom: 14 }}>
            {last ? '마지막 글입니다. 다 읽으셨으면 순위를 정해 주세요.' : '다 읽으셨으면 다음 글로 넘어갑니다.'}
          </div>
          <button
            type="button"
            onClick={finishPiece}
            disabled={busy}
            style={{
              minWidth: 200,
              padding: '13px 22px',
              fontSize: 15,
              fontWeight: 700,
              color: '#fff',
              background: theme.accent,
              border: 'none',
              borderRadius: 10,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? '넘어가는 중…' : last ? '순위 정하러 가기' : '다 읽었습니다'}
          </button>
          {msg && <div style={{ marginTop: 10, fontSize: 13, color: '#d05a4a' }}>{msg}</div>}
        </div>
      }
    />
  );
}

const headline: React.CSSProperties = {
  fontFamily: "'Nanum Myeongjo', serif",
  fontSize: 28,
  color: '#332c20',
  margin: '0 0 12px',
  fontWeight: 700,
};
const sub: React.CSSProperties = { fontSize: 15, color: '#8b7c63', lineHeight: 1.9, margin: 0 };

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
