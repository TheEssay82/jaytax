// 외부 공유 상담기록 — 비로그인(외부) 열람 전용 페이지. /share/consult/:token 로 접근.
// 인증 게이트 밖(App.tsx)에서 렌더된다. get_shared_consult RPC(SECURITY DEFINER, 토큰 일치 시만)로 조회.
import { useEffect, useState } from 'react';
import { getSharedConsult, type SharedConsult as Shared } from '../lib/consultApi';
import { dtFmt } from '../lib/format';

export default function SharedConsult({ token }: { token: string }) {
  const [data, setData] = useState<Shared | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'notfound' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    getSharedConsult(token)
      .then((d) => {
        if (!alive) return;
        if (d) { setData(d); setState('ok'); }
        else setState('notfound');
      })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [token]);

  return (
    <div style={{ minHeight: '100vh', background: '#f5f2ec', padding: '24px 16px' }}>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, color: '#1A2B52' }}>
          <span style={{ fontWeight: 800, letterSpacing: 1 }}>JAY</span>
          <span style={{ fontSize: 12, color: '#8a8170' }}>세무회계 지원 · 상담 회신</span>
        </div>

        {state === 'loading' && <div style={card}>불러오는 중…</div>}
        {state === 'notfound' && (
          <div style={card}>
            <b>공유가 만료되었거나 잘못된 링크입니다.</b>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>작성자가 공유를 해제했을 수 있습니다.</div>
          </div>
        )}
        {state === 'error' && <div style={card}>일시적인 오류로 열람하지 못했습니다. 잠시 후 다시 시도해 주세요.</div>}

        {state === 'ok' && data && (
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              <span className="bdg" style={{ fontSize: 10, fontWeight: 700, color: data.status === 'final' ? '#1A6E3C' : '#8a5a00', background: data.status === 'final' ? '#e6f4ec' : '#fdf3e0', border: `1px solid ${data.status === 'final' ? '#bfe3cc' : '#f0dcb4'}`, borderRadius: 4, padding: '1px 7px' }}>
                {data.status === 'final' ? '확정' : '초안'}
              </span>
              <span style={{ fontSize: 18, fontWeight: 700, color: '#1A2B52' }}>{data.title || '(제목 없음)'}</span>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
              {data.authorName && `작성 ${data.authorName} · `}{dtFmt(data.createdAt)}
            </div>

            <Section label="질문 · 사실관계">
              <div style={body}>{data.question}</div>
            </Section>
            <Section label="회신">
              <div style={body}>{data.answerMd}</div>
            </Section>

            {data.citations.length > 0 && (
              <Section label={`근거 (${data.citations.length})`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.citations.map((c, i) => (
                    <div key={i} style={{ border: '1px solid #e4e0d8', borderRadius: 8, padding: '10px 12px', background: '#fffdf6' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                        <span className="bdg" style={{ fontSize: 10, color: c.type === '세법' ? '#1A2B52' : '#8a5a00' }}>{c.type}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#1A2B52' }}>{c.ref}</span>
                      </div>
                      <div style={{ fontSize: 12.5, lineHeight: 1.6, color: '#4b5563', whiteSpace: 'pre-wrap' }}>{c.text}</div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <div style={{ fontSize: 11, color: '#9aa0ad', marginTop: 14, lineHeight: 1.6, borderTop: '1px solid #ece8e0', paddingTop: 10 }}>
              본 회신은 참고용 AI 보조 자료이며, 회계기준 근거는 요지 정리본입니다. 최종 판단·서명은 담당 회계사·세무사가 합니다.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#1A2B52', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #e4e0d8', borderRadius: 12, padding: '20px 22px',
  boxShadow: '0 2px 10px rgba(0,0,0,.04)',
};
const body: React.CSSProperties = { fontSize: 13.5, lineHeight: 1.7, color: '#1f2937', whiteSpace: 'pre-wrap' };
