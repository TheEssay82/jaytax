/**
 * 회신을 **슬라이드로 넘겨 본다** — 사무실에서 화면 하나 띄워 놓고 같이 보는 자리.
 *
 * 지금은 화면용이지만 **나중에 이미지·PDF 로 뽑을 것**을 염두에 두고 만든다.
 * 그래서 한 장을 `<Sheet>` 라는 **고정 비율(16:9) 한 부품**으로 그린다. 내보내기는
 * 이 부품을 화면 밖에서 그려 캡처하면 되므로, 그때 새로 만들 것이 없다.
 *
 * 자르는 규칙은 `lib/consultSlides.ts`(순수·테스트 있음)에 있다. 여기는 그리기와 넘기기만.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toSlides, type Slide } from '../../lib/consultSlides';
import type { SectionKey } from '../../lib/consultDoc';
import { useEscape } from '../../lib/useEscape';

/** 블록별 강조색 — 문서 화면(ConsultDoc)과 같은 뜻을 같은 색으로. */
const ACCENT: Record<SectionKey, string> = {
  한눈에: 'var(--gold)',
  결론: 'var(--gold)',
  근거: '#7FA3D9',
  실무유의: '#8FBF9F',
  질의요지: 'var(--ink-4)',
  기타: 'var(--ink-4)',
};

/**
 * 슬라이드 한 장.
 *
 * **16:9 를 지킨다.** 창 크기에 따라 글자만 커지고 판은 그대로라야 어느 화면에서 봐도
 * 같은 그림이 된다. 글자 크기는 판 너비에 비례시킨다(cqw) — 그래야 확대·축소해도
 * 줄바꿈이 그대로다.
 */
function Sheet({ children, foot }: { children: ReactNode; foot?: ReactNode }) {
  return (
    <div
      style={{
        containerType: 'inline-size',
        width: 'min(100%, calc((100vh - 150px) * 16 / 9))',
        aspectRatio: '16 / 9',
        background: 'var(--navy)',
        borderRadius: 'var(--r-lg)',
        boxShadow: '0 18px 60px rgba(0,0,0,.45)',
        padding: '5cqw 6cqw',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', position: 'relative',
      }}
    >
      {children}
      {foot && (
        <div style={{ position: 'absolute', right: '6cqw', bottom: '3.4cqw', fontSize: '1.5cqw', color: 'rgba(255,255,255,.45)' }}>
          {foot}
        </div>
      )}
    </div>
  );
}

/** 블록 제목 줄 — 색 막대 + 라벨. 어느 장이 무엇인지 한눈에. */
function Head({ label, accent }: { label: string; accent: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1.6cqw', marginBottom: '3.4cqw' }}>
      <span style={{ width: '0.7cqw', height: '2.6cqw', background: accent, borderRadius: 2 }} />
      <span style={{ fontSize: '2cqw', fontWeight: 700, letterSpacing: '0.08em', color: accent }}>{label}</span>
    </div>
  );
}

