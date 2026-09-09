/**
 * 상담 회신을 **읽는 문서로** 그린다.
 *
 * 그전에는 회신이 편집상자에 날 텍스트로 있었다 — `##` 와 `**` 가 그대로 보이고,
 * 결론과 군더더기가 같은 크기로 놓였다. 「PPT 를 만든다는 생각으로」 라는 주문의
 * 요지는 **무게가 다른 것을 다르게 보이게 하라**는 것이다.
 *
 * 블록마다 옷을 달리 입힌다:
 *   한눈에   남색 바탕에 흰 글씨 — 세 줄만 읽어도 답이 서는 자리
 *   결론     금색 왼쪽 띠 — 본문에서 가장 무겁다
 *   근거     흰 카드 — 조문·판례가 길어도 눈이 쉬게
 *   실무유의 연한 카드
 *   질의요지 연한 카드
 *
 * **모든 블록을 접을 수 있고, 처음엔 모두 펼쳐 둔다.** 한때 질의요지만 접어 두었는데,
 * 어떤 것은 접히고 어떤 것은 안 접히는 이유를 화면만 보고는 알 수 없었다. 접는 것은
 * 읽는 사람이 정한다.
 *
 * 블록 가르기는 `lib/consultDoc.ts`(순수·테스트 있음)가 한다. 여기는 그리기만.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import Markdown from '../common/Markdown';
import { parseConsultDoc, type DocSection, type SectionKey } from '../../lib/consultDoc';

/**
 * 블록별 겉모습.
 *
 * 표시는 **글자 기호**로 통일한다 — 이모지를 섞으면 줄맞춤이 흐트러진다.
 * 질의요지는 한때 `?` 였는데 맨 물음표가 오타처럼 보여 `Q` 로 바꿨다(2026-09-10).
 */
const SKIN: Record<SectionKey, { icon: string; label: string; card: CSSProperties; head: CSSProperties }> = {
  한눈에: {
    icon: '⚡', label: '한눈에',
    card: { background: 'var(--navy)', border: '1px solid var(--navy)' },
    head: { color: '#E7D9AE' },
  },
  질의요지: {
    icon: 'Q', label: '질의요지',
    card: { background: 'var(--surface-2)', border: '1px solid var(--rule-2)' },
    head: { color: 'var(--ink-3)' },
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
    icon: '⚑', label: '실무 유의',
    card: { background: 'var(--surface-2)', border: '1px solid var(--rule-2)' },
    head: { color: 'var(--navy)' },
  },
  기타: {
    icon: '·', label: '',
    card: { background: 'var(--surface)', border: '1px solid var(--rule)' },
    head: { color: 'var(--navy)' },
  },
};

const headBase: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 7, width: '100%',
  fontSize: 'var(--fs-2)', fontWeight: 700, letterSpacing: '0.02em',
  background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
};

/** 접히는 카드 하나. 모든 블록이 이걸 쓴다 — 생김새만 다르고 동작은 같다. */
function Card({ skin, title, dark = false, children }: {
  skin: (typeof SKIN)[SectionKey]; title?: string; dark?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(true);   // 처음엔 모두 펼쳐 둔다
  return (
    <section
      style={{
        ...skin.card, borderRadius: 'var(--r-lg)', marginBottom: 10,
        padding: open ? '14px 18px' : '10px 18px',
      }}
    >
      <button type="button" onClick={() => setOpen((v) => !v)} style={{ ...headBase, ...skin.head, marginBottom: open ? 9 : 0 }}>
        <span aria-hidden style={{ opacity: 0.85 }}>{skin.icon}</span>
        {skin.label || title}
        <span style={{ marginLeft: 'auto', fontWeight: 400, color: dark ? 'rgba(255,255,255,.6)' : 'var(--ink-3)' }}>
          {open ? '접기 ▴' : '펼치기 ▾'}
        </span>
      </button>
      {open && children}
    </section>
  );
}

/** 「한눈에」 — 세 줄을 크게. 이 카드만 색을 뒤집어 맨 먼저 눈에 들어오게 한다. */
function Glance({ lines }: { lines: string[] }) {
  return (
    <Card skin={SKIN.한눈에} dark>
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
    </Card>
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

      {doc.sections.map((sec: DocSection, i) => (
        sec.key === '한눈에' ? null : (   // 위에서 이미 그렸다
          <Card key={i} skin={SKIN[sec.key]} title={sec.title}>
            <Markdown text={sec.body} />
          </Card>
        )
      ))}

      {(doc.applied || doc.footer) && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--rule-2)', fontSize: 'var(--fs-1)', color: 'var(--ink-3)', lineHeight: 1.7 }}>
          {doc.applied && <div style={{ fontWeight: 600 }}>{doc.applied}</div>}
          {doc.footer && <div style={{ whiteSpace: 'pre-wrap' }}>{doc.footer}</div>}
        </div>
      )}
    </div>
  );
}
