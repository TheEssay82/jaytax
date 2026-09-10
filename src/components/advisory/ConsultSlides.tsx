/**
 * 회신을 **슬라이드로 넘겨 본다** — 사무실에서 화면 하나 띄워 놓고 같이 보는 자리.
 *
 * 지금은 화면용이지만 **나중에 이미지·PDF 로 뽑을 것**을 염두에 두고 만든다.
 * 그래서 한 장을 `<Sheet>` 라는 **고정 비율(16:9) 한 부품**으로 그린다. 내보내기는
 * 이 부품을 화면 밖에서 그려 캡처하면 되므로, 그때 새로 만들 것이 없다.
 *
 * ── 디자인 규약 ────────────────────────────────────────────────────────────
 * 처음 만든 판은 「평평한 남색에 순백 글씨」였다. 그래서 슬라이드가 아니라 카드처럼
 * 보였다. 고친 원칙 넷:
 *
 *  1. **바탕에 깊이를 준다.** 단색 대신 비스듬한 그라데이션 + 왼쪽 위 금빛 번짐.
 *     눈이 붙잡을 곳이 생기고 큰 화면에서 허전하지 않다.
 *  2. **순백을 쓰지 않는다.** 남색 위의 #FFF 는 눈이 아프다. 따뜻한 상아색(#F2EFE8)을
 *     본문으로 쓰고, 보조·흐림은 그 색의 투명도만 낮춘다 — 색을 늘리지 않는다.
 *  3. **금색은 한 장에 한 곳.** 사방에 칠하면 강조가 강조 노릇을 못 한다. 블록 색은
 *     머리말 띠와 라벨에만 쓰고, 본문의 불릿 표시는 중립색으로 둔다.
 *  4. **판 윗머리(rail)를 고정한다.** 가는 선 + 블록 이름 + 쪽 표시. 장마다 같은 자리에
 *     같은 것이 있어야 「한 벌의 자료」로 읽힌다. 오른쪽 아래 흐린 큰 숫자는 편집디자인의
 *     상투 수단인데, 여백이 죽는 것을 막아 준다.
 *
 * 글꼴은 **더 받지 않는다.** 앱이 한글 웹폰트를 피하는 이유(첫 화면이 느려진다)가 여기서도
 * 같다. 대신 굵기·크기·자간·색으로 위계를 만든다. 숫자는 tabular-nums 로 자리를 맞춘다.
 *
 * 자르는 규칙은 `lib/consultSlides.ts`(순수·테스트 있음)에 있다. 여기는 그리기와 넘기기만.
 */
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { toSlides, type Slide } from '../../lib/consultSlides';
import type { SectionKey } from '../../lib/consultDoc';
import { useEscape } from '../../lib/useEscape';

/**
 * 슬라이드 팔레트 — **여기 한 곳**만 바꾸면 판 전체가 따라온다.
 * 나중에 인쇄용 밝은 판이 필요하면 이 값들만 갈아 끼우면 된다.
 */
const T = {
  ink: '#F2EFE8',                      // 본문 — 순백이 아닌 따뜻한 상아색
  ink2: 'rgba(242,239,232,0.66)',      // 보조
  ink3: 'rgba(242,239,232,0.40)',      // 흐림(쪽 표시·꼬리말)
  rule: 'rgba(242,239,232,0.14)',      // 가는 선
  gold: '#D9A94C',
  stage: 'linear-gradient(152deg, #1C2B4B 0%, #14213D 46%, #0C1626 100%)',
  glow: 'radial-gradient(68% 52% at 10% 4%, rgba(217,169,76,0.14), transparent 60%)',
};

/** 블록 색 — 남색 위에서 서로 부딪히지 않게 채도를 낮춘 셋. */
const ACCENT: Record<SectionKey, string> = {
  한눈에: T.gold,
  결론: T.gold,
  근거: '#9BB7E0',      // 흐린 청자
  실무유의: '#A9C9A8',   // 세이지
  질의요지: T.ink3,
  기타: T.ink3,
};

const num: CSSProperties = { fontVariantNumeric: 'tabular-nums' };
/** 판 너비 — 세로가 모자라면 세로에 맞춘다. 어느 창에서도 16:9 가 깨지지 않게. */
const SHEET_W = 'min(100%, calc((100vh - 168px) * 16 / 9))';

/**
 * 슬라이드 한 장.
 *
 * 글자 크기를 **판 너비에 비례**시킨다(cqw). 창을 키우면 글자만 커지고 줄바꿈은 그대로라,
 * 어느 화면에서 봐도 같은 그림이 된다 — 내보내기 때도 이 성질이 그대로 쓰인다.
 */
