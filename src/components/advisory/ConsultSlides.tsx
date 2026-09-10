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
import { createContext, useCallback, useContext, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { toSlides, type Slide } from '../../lib/consultSlides';
import type { SectionKey } from '../../lib/consultDoc';
import { useEscape } from '../../lib/useEscape';

/**
 * 슬라이드 팔레트 — 판을 이루는 값이 **여기 한 곳**에 다 있다.
 *
 * 바탕색은 취향이 갈리는 자리라 **고를 수 있게** 두었다. 고른 것은 브라우저에 적어 두므로
 * 한 번만 정하면 된다. 나중에 이미지·PDF 로 뽑을 때는 「종이」가 인쇄에 맞다 —
 * 어두운 판을 인쇄하면 잉크만 먹고 보기도 나쁘다.
 */
interface Palette {
  name: string;
  ink: string; ink2: string; ink3: string; rule: string;
  gold: string;
  stage: string; glow: string;
  accent: Record<SectionKey, string>;
  /** 판 밖(어두운 막) 색 — 바탕이 밝으면 막도 덜 어둡게. */
  veil: string;
}

const DARK_ACCENT = { 근거: '#9BB7E0', 실무유의: '#A9C9A8' };   // 흐린 청자 · 세이지
const LIGHT_ACCENT = { 근거: '#3D6098', 실무유의: '#3E7A55' };

const THEMES: Record<string, Palette> = {
  // 남색 — 사무실 화면에 띄워 놓고 같이 볼 때. 글자가 뜨는 느낌이 있다.
  밤: {
    name: '밤',
    ink: '#F2EFE8', ink2: 'rgba(242,239,232,0.66)', ink3: 'rgba(242,239,232,0.40)',
    rule: 'rgba(242,239,232,0.14)', gold: '#D9A94C',
    stage: 'linear-gradient(152deg, #1C2B4B 0%, #14213D 46%, #0C1626 100%)',
    glow: 'radial-gradient(68% 52% at 10% 4%, rgba(217,169,76,0.14), transparent 60%)',
    accent: { 한눈에: '#D9A94C', 결론: '#D9A94C', ...DARK_ACCENT, 질의요지: 'rgba(242,239,232,0.40)', 기타: 'rgba(242,239,232,0.40)' },
    veil: 'rgba(7,11,20,.94)',
  },
  // 종이 — 앱의 베이지와 같은 결. 밝은 회의실·인쇄에 맞다.
  종이: {
    name: '종이',
    ink: '#1A2B52', ink2: 'rgba(26,43,82,0.74)', ink3: 'rgba(26,43,82,0.44)',
    rule: 'rgba(26,43,82,0.14)', gold: '#8A6218',
    stage: 'linear-gradient(155deg, #FBF9F4 0%, #F3EFE6 55%, #ECE6D9 100%)',
    glow: 'radial-gradient(64% 50% at 8% 2%, rgba(200,150,60,0.10), transparent 62%)',
    accent: { 한눈에: '#8A6218', 결론: '#8A6218', ...LIGHT_ACCENT, 질의요지: 'rgba(26,43,82,0.44)', 기타: 'rgba(26,43,82,0.44)' },
    veil: 'rgba(28,26,22,.86)',
  },
  // 먹 — 색을 빼고 글자만 남긴 판. 자료가 빽빽할 때 가장 조용하다.
  먹: {
    name: '먹',
    ink: '#EDEAE3', ink2: 'rgba(237,234,227,0.62)', ink3: 'rgba(237,234,227,0.38)',
    rule: 'rgba(237,234,227,0.13)', gold: '#C9A15A',
    stage: 'linear-gradient(150deg, #24252A 0%, #1B1C20 50%, #121316 100%)',
    glow: 'radial-gradient(62% 48% at 12% 4%, rgba(201,161,90,0.09), transparent 60%)',
    accent: { 한눈에: '#C9A15A', 결론: '#C9A15A', 근거: '#94A9C4', 실무유의: '#9FBCA2', 질의요지: 'rgba(237,234,227,0.38)', 기타: 'rgba(237,234,227,0.38)' },
    veil: 'rgba(10,10,12,.94)',
  },
};

const THEME_KEY = 'jaytax.slideTheme';
const THEME_NAMES = Object.keys(THEMES);

/** 저장해 둔 바탕. 저장소가 막혀 있어도(사생활 보호 창 등) 무너지지 않는다. */
function savedTheme(): string {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v && THEMES[v] ? v : '밤';
  } catch { return '밤'; }
}

/** 고른 팔레트를 아래로 흘려보낸다 — 부품마다 인자로 넘기면 코드가 지저분해진다. */
const PaletteCtx = createContext<Palette>(THEMES.밤);
const useT = () => useContext(PaletteCtx);

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
  const T = useT();
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
        boxShadow: `0 24px 70px rgba(0,0,0,.45), inset 0 0 0 1px ${T.rule}`,
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
            color: T.ink3,
            opacity: 0.075,
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
  const T = useT();
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
  const T = useT();
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
    const accent = T.accent[s.accent];
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
      <Sheet n={n} rail={<Rail label={s.label} accent={T.accent[s.accent]} note={s.parts > 1 ? `${s.part} / ${s.parts}` : undefined} />}>
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
  const [themeName, setThemeName] = useState(savedTheme);
  const last = slides.length - 1;
  useEscape(onClose);

  const T = THEMES[themeName] ?? THEMES.밤;

  /** 바탕을 바꾸고 적어 둔다 — 한 번 정하면 다음에도 그대로 뜬다. */
  function pickTheme(name: string) {
    setThemeName(name);
    try { localStorage.setItem(THEME_KEY, name); } catch { /* 저장소가 막혀 있어도 보는 데는 지장 없다 */ }
  }

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
      style={{ zIndex: 9500, background: T.veil, flexDirection: 'column', gap: 13 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="회신 슬라이드"
    >
      <div style={{ display: 'flex', width: SHEET_W, alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11.5, color: T.ink3, letterSpacing: '0.02em' }}>
          ← → · 스페이스로 넘기고 ESC 로 닫습니다
        </span>
        {/* 바탕 고르기 — 취향이 갈리는 자리라 정해 주지 않고 고르게 둔다. */}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
          {THEME_NAMES.map((name) => (
            <button
              key={name}
              onClick={() => pickTheme(name)}
              aria-pressed={name === themeName}
              style={{
                ...chrome,
                padding: '5px 10px',
                color: name === themeName ? T.gold : T.ink3,
                borderColor: name === themeName ? T.gold : T.rule,
              }}
            >
              {name}
            </button>
          ))}
        </span>
        <button style={chrome} onClick={(e) => { e.stopPropagation(); onClose(); }}>닫기</button>
      </div>

      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
        <PaletteCtx.Provider value={T}><One s={slides[i]} n={i + 1} /></PaletteCtx.Provider>
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
                border: 'none', background: k === i ? T.gold : T.rule,
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
