// 전자세금계산서 수신 이메일 고르기.
//
// 세금계산서가 엉뚱한 곳으로 가면 그 자체로 사고다. 그래서 **비워 둘 수 없게** 하고,
// 새로 치기보다 **예전에 실제로 보냈던 곳**을 고르게 한다(엑셀 발행체크에서 모은 214개).
// 받는 사람이 둘 이상인 곳이 흔하므로 **여러 개를 고를 수 있다**.
//
// 고른 것을 거래처정보(biz_place.tax_emails)에 남길지는 사람이 정한다.
// 이미 적혀 있는 것과 다르면 **대체할지 더할지**를 반드시 묻는다 — 함부로 지우면 지난 수신처를 잃는다.
import { useEffect, useState } from 'react';
import {
  listEmailCandidates, getPlaceTaxEmails, isEmail, type EmailCandidate,
} from '../../lib/taxEmailApi';

export interface EmailChoice {
  /** 고른 이메일들. */
  emails: string[];
  /** 거래처정보에 반영할지. */
  saveToPlace: boolean;
  /** 반영한다면 대체인지 추가인지. */
  mode: 'replace' | 'append';
}

export function TaxEmailPicker({ entityId, placeId, clientName, value, onChange }: {
  entityId: string | null;
  placeId: string | null;
  clientName: string;
  value: EmailChoice;
  onChange: (v: EmailChoice) => void;
}) {
  const [cands, setCands] = useState<EmailCandidate[]>([]);
  const [placeEmails, setPlaceEmails] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!entityId && !clientName) { setCands([]); return; }
    let alive = true;
    setLoading(true);
    void listEmailCandidates(entityId, placeId, clientName)
      .then((c) => { if (alive) setCands(c); })
      .catch(() => { if (alive) setCands([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [entityId, placeId, clientName]);

  useEffect(() => {
    if (!placeId) { setPlaceEmails([]); return; }
    void getPlaceTaxEmails(placeId).then(setPlaceEmails).catch(() => setPlaceEmails([]));
  }, [placeId]);

  const picked = new Set(value.emails.map((e) => e.toLowerCase()));
  const toggle = (e: string) => {
    const k = e.toLowerCase();
    const next = picked.has(k) ? value.emails.filter((x) => x.toLowerCase() !== k) : [...value.emails, k];
    onChange({ ...value, emails: next });
  };
  function addTyped() {
    const raw = typed.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    const bad = raw.filter((x) => !isEmail(x));
    if (bad.length) return alert(`이메일 형식이 아닙니다 — ${bad.join(', ')}`);
    if (!raw.length) return;
    onChange({ ...value, emails: [...new Set([...value.emails, ...raw.map((x) => x.toLowerCase())])] });
    setTyped('');
  }

  /** 거래처정보에 이미 적힌 것과 다른가 — 다르면 대체/추가를 물어야 한다. */
  const cur = new Set(placeEmails.map((e) => e.toLowerCase()));
  const differs = placeId != null && placeEmails.length > 0
    && (value.emails.some((e) => !cur.has(e.toLowerCase())) || value.emails.length !== placeEmails.length);

  return (
    <div style={{ border: '1px solid #cfe0f5', background: '#f7fbff', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 12, color: '#1A2B52' }}>■ 전자세금계산서 발송 e-mail</b>
        <span style={{ fontSize: 10.5, color: '#c33', fontWeight: 700 }}>필수</span>
        <span style={{ fontSize: 11, color: '#666' }}>
          {value.emails.length ? `${value.emails.length}곳 선택` : '한 곳 이상 골라 주세요'}
        </span>
      </div>

      {value.emails.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
          {value.emails.map((e) => (
            <span key={e} style={{
              fontSize: 11, background: '#1A2B52', color: '#fff', borderRadius: 3,
              padding: '2px 5px', display: 'inline-flex', gap: 4, alignItems: 'center',
            }}>
              {e}
              <button onClick={() => toggle(e)} title="빼기"
                style={{ border: 0, background: 'transparent', color: '#fff', cursor: 'pointer', padding: 0 }}>×</button>
            </span>
          ))}
        </div>
      )}

      {loading && <div style={{ fontSize: 11, color: '#999' }}>후보를 찾는 중…</div>}
      {!loading && cands.length > 0 && (
        <div style={{ maxHeight: 130, overflow: 'auto', border: '1px solid #e3ecf5', borderRadius: 4, background: '#fff' }}>
          {cands.map((c) => (
            <label key={c.email} style={{
              display: 'flex', gap: 6, alignItems: 'center', fontSize: 11.5,
              padding: '3px 6px', cursor: 'pointer', borderBottom: '1px solid #f2f6fa',
            }}>
              <input type="checkbox" checked={picked.has(c.email)} onChange={() => toggle(c.email)} />
              <span style={{ fontWeight: 600 }}>{c.email}</span>
              <SourceTag s={c.source} />
              {c.source === '과거발행' && (
                <span style={{ fontSize: 10, color: '#888' }}>
                  {c.count}회{c.lastSeen ? ` · 최근 ${c.lastSeen}` : ''}
                </span>
              )}
              {c.note && <span style={{ fontSize: 10, color: '#999' }}>{c.note}</span>}
            </label>
          ))}
        </div>
      )}
      {!loading && cands.length === 0 && (
        <div style={{ fontSize: 11, color: '#a15' }}>
          이 거래처로 보낸 기록이 없습니다 — 아래에 직접 적어 주세요.
        </div>
      )}

      <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }}
          placeholder="새 이메일 직접 입력 (여러 개면 쉼표로)" style={{ flex: 1, fontSize: 11.5 }} />
        <button className="btn-sm" onClick={addTyped}>＋ 추가</button>
      </div>

      {placeId && (
        <div style={{ marginTop: 7, borderTop: '1px solid #e3ecf5', paddingTop: 6 }}>
          <label style={{ fontSize: 11.5, display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={value.saveToPlace}
              onChange={(e) => onChange({ ...value, saveToPlace: e.target.checked })} />
            이 이메일을 <b>거래처정보</b>에도 남깁니다 — 다음부터 저절로 뜹니다.
          </label>
          {placeEmails.length > 0 && (
            <div style={{ fontSize: 10.5, color: '#888', marginTop: 3 }}>
              지금 거래처정보에 적힌 것: {placeEmails.join(', ')}
            </div>
          )}
          {value.saveToPlace && differs && (
            <div style={{
              marginTop: 5, fontSize: 11.5, background: '#FFF7ED',
              border: '1px solid #FCD34D', borderRadius: 4, padding: '5px 7px',
            }}>
              거래처정보에 적힌 것과 <b>다릅니다</b>. 어떻게 할까요?
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <button className={value.mode === 'replace' ? 'btn-p' : 'btn-sm'}
                  onClick={() => onChange({ ...value, mode: 'replace' })}>
                  기존정보 대체
                </button>
                <button className={value.mode === 'append' ? 'btn-p' : 'btn-sm'}
                  onClick={() => onChange({ ...value, mode: 'append' })}>
                  추가 기재
                </button>
              </div>
              <div style={{ fontSize: 10.5, color: '#92400E', marginTop: 3 }}>
                {value.mode === 'replace'
                  ? '기존 것을 지우고 이번에 고른 것만 남깁니다 — 담당이 바뀐 경우.'
                  : '기존 것에 더합니다 — 받는 사람이 늘어난 경우.'}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SourceTag({ s }: { s: EmailCandidate['source'] }) {
  const c = s === '거래처정보' ? { bg: '#D1FAE5', fg: '#065F46', bd: '#6EE7B7' }
    : s === '과거발행' ? { bg: '#DBEAFE', fg: '#1E3A8A', bd: '#93C5FD' }
      : { bg: '#F3F4F6', fg: '#6B7280', bd: '#E5E7EB' };
  return (
    <span style={{
      fontSize: 9.5, fontWeight: 700, padding: '0 4px', borderRadius: 3,
      color: c.fg, background: c.bg, border: `1px solid ${c.bd}`, whiteSpace: 'nowrap',
    }}>{s}</span>
  );
}

/** 처음 값 — 화면들이 같은 모양으로 시작하도록. */
export const emptyEmailChoice: EmailChoice = { emails: [], saveToPlace: true, mode: 'append' };