function Sheet({ n, rail, children, ghost = true }: { n: number; rail?: ReactNode; children: ReactNode; ghost?: boolean }) {
  return (
    <div
      style={{
        containerType: 'inline-size',
        width: SHEET_W,
        aspectRatio: '16 / 9',
        borderRadius: 14,
        overflow: 'hidden',
        position: 'relative',
        background: T.stage,
        boxShadow: '0 24px 70px rgba(0,0,0,.5), inset 0 0 0 1px rgba(242,239,232,.07)',
      }}
    >
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: T.glow }} />
      {/* 오른쪽 아래 흐린 큰 숫자 — 여백이 죽지 않게 붙잡아 주는 편집디자인의 상투 수단.
          표지에는 두지 않는다(제 나름의 짜임이 이미 있다). */}
      {ghost && (
        <span
          aria-hidden
          style={{
            ...num, position: 'absolute', right: '3.2cqw', bottom: '-2.6cqw',
            fontSize: '12cqw', fontWeight: 800, lineHeight: 1, letterSpacing: '-0.05em',
            color: 'rgba(242,239,232,0.028)',
          }}
        >
          {String(n).padStart(2, '0')}
        </span>
      )}

      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', padding: '6cqw 7cqw' }}>
        {rail}
        {children}
      </div>
    </div>
  );
}

/** 판 윗머리 — 색 띠 · 블록 이름 · 쪽 표시. 장마다 같은 자리에 있어야 한 벌로 읽힌다. */
function Rail({ label, accent, note }: { label: string; accent: string; note?: string }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: '1.3cqw',
        paddingBottom: '1.5cqw', marginBottom: '4.2cqw', borderBottom: `1px solid ${T.rule}`,
      }}
    >
      <span aria-hidden style={{ width: '2.4cqw', height: '0.3cqw', background: accent, borderRadius: 1 }} />
      <span style={{ fontSize: '1.35cqw', fontWeight: 700, letterSpacing: '0.16em', color: accent }}>{label}</span>
      {note && <span style={{ ...num, marginLeft: 'auto', fontSize: '1.25cqw', color: T.ink3 }}>{note}</span>}
    </div>
  );
}