function One({ s }: { s: Slide }) {
  if (s.kind === 'cover') {
    return (
      <Sheet>
        <div style={{ margin: 'auto 0', display: 'flex', flexDirection: 'column', gap: '2.4cqw' }}>
          {/* 자간은 한글에 조금만 준다 — 0.22em 을 줬더니 「인 덕 회 계 법 인」처럼 흩어졌다. */}
          <span style={{ fontSize: '1.7cqw', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--gold)' }}>
            인덕회계법인
          </span>
          <h1 style={{ margin: 0, fontSize: '4.2cqw', fontWeight: 800, color: '#fff', lineHeight: 1.35, letterSpacing: '-0.01em' }}>
            {s.title}
          </h1>
          {s.meta && <span style={{ fontSize: '1.7cqw', color: 'rgba(255,255,255,.55)' }}>{s.meta}</span>}
        </div>
      </Sheet>
    );
  }

  if (s.kind === 'glance') {
    return (
      <Sheet>
        <Head label="한눈에" accent="var(--gold)" />
        <ol style={{ margin: 'auto 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '3cqw' }}>
          {s.lines.map((t, i) => (
            <li key={i} style={{ display: 'flex', gap: '2.2cqw', alignItems: 'baseline' }}>
              <span style={{ fontSize: '3.4cqw', fontWeight: 800, color: 'var(--gold)', lineHeight: 1, minWidth: '3.4cqw' }}>
                {i + 1}
              </span>
              <span style={{ fontSize: '2.7cqw', color: '#fff', lineHeight: 1.5, fontWeight: 500 }}>{t}</span>
            </li>
          ))}
        </ol>
      </Sheet>
    );
  }

  if (s.kind === 'bullets') {
    const accent = ACCENT[s.accent];
    return (
      <Sheet foot={s.parts > 1 ? `${s.part} / ${s.parts}` : undefined}>
        <Head label={s.label} accent={accent} />
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '2.2cqw', overflow: 'hidden' }}>
          {s.items.map((b, i) => (
            <li key={i} style={{ display: 'flex', gap: '1.6cqw', alignItems: 'baseline' }}>
              <span aria-hidden style={{ color: accent, fontSize: '1.6cqw', transform: 'translateY(-0.3cqw)' }}>●</span>
              <span style={{ lineHeight: 1.5 }}>
                <b style={{ fontSize: '2.1cqw', color: '#fff', fontWeight: 700 }}>{b.lead}</b>
                {b.rest && (
                  <span style={{ fontSize: '1.75cqw', color: 'rgba(255,255,255,.72)' }}> — {b.rest}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Sheet>
    );
  }

  if (s.kind === 'prose') {
    return (
      <Sheet foot={s.parts > 1 ? `${s.part} / ${s.parts}` : undefined}>
        <Head label={s.label} accent={ACCENT[s.accent]} />
        <div style={{ fontSize: '2cqw', color: 'rgba(255,255,255,.9)', lineHeight: 1.65, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>
          {s.text.replace(/\*\*/g, '')}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet>
      <div style={{ margin: 'auto 0', display: 'flex', flexDirection: 'column', gap: '2.2cqw' }}>
        {s.applied && <div style={{ fontSize: '2cqw', color: 'var(--gold)', fontWeight: 700 }}>{s.applied}</div>}
        {s.footer && (
          <div style={{ fontSize: '1.7cqw', color: 'rgba(255,255,255,.6)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
            {s.footer}
          </div>
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

  // 화살표·스페이스·PageUp/Down 으로 넘긴다. 발표하며 리모컨을 쓰는 사람이 있어
  // PageUp/PageDown 도 받는다(무선 프리젠터가 그 키를 보낸다).
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

  return (
    <div
      className="modal-overlay"
      style={{ zIndex: 9500, background: 'rgba(12,16,28,.92)', flexDirection: 'column', gap: 14 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="회신 슬라이드"
    >
      <div style={{ display: 'flex', width: 'min(100%, calc((100vh - 150px) * 16 / 9))', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 'var(--fs-2)', color: 'rgba(255,255,255,.5)' }}>
          ← → · 스페이스로 넘기고 ESC 로 닫습니다
        </span>
        <button className="btn-s" style={{ marginLeft: 'auto' }} onClick={(e) => { e.stopPropagation(); onClose(); }}>닫기</button>
      </div>

      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
        <One s={slides[i]} />
      </div>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'rgba(255,255,255,.75)' }}
      >
        <button className="btn-s" onClick={() => go(-1)} disabled={i === 0}>◀</button>
        <span style={{ display: 'flex', gap: 5 }}>
          {slides.map((_, n) => (
            <button
              key={n}
              onClick={() => setI(n)}
              aria-label={`${n + 1}번째 장`}
              style={{
                width: 8, height: 8, padding: 0, borderRadius: '50%', cursor: 'pointer',
                border: 'none', background: n === i ? 'var(--gold)' : 'rgba(255,255,255,.28)',
              }}
            />
          ))}
        </span>
        <button className="btn-s" onClick={() => go(1)} disabled={i === last}>▶</button>
        <span style={{ fontSize: 'var(--fs-2)', minWidth: 54, textAlign: 'right' }}>{i + 1} / {slides.length}</span>
      </div>
    </div>
  );
}
