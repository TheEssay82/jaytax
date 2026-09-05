// 📌 개발 백로그 — 남은 일. 개발노트(끝난 일)와 짝이다.
//
// **최고관리자 전용**(menu.ts cap: manageUsers). 착수금 금액·내부 우선순위가 들어 있다.
// 내용은 src/lib/backlog.ts 에 있고, 고치면 배포가 필요하다(개발노트와 같다).
import { BACKLOG, BACKLOG_PLAN, BACKLOG_UI_PLAN, BACKLOG_WHY, BACKLOG_AS_OF, type Tone, type BacklogItem } from '../../lib/backlog';

/** 꼬리표 색 — 뜻을 나른다. due=시한/위험, gold=주목, plain=사실. */
const TAG_STYLE: Record<Tone, { background: string; color: string }> = {
  due: { background: '#F6E7E3', color: '#9B3527' },
  gold: { background: '#F3EAD6', color: 'var(--gold-ink)' },
  plain: { background: '#F1EFE9', color: 'var(--ink-3)' },
};

/**
 * 본문의 <b>강조</b>를 **엘리먼트로** 만든다.
 * dangerouslySetInnerHTML 을 쓰지 않는다 — 지금은 우리가 쓴 글이지만,
 * 나중에 이 자리에 DB 값이 들어오면 그대로 구멍이 된다.
 */
function bold(text: string): React.ReactNode[] {
  return text.split(/<b>|<\/b>/).map((part, i) =>
    i % 2 === 1
      ? <b key={i} style={{ color: 'var(--navy)' }}>{part}</b>
      : <span key={i}>{part}</span>);
}

function Item({ it }: { it: BacklogItem }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '24px 1fr', gap: '0 12px',
      padding: '13px 0', borderTop: '1px solid #EFECE4',
    }}>
      <div style={{
        fontSize: 'var(--fs-2)', fontWeight: 700, color: '#9AA0AC',
        lineHeight: '1.9', textAlign: 'center',
      }}>{it.mark}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--navy)', lineHeight: 1.5 }}>
          {it.title}
        </div>
        <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.75, marginTop: 3 }}>
          {bold(it.desc)}
        </div>
        {!!it.tags?.length && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {it.tags.map((t, i) => (
              <span key={i} style={{
                ...TAG_STYLE[t.tone ?? 'plain'],
                fontSize: 'var(--fs-1)', padding: '2px 7px', borderRadius: 3, whiteSpace: 'nowrap',
              }}>{t.label}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function BacklogTab() {
  const total = BACKLOG.reduce((s, x) => s + x.items.length, 0);

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        📌 개발 백로그
        <span style={{ fontWeight: 400, fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
          남은 {total}건 · {BACKLOG_AS_OF} 기준
        </span>
      </div>

      <div className="alert-i" style={{ fontSize: 'var(--fs-1)' }}>
        <b>남은 일</b>만 적습니다. <b>끝난 일</b>은 헤더의 버전 배지(📓 개발노트)에 있습니다.
        <br />· 금액·건수는 적을 때 실제로 세어 본 값입니다. 시간이 지나면 달라질 수 있습니다.
        <br />· 이 화면은 착수금 금액과 내부 우선순위를 담고 있어 <b>최고관리자만</b> 열립니다.
      </div>

      {BACKLOG.map((s) => (
        <div key={s.id} style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 'var(--fs-0)', letterSpacing: '.08em', fontWeight: 700,
              color: s.tone === 'due' ? '#9B3527' : '#A08A5B', textTransform: 'uppercase',
            }}>{s.eyebrow}</span>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--navy)' }}>{s.title}</span>
          </div>
          {s.note && (
            <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginTop: 3 }}>{s.note}</div>
          )}
          <div style={{ marginTop: 8, borderTop: '1px solid var(--rule)' }}>
            {s.items.map((it, i) => <Item key={i} it={it} />)}
          </div>
        </div>
      ))}

      {/* 권하는 순서 — 여기는 정말 순서라 번호를 매긴다. */}
      <div style={{
        marginTop: 22, background: '#F7F5EF', borderLeft: '3px solid var(--gold)',
        padding: '16px 18px',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy)', marginBottom: 10 }}>
          이 순서를 권합니다
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {BACKLOG_PLAN.map((p) => (
            <div key={p.step} style={{ display: 'grid', gridTemplateColumns: '26px 1fr', gap: 10 }}>
              <span style={{ fontSize: 'var(--fs-1)', fontWeight: 700, color: '#A9761F' }}>{p.step}</span>
              <span style={{ fontSize: 'var(--fs-2)', lineHeight: 1.6, color: 'var(--ink)' }}>
                <b style={{ color: 'var(--navy)' }}>{p.text}</b>
                {p.note && <span style={{ color: 'var(--ink-3)' }}> · {p.note}</span>}
              </span>
            </div>
          ))}
        </div>
        {/* 편의성·디자인은 **다른 줄기**다. 위 순서와 섞으면 무엇이 급한지 흐려진다. */}
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--rule)' }}>
          <div style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>
            쓰기 편하게 하는 일 — 위와 다른 줄기입니다
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {BACKLOG_UI_PLAN.map((p) => (
              <div key={p.step} style={{ display: 'grid', gridTemplateColumns: '26px 1fr', gap: 10 }}>
                <span style={{ fontSize: 'var(--fs-1)', fontWeight: 700, color: '#A9761F' }}>{p.step}</span>
                <span style={{ fontSize: 'var(--fs-2)', lineHeight: 1.6, color: 'var(--ink)' }}>
                  <b style={{ color: 'var(--navy)' }}>{p.text}</b>
                  {p.note && <span style={{ color: 'var(--ink-3)' }}> · {p.note}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div style={{
          marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--rule)',
          fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.75,
        }}>
          {bold(BACKLOG_WHY)}
        </div>
      </div>
    </div>
  );
}
