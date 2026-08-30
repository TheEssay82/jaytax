// 모든 글을 읽은 뒤 순위를 정하는 화면. 좋았던 순서대로 눌러 담고, ▲▼ 로 미세조정한 뒤 확정한다.
// 드래그를 쓰지 않는 이유: 지인 대부분이 휴대폰으로 보는데, 모바일 드래그는 스크롤과 자주 충돌한다.
import { useEffect, useState } from 'react';
import type { EssayPieceView } from '../../lib/essayApi';
import { ensureEssayFonts, fontOf, themeOf } from './essayTheme';

type Props = {
  pieces: EssayPieceView[];
  initialOrder: string[];
  initialComment: string;
  submitted: boolean;
  busy: boolean;
  error: string;
  onSubmit: (order: string[], comment: string) => void;
};

export default function RankingBoard({ pieces, initialOrder, initialComment, submitted, busy, error, onSubmit }: Props) {
  useEffect(ensureEssayFonts, []);
  const [order, setOrder] = useState<string[]>(initialOrder.filter((id) => pieces.some((p) => p.id === id)));
  const [comment, setComment] = useState(initialComment);
  const [open, setOpen] = useState<string | null>(null); // 다시 읽기로 펼친 작품

  const byId = (id: string) => pieces.find((p) => p.id === id)!;
  const rest = pieces.filter((p) => !order.includes(p.id));
  const done = order.length === pieces.length && pieces.length > 0;

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(120% 90% at 50% 0%, #f6efdd 0%, #eadfc6 60%, #e0d3b6 100%)', padding: '28px 16px 60px' }}>
      <div style={{ maxWidth: 620, margin: '0 auto', fontFamily: "'Noto Sans KR', system-ui, sans-serif" }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 12.5, letterSpacing: '0.22em', color: '#9c8f7a', marginBottom: 8 }}>마지막 단계</div>
          <h1 style={{ fontFamily: "'Nanum Myeongjo', serif", fontSize: 25, color: '#332c20', margin: '0 0 10px', fontWeight: 700 }}>
            {submitted ? '순위를 다시 정하시겠어요?' : `${pieces.length}편을 모두 읽으셨습니다`}
          </h1>
          <p style={{ fontSize: 14, color: '#8b7c63', lineHeight: 1.8, margin: 0 }}>
            좋았던 순서대로 눌러 주세요.
            <br />
            제목을 누르면 글을 다시 볼 수 있습니다.
          </p>
        </div>

        {/* 정한 순위 */}
        <div style={card}>
          <div style={cardLabel}>
            내가 정한 순위 <span style={{ color: '#a3947c', fontWeight: 400 }}>{order.length} / {pieces.length}</span>
          </div>
          {order.length === 0 ? (
            <div style={{ fontSize: 13.5, color: '#a3947c', padding: '14px 2px' }}>
              아래에서 가장 좋았던 글부터 눌러 주세요.
            </div>
          ) : (
            order.map((id, i) => (
              <Row
                key={id}
                piece={byId(id)}
                open={open === id}
                onToggle={() => setOpen(open === id ? null : id)}
                left={
                  <span style={rankBadge}>{i + 1}</span>
                }
                right={
                  <span style={{ display: 'flex', gap: 4 }}>
                    <button type="button" style={iconBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label="위로">
                      ▲
                    </button>
                    <button type="button" style={iconBtn} disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label="아래로">
                      ▼
                    </button>
                    <button
                      type="button"
                      style={{ ...iconBtn, width: 'auto', padding: '0 9px', color: '#b04a3a' }}
                      onClick={() => setOrder(order.filter((x) => x !== id))}
                    >
                      빼기
                    </button>
                  </span>
                }
              />
            ))
          )}
        </div>

        {/* 아직 안 정한 작품 */}
        {rest.length > 0 && (
          <div style={card}>
            <div style={cardLabel}>아직 순위를 정하지 않은 글</div>
            {rest.map((p) => (
              <Row
                key={p.id}
                piece={p}
                open={open === p.id}
                onToggle={() => setOpen(open === p.id ? null : p.id)}
                right={
                  <button type="button" style={pickBtn} onClick={() => setOrder([...order, p.id])}>
                    {order.length + 1}위로
                  </button>
                }
              />
            ))}
          </div>
        )}

        {/* 한 줄 평 */}
        <div style={card}>
          <div style={cardLabel}>
            한 줄 평 <span style={{ color: '#a3947c', fontWeight: 400 }}>(선택)</span>
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, 200))}
            placeholder="읽으면서 든 생각을 한 줄로 남겨 주세요."
            rows={3}
            style={{
              width: '100%',
              padding: '11px 12px',
              fontSize: 15,
              lineHeight: 1.6,
              border: '1px solid #ddd2bb',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.85)',
              color: '#332c20',
              outline: 'none',
              resize: 'vertical',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ fontSize: 11.5, color: '#a3947c', textAlign: 'right', marginTop: 4 }}>{comment.length} / 200</div>
        </div>

        {error && (
          <div style={{ fontSize: 13, color: '#b04a3a', background: '#fdf1ef', border: '1px solid #f0d6d0', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <button
          type="button"
          disabled={!done || busy}
          onClick={() => onSubmit(order, comment)}
          style={{
            width: '100%',
            padding: '15px 14px',
            fontSize: 16,
            fontWeight: 700,
            color: done ? '#fff' : '#a3947c',
            background: done ? '#5c4a2e' : 'rgba(255,255,255,0.6)',
            border: done ? 'none' : '1px solid #ddd2bb',
            borderRadius: 10,
            cursor: done && !busy ? 'pointer' : 'default',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? '보내는 중…' : done ? '순위 확정하기' : `${pieces.length - order.length}편 더 정해 주세요`}
        </button>
      </div>
    </div>
  );
}

function Row({
  piece,
  open,
  onToggle,
  left,
  right,
}: {
  piece: EssayPieceView;
  open: boolean;
  onToggle: () => void;
  left?: React.ReactNode;
  right: React.ReactNode;
}) {
  const theme = themeOf(piece.bgKey);
  const font = fontOf(piece.fontKey);
  return (
    <div style={{ borderTop: '1px solid #ece5d6' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 2px' }}>
        {left}
        <button
          type="button"
          onClick={onToggle}
          style={{
            flex: 1,
            textAlign: 'left',
            background: 'none',
            border: 'none',
            padding: 0,
            fontSize: 15.5,
            fontWeight: 600,
            color: '#3d3527',
            cursor: 'pointer',
            fontFamily: "'Nanum Myeongjo', serif",
          }}
        >
          {piece.title}
          <span style={{ fontSize: 11.5, color: '#a3947c', fontWeight: 400, marginLeft: 7, fontFamily: 'inherit' }}>
            {open ? '접기' : '다시 읽기'}
          </span>
        </button>
        {right}
      </div>
      {open && (
        <div
          style={{
            background: 'rgba(255,255,255,0.7)',
            border: '1px solid #ece5d6',
            borderRadius: 10,
            padding: '16px 16px 18px',
            margin: '0 0 12px',
            maxHeight: '55vh',
            overflow: 'auto',
          }}
        >
          {piece.body.split(/\n{2,}/).map((para, i) => (
            <p
              key={i}
              style={{
                margin: i === 0 ? 0 : '1em 0 0',
                fontFamily: font.family,
                fontSize: 16,
                lineHeight: 1.9,
                color: theme.ink === '#eceff8' || theme.ink === '#e8f0f2' || theme.ink === '#e9edf7' || theme.ink === '#e8f0e6' ? '#332c20' : theme.ink,
                textIndent: '1em',
                wordBreak: 'keep-all',
                whiteSpace: 'pre-wrap',
              }}
            >
              {para}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  background: 'rgba(255,252,244,0.72)',
  border: '1px solid #e6ddc9',
  borderRadius: 14,
  padding: '14px 16px 16px',
  marginBottom: 14,
  boxShadow: '0 10px 30px rgba(90,72,42,0.08)',
};
const cardLabel: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: '#8b7c63', marginBottom: 2 };
const rankBadge: React.CSSProperties = {
  width: 26,
  height: 26,
  flexShrink: 0,
  borderRadius: '50%',
  background: '#5c4a2e',
  color: '#fff',
  fontSize: 13,
  fontWeight: 700,
  display: 'grid',
  placeItems: 'center',
};
const iconBtn: React.CSSProperties = {
  width: 34,
  height: 34,
  flexShrink: 0,
  fontSize: 12,
  color: '#5c4a2e',
  background: 'rgba(255,255,255,0.9)',
  border: '1px solid #ddd2bb',
  borderRadius: 8,
  cursor: 'pointer',
};
const pickBtn: React.CSSProperties = {
  padding: '8px 13px',
  fontSize: 13,
  fontWeight: 700,
  color: '#fff',
  background: '#5c4a2e',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  flexShrink: 0,
};
