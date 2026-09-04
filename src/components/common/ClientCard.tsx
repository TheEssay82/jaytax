// 거래처 한 장 — Ctrl+K 에서 거래처를 고르면 뜨는 **읽기 전용** 요약.
//
// 고치는 일은 하지 않는다. 아래 단추로 각 화면에 보낸다 — 규칙이 한 곳에만 남아야 한다.
import { useEffect, useState } from 'react';
import { loadClientCard, type ClientCard as Card } from '../../lib/clientCardApi';
import { setNavQuery } from '../../lib/navSearch';

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');

/** 어디로 보낼 수 있는가. 검색어(거래처명)를 들고 간다. */
const GO = [
  { tab: 'biz-contract', label: '📄 매출계약등록' },
  { tab: 'biz-register', label: '🏢 거래처등록' },
  { tab: 'biz-contacts', label: '👤 거래처담당자등록' },
  { tab: 'receivable', label: '💰 수금·미수금' },
] as const;

export default function ClientCard(
  { entityId, name, onClose, onGo }:
  { entityId: string; name: string; onClose: () => void; onGo: (tab: string) => void },
) {
  const [card, setCard] = useState<Card | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    loadClientCard(entityId)
      .then((c) => { if (alive) setCard(c); })
      .catch((e: unknown) => { if (alive) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [entityId]);

  function go(tab: string) {
    setNavQuery(tab, card?.name ?? name);
    onGo(tab);
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card rep cc" onClick={(e) => e.stopPropagation()}>
        <div className="rep-title">
          {card?.name ?? name}
          <span className="sub">{card ? `${card.code} · ${card.kind}` : '불러오는 중…'}</span>
          <button className="btn-rep" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>

        {err && <div className="alert-e" style={{ fontSize: 'var(--fs-2)' }}>{err}</div>}

        {card && (
          <>
            <div className="cc-grid">
              <Box label="사업장" main={`${card.places.length}곳`}>
                {card.places.slice(0, 4).map((p) => (
                  <div key={p.id} className="cc-line">
                    {p.isHeadquarters && <b>본사 </b>}{p.name || '(이름 없음)'}
                    {p.bizRegNo && <span className="cc-dim"> · {p.bizRegNo}</span>}
                    {p.status && p.status !== '정상' && (
                      <span className="cc-warn"> · {p.status}{p.statusMonth && ` ${p.statusMonth}`}</span>
                    )}
                  </div>
                ))}
                {card.places.length > 4 && <div className="cc-dim">… 외 {card.places.length - 4}곳</div>}
              </Box>

              <Box label="계약" main={`${card.contracts.length}건`}
                sub={`연환산 ${won(card.annualTotal)}`}>
                {card.contracts.slice(0, 4).map((c) => (
                  <div key={c.id} className="cc-line">
                    {c.code || '(코드 없음)'}
                    <span className="cc-dim"> · {c.cycle} {won(c.amount)}</span>
                    {!c.confirmed && <span className="cc-warn"> · 미계약</span>}
                  </div>
                ))}
                {card.contracts.length > 4 && <div className="cc-dim">… 외 {card.contracts.length - 4}건</div>}
              </Box>

              <Box label="담당"
                main={card.cpas.join('·') || '—'}
                sub={card.staffs.length ? `직원 ${card.staffs.join('·')}` : '담당직원 없음'}>
                <div className="cc-dim">회계사는 계약 기준, 직원은 계약 담당이 없으면 사업장 담당을 따릅니다.</div>
              </Box>

              <Box label="미수금"
                main={card.receivable ? won(card.receivable.balance) : '—'}
                sub={card.receivable
                  ? `${card.receivable.asOfYm} 대장 기준${card.receivable.over6mCount ? ` · 6개월↑ ${card.receivable.over6mCount}건` : ''}`
                  : '미수금대장에 없습니다'}>
                {!card.receivable && (
                  <div className="cc-dim">여기서는 <b>추정하지 않습니다</b> — ERP 미수금대장이 정본입니다.</div>
                )}
              </Box>
            </div>

            <div className="cc-recent">
              <div className="cc-label">최근 청구</div>
              {card.recent.length === 0 && <div className="cc-dim">앱으로 낸 청구가 아직 없습니다.</div>}
              {card.recent.map((r, i) => (
                <div key={`${r.ym}-${i}`} className="cc-line">
                  <b>{r.ym}</b> {r.summary}
                  <span className="cc-dim"> · {won(r.total)} · {r.status}</span>
                </div>
              ))}
            </div>

            <div className="cc-go">
              <span className="cc-dim">고치려면 —</span>
              {GO.map((g) => (
                <button key={g.tab} className="btn-rep" onClick={() => go(g.tab)}>{g.label}에서 열기</button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Box(
  { label, main, sub, children }:
  { label: string; main: string; sub?: string; children?: React.ReactNode },
) {
  return (
    <div className="cc-box">
      <div className="cc-label">{label}</div>
      <div className="cc-main">{main}</div>
      {sub && <div className="cc-sub">{sub}</div>}
      {children && <div className="cc-body">{children}</div>}
    </div>
  );
}
