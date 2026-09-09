/**
 * 상담 회신을 **읽는 문서로** 그린다.
 *
 * 그전에는 회신이 편집상자에 날 텍스트로 있었다 — `##` 와 `**` 가 그대로 보이고,
 * 결론과 군더더기가 같은 크기로 놓였다. 「PPT 를 만든다는 생각으로」 라는 주문의
 * 요지는 **무게가 다른 것을 다르게 보이게 하라**는 것이다.
 *
 * 그래서 블록마다 옷을 달리 입힌다:
 *   한눈에   남색 바탕에 흰 글씨 — 세 줄만 읽어도 답이 서는 자리
 *   결론     금색 왼쪽 띠 — 본문에서 가장 무겁다
 *   근거     흰 카드 — 조문·판례가 길어도 눈이 쉬게
 *   실무유의 연한 카드
 *   질의요지 접어 둔다 — 내가 쓴 질문이라 다시 읽을 일이 적다
 *
 * 블록 가르기는 `lib/consultDoc.ts`(순수·테스트 있음)가 한다. 여기는 그리기만.
 */
import { useState, type CSSProperties } from 'react';
import Markdown from '../common/Markdown';
import { parseConsultDoc, type DocSection, type SectionKey } from '../../lib/consultDoc';

/** 블록별 겉모습. 여기 없는 것(기타)은 수수한 카드로. */
const SKIN: Record<SectionKey, { icon: string; label: string; card: CSSProperties; head: CSSProperties }> = {
  한눈에: {
    icon: '⚡', label: '한눈에',
    card: { background: 'var(--navy)', border: '1px solid var(--navy)', color: '#fff' },
    head: { color: '#E7D9AE' },
  },
  결론: {
    icon: '✔', label: '결론',
    card: { background: '#FFFDF7', border: '1px solid #EADFBF', borderLeft: '5px solid var(--gold)' },
    head: { color: 'var(--gold-ink)' },
  },
  근거: {
    icon: '§', label: '근거',
    card: { background: 'var(--surface)', border: '1px solid var(--rule)' },
    head: { color: 'var(--navy)' },
  },
  실무유의: {
    icon: '☑', label: '실무 유의',
    card: { background: 'var(--surface-2)', border: '1px solid var(--rule-2)' },
    head: { color: 'var(--navy)' },
  },
  질의요지: {
    icon: '?', label: '질의요지',
    card: { background: 'var(--surface-2)', border: '1px solid var(--rule-2)' },
    head: { color: 'var(--ink-3)' },
  },
  기타: {
    icon: '·', label: '',
    card: { background: 'var(--surface)', border: '1px solid var(--rule)' },
    head: { color: 'var(--navy)' },
  },
};

const cardBase: CSSProperties = { borderRadius: 'var(--r-lg)', padding: '14px 18px', marginBottom: 10 };
const headBase: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  fontSize: 'var(--fs-2)', fontWeight: 700, letterSpacing: '0.02em', marginBottom: 8,
};

/** 「한눈에」 — 세 줄을 크게. 이 카드만 색을 뒤집어 맨 먼저 눈에 들어오게 한다. */
function Glance({ lines }: { lines: string[] }) {
  const s = SKIN.한눈에;
  return (
    <section style={{ ...cardBase, ...s.card, padding: '16px 20px' }}>
      <div style={{ ...headBase, ...s.head }}>{s.icon} {s.label}</div>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 9 }}>
        {lines.map((t, i) => (
          <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 14.5, lineHeight: 1.6 }}>
            <span
              aria-hidden
              style={{
                flex: '0 0 auto', width: 19, height: 19, borderRadius: '50%',
                background: 'rgba(255,255,255,.16)', color: '#E7D9AE',
                fontSize: 11, fontWeight: 700, display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center', transform: 'translateY(1px)',
              }}
            >
              {i + 1}
            </span>
            <span style={{ color: '#fff', fontWeight: 500 }}>{t}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** 접히는 블록 — 질의요지처럼 다시 읽을 일이 적은 것. */
function Foldable({ sec }: { sec: DocSection }) {
  const [open, setOpen] = useState(false);
  const s = SKIN[sec.key];
  return (
    <section style={{ ...cardBase, ...s.card, padding: open ? '14px 18px' : '9px 18px' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          ...headBase, ...s.head, marginBottom: open ? 8 : 0,
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          fontFamily: 'inherit', width: '100%',
        }}
      >
        {s.icon} {s.label || sec.title}
        <span style={{ marginLeft: 'auto', fontWeight: 400, color: 'var(--ink-3)' }}>{open ? '접기 ▴' : '펼치기 ▾'}</span>
      </button>
      {open && <Markdown text={sec.body} />}
    </section>
  );
}

function Plain({ sec }: { sec: DocSection }) {
  const s = SKIN[sec.key];
  return (
    <section style={{ ...cardBase, ...s.card }}>
      <div style={{ ...headBase, ...s.head }}>{s.icon} {s.label || sec.title}</div>
      <Markdown text={sec.body} />
    </section>
  );
}

export default function ConsultDoc({ md, showTitle = true }: { md: string; showTitle?: boolean }) {
  const doc = parseConsultDoc(md);
  return (
    <div>
      {showTitle && doc.title && (
        <h2 style={{ fontSize: 'var(--fs-5)', fontWeight: 800, color: 'var(--navy)', lineHeight: 1.4, margin: '2px 0 14px', letterSpacing: '-0.01em' }}>
          {doc.title}
        </h2>
      )}

      {doc.summary.length > 0 && <Glance lines={doc.summary} />}

      {doc.sections.map((sec, i) => {
        if (sec.key === '한눈에') return null;          // 위에서 이미 그렸다
        if (sec.key === '질의요지') return <Foldable key={i} sec={sec} />;
        return <Plain key={i} sec={sec} />;
      })}

      {(doc.applied || doc.footer) && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--rule-2)', fontSize: 'var(--fs-1)', color: 'var(--ink-3)', lineHeight: 1.7 }}>
          {doc.applied && <div style={{ fontWeight: 600 }}>{doc.applied}</div>}
          {doc.footer && <div style={{ whiteSpace: 'pre-wrap' }}>{doc.footer}</div>}
        </div>
      )}
    </div>
  );
}