function One({ s, n }: { s: Slide; n: number }) {
  if (s.kind === 'cover') {
    return (
      <Sheet n={n} ghost={false}>
        <div style={{ margin: 'auto 0', display: 'flex', flexDirection: 'column' }}>
          <span aria-hidden style={{ width: '7cqw', height: '0.4cqw', background: T.gold, borderRadius: 1, marginBottom: '3.2cqw' }} />
          <h1 style={{ margin: 0, fontSize: '5cqw', fontWeight: 800, color: T.ink, lineHeight: 1.28, letterSpacing: '-0.022em' }}>
            {s.title}
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '1.4cqw', paddingTop: '2cqw', borderTop: `1px solid ${T.rule}` }}>
          {/* 자간은 한글에 조금만 — 넉넉히 줬더니 「인 덕 회 계 법 인」처럼 흩어졌다. */}
          <span style={{ fontSize: '1.5cqw', fontWeight: 700, letterSpacing: '0.06em', color: T.gold }}>인덕회계법인</span>
          {s.meta && <span style={{ ...num, marginLeft: 'auto', fontSize: '1.35cqw', color: T.ink3 }}>{s.meta}</span>}
        </div>
      </Sheet>
    );
  }

  if (s.kind === 'glance') {
    return (
      <Sheet n={n} rail={<Rail label="한눈에" accent={T.gold} />}>
        <ol style={{ margin: 'auto 0', padding: 0, listStyle: 'none' }}>
          {s.lines.map((t, i) => (
            <li
              key={i}
              style={{
                display: 'flex', gap: '2.4cqw', alignItems: 'baseline',
                padding: '2.2cqw 0',
                borderTop: i ? `1px solid ${T.rule}` : undefined,
              }}
            >
              <span style={{ ...num, fontSize: '3.2cqw', fontWeight: 800, color: T.gold, lineHeight: 1, minWidth: '3.6cqw', letterSpacing: '-0.02em' }}>
                {i + 1}
              </span>
              <span style={{ fontSize: '2.45cqw', color: T.ink, lineHeight: 1.52, fontWeight: 500, letterSpacing: '-0.012em' }}>{t}</span>
            </li>
          ))}
        </ol>
      </Sheet>
    );
  }

  if (s.kind === 'bullets') {
    const accent = ACCENT[s.accent];
    return (
      <Sheet n={n} rail={<Rail label={s.label} accent={accent} note={s.parts > 1 ? `${s.part} / ${s.parts}` : undefined} />}>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '2.4cqw', overflow: 'hidden' }}>
          {s.items.map((b, i) => (
            <li key={i} style={{ display: 'flex', gap: '1.8cqw' }}>
              {/* 표시는 중립색 작은 마름모 — 금색·블록색은 윗머리에서 이미 한 번 썼다. */}
              <span
                aria-hidden
                style={{ flex: '0 0 auto', width: '0.55cqw', height: '0.55cqw', background: T.ink3, transform: 'translateY(1.05cqw) rotate(45deg)' }}
              />
              <span style={{ lineHeight: 1.55 }}>
                <b style={{ fontSize: '2.05cqw', color: T.ink, fontWeight: 700, letterSpacing: '-0.012em' }}>{b.lead}</b>
                {b.rest && <span style={{ fontSize: '1.68cqw', color: T.ink2 }}>{' — '}{b.rest}</span>}
              </span>
            </li>
          ))}
        </ul>
      </Sheet>
    );
  }

  if (s.kind === 'prose') {
    const paras = s.text.replace(/\*\*/g, '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    return (
      <Sheet n={n} rail={<Rail label={s.label} accent={ACCENT[s.accent]} note={s.parts > 1 ? `${s.part} / ${s.parts}` : undefined} />}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.7cqw', overflow: 'hidden' }}>
          {paras.map((p, i) => (
            <p key={i} style={{ margin: 0, fontSize: '1.95cqw', color: T.ink2, lineHeight: 1.72, whiteSpace: 'pre-wrap', letterSpacing: '-0.008em' }}>
              {p}
            </p>
          ))}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet n={n} rail={<Rail label="맺음" accent={T.ink3} />}>
      <div style={{ margin: 'auto 0', display: 'flex', flexDirection: 'column', gap: '2.4cqw' }}>
        {s.applied && (
          <div style={{ fontSize: '1.9cqw', color: T.gold, fontWeight: 700, letterSpacing: '-0.01em' }}>{s.applied}</div>
        )}
        {s.footer && (
          <div style={{ fontSize: '1.6cqw', color: T.ink3, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{s.footer}</div>
        )}
      </div>
    </Sheet>
  );
}

export default function ConsultSlides({ md, meta = '', onClose }: { md: string; meta?: string; onClose: () => void }) {
  const slides = toSlides(md, meta);
  const [i, setI] = useState(0);
  const last = slides.length - 1;
  useEscape(onClose);

  const go = useCallback((d: number) => setI((v) => Math.min(last, Math.max(0, v + d))), [last]);

  // 화살표·스페이스로 넘긴다. 발표하며 리모컨을 쓰는 사람이 있어 PageUp/PageDown 도
  // 받는다(무선 프리젠터가 그 키를 보낸다).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', ' ', 'PageDown'].includes(e.key)) { e.preventDefault(); go(1); }
      else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); go(-1); }
      else if (e.key === 'Home') { e.preventDefault(); setI(0); }
      else if (e.key === 'End') { e.preventDefault(); setI(last); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, last]);

  if (!slides.length) return null;

  // 판 밖의 것들은 **눈에 띄지 않게** — 보는 사람이 슬라이드를 보게 한다.
  const chrome: CSSProperties = {
    background: 'transparent', border: `1px solid ${T.rule}`, color: T.ink2,
    borderRadius: 7, padding: '5px 11px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
  };

  return (
    <div
      className="modal-overlay"
      style={{ zIndex: 9500, background: 'rgba(7,11,20,.94)', flexDirection: 'column', gap: 13 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="회신 슬라이드"
    >
      <div style={{ display: 'flex', width: SHEET_W, alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11.5, color: T.ink3, letterSpacing: '0.02em' }}>
          ← → · 스페이스로 넘기고 ESC 로 닫습니다
        </span>
        <button style={{ ...chrome, marginLeft: 'auto' }} onClick={(e) => { e.stopPropagation(); onClose(); }}>닫기</button>
      </div>

      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
        <One s={slides[i]} n={i + 1} />
      </div>

      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
        <button style={chrome} onClick={() => go(-1)} disabled={i === 0}>◀</button>
        <span style={{ display: 'flex', gap: 6 }}>
          {slides.map((_, k) => (
            <button
              key={k}
              onClick={() => setI(k)}
              aria-label={`${k + 1}번째 장`}
              style={{
                width: k === i ? 18 : 7, height: 7, padding: 0, borderRadius: 4, cursor: 'pointer',
                border: 'none', background: k === i ? T.gold : 'rgba(242,239,232,.24)',
                transition: 'width .18s ease, background .18s ease',
              }}
            />
          ))}
        </span>
        <button style={chrome} onClick={() => go(1)} disabled={i === last}>▶</button>
        <span style={{ ...num, fontSize: 12, color: T.ink3, minWidth: 52, textAlign: 'right' }}>{i + 1} / {slides.length}</span>
      </div>
    </div>
  );
}
