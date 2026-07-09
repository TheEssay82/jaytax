// 외부 공유 상담기록 — 비로그인(외부) 열람 전용 페이지. /share/consult/:token 로 접근.
// 인증 게이트 밖(App.tsx)에서 렌더된다. get_shared_consult RPC(SECURITY DEFINER, 토큰 일치 시만)로 조회.
import { useEffect, useState } from 'react';
import { getSharedConsult, type SharedConsult as Shared } from '../lib/consultApi';
import { dtFmt } from '../lib/format';
import Markdown from './common/Markdown';

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: data.status === 'final' ? '#1A6E3C' : '#8a5a00', background: data.status === 'final' ? '#e6f4ec' : '#fdf3e0', border: `1px solid ${data.status === 'final' ? '#bfe3cc' : '#f0dcb4'}`, borderRadius: 4, padding: '2px 8px' }}>
                {data.status === 'final' ? '확정' : '초안'}
              </span>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#1A2B52', letterSpacing: '-0.01em' }}>{data.title || '(제목 없음)'}</span>
            </div>
            <div style={{ fontSize: 12, color: '#9aa0ad', marginBottom: 20 }}>
              {data.authorName && `작성 ${data.authorName} · `}{dtFmt(data.createdAt)}
            </div>

            <Section label="질문 · 사실관계">
              <div style={questionBox}>{data.question}</div>
            </Section>

            <Section label="회신">
              <Markdown text={data.answerMd} boxed hideFirstH1 />
            </Section>

            {data.citations.length > 0 && (
              <Section label={`근거 (${data.citations.length})`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {data.citations.map((c, i) => (
                    <div key={i} style={citeBox}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 5, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: c.type === '세법' ? '#1A2B52' : '#8a5a00', background: c.type === '세법' ? '#eef2fb' : '#fbf3e3', border: '1px solid ' + (c.type === '세법' ? '#d4ddf0' : '#efe0c4'), borderRadius: 4, padding: '1px 6px' }}>{c.type}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1A2B52' }}>{c.ref}</span>
                      </div>
                      <div style={{ fontSize: 12.5, lineHeight: 1.7, color: '#5a6270', whiteSpace: 'pre-wrap' }}>{c.text}</div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <div style={{ fontSize: 11, color: '#9aa0ad', marginTop: 20, lineHeight: 1.6, borderTop: '1px solid #ece8e0', paddingTop: 12 }}>
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
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#a89b80', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
}

const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #e7e2d8', borderRadius: 14, padding: '28px 30px',
  boxShadow: '0 4px 18px rgba(26,43,82,.06)',
};
const questionBox: React.CSSProperties = {
  fontSize: 13.5, lineHeight: 1.75, color: '#3a4150', whiteSpace: 'pre-wrap',
  background: '#f8f6f1', border: '1px solid #ece7dd', borderRadius: 10, padding: '13px 15px',
};
const citeBox: React.CSSProperties = {
  border: '1px solid #ece7dd', borderLeft: '3px solid #c9b88a', borderRadius: '4px 8px 8px 4px', padding: '11px 14px', background: '#fffdf8',
};
