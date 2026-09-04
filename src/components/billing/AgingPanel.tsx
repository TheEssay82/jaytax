// 수금·미수금 › 미수금 나이(aging).
//
// ERP 는 입금을 청구건에 연결하지 않는다. 그래서 "이 입금이 어느 청구를 갚았나"는 자료로 알 수 없고,
// 회계 실무의 통상대로 **오래된 것부터 갚은 것으로 본다(FIFO)**. 그 가정을 화면에 적어 둔다 —
// 숫자만 보고 사실인 줄 알면 안 되기 때문이다.
import { useState } from 'react';
import Guide from '../common/Guide';
import { BUCKETS, OVERDUE_DAYS, type AgingRow, type AgingSource } from '../../lib/agingApi';

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');

export function AgingPanel({
  rows, asOf, busy, source, q, setQ, overdueOnly, setOverdueOnly, canWrite, freshOverdue, onDetail, onNotify,
}: {
  rows: AgingRow[];
  asOf: string;
  busy: boolean;
  /** 나이를 무엇으로 쟀는가 — 대장이면 실제 발행일, 아니면 추정. */
  source: AgingSource;
  q: string;
  setQ: (v: string) => void;
  overdueOnly: boolean;
  setOverdueOnly: (v: boolean) => void;
  canWrite: boolean;
  /** 아직 이 달에 알리지 않은 6개월 초과 거래처 수. */
  freshOverdue: number;
  onDetail: (r: AgingRow) => void;
  onNotify: () => void;
}) {
  const [sort, setSort] = useState<'overdue' | 'total' | 'oldest'>('overdue');
  const sorted = [...rows].sort((a, b) => (
    sort === 'total' ? b.total - a.total
      : sort === 'oldest' ? b.oldestDays - a.oldestDays
        : b.overdue - a.overdue || b.total - a.total
  ));
  const sum = (f: (r: AgingRow) => number) => sorted.reduce((s, r) => s + f(r), 0);
  const overdueTotal = sum((r) => r.overdue);
  const overdueCount = sorted.filter((r) => r.overdue > 0).length;

  return (
    <div style={{ marginBottom: 12 }}>
      <Guide id="aging" label="근거 자세히"
        summary={<>
          <b>{asOf}</b> 기준으로 남아 있는 채권을 <b>나이별</b>로 나눈 것입니다. 나이는 <b>발행일부터 기준일까지</b>.
          {source === '미수금대장'
            ? <> 근거는 <b style={{ color: 'var(--good)' }}>ERP 미수금대장</b>입니다.</>
            : <> 근거는 <b style={{ color: '#a15' }}>추정</b>입니다 — 이 달 미수금대장이 아직 없습니다.</>}
        </>}>
        {source === '미수금대장' ? (
          <>
            · 건별 invoiceNo(거래전표번호)의 전표일이 곧 발행일이고, 잔금은 ERP 가 건별로 맞춰 둔 값입니다.
            {' '}<b>추정이 들어가지 않습니다.</b>
            <br />· (−)수정·취소 전표는 같은 거래처의 <b>오래된 채권부터 덜어 냅니다</b> —
            {' '}그렇게 하고도 남는 게 없는 거래처는 목록에 서지 않습니다.
          </>
        ) : (
          <>
            · 기초미수금(2026-07-01)과 발행완료 청구를 <b>오래된 것부터 갚은 것으로</b> 상계해(FIFO) 나이를 잽니다.
            <br />· <b>미수금대장을 올리면 실제 발행일로 바뀝니다.</b>
          </>
        )}
      </Guide>

      <div className="sbar">
        <input placeholder="🔍 거래처·사업장·코드·담당" value={q} onChange={(e) => setQ(e.target.value)} />
        <label style={{ fontSize: 'var(--fs-1)', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
          {' '}6개월 넘은 곳만
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="overdue">6개월↑ 큰 순</option>
          <option value="total">잔액 큰 순</option>
          <option value="oldest">가장 오래된 순</option>
        </select>
        <span style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)' }}>
          {sorted.length}곳 · 잔액 {won(sum((r) => r.total))} ·{' '}
          <b style={{ color: overdueTotal > 0 ? '#c33' : '#1A2B52' }}>
            6개월↑ {overdueCount}곳 {won(overdueTotal)}
          </b>
        </span>
        {canWrite && (
          <button className="btn-p" style={{ marginLeft: 'auto' }} disabled={busy || !freshOverdue}
            onClick={onNotify}
            title={freshOverdue
              ? '담당 회계사와 담당직원에게 알립니다. 같은 달에 같은 거래처로 두 번 보내지 않습니다.'
              : '이 달에 알릴 새 건이 없습니다'}>
            🔔 담당에게 알림 ({freshOverdue})
          </button>
        )}
      </div>

      <div className="tbl-scroll">
        <table className="tbl" style={{ fontSize: 'var(--fs-1)' }}>
          <thead>
            <tr>
              <th>코드</th><th>거래처</th><th>사업장</th><th>담당회계사</th><th>담당직원</th>
              {BUCKETS.map((b) => <th key={b.key} className="r">{b.label}</th>)}
              <th className="r">잔액</th>
              <th className="r">가장 오래된</th>
              <th>알림</th>
            </tr>
          </thead>
          <tbody>
            {busy && (
              <tr><td colSpan={11 + BUCKETS.length} style={{ textAlign: 'center', padding: 20, color: 'var(--ink-4)' }}>
                계산 중…
              </td></tr>
            )}
            {!busy && sorted.length === 0 && (
              <tr><td colSpan={11 + BUCKETS.length} style={{ textAlign: 'center', padding: 20, color: 'var(--ink-4)' }}>
                남아 있는 미수금이 없습니다.
              </td></tr>
            )}
            {!busy && sorted.map((r) => (
              <tr key={r.placeId} style={{ background: r.overdue > 0 ? '#FFF7ED' : undefined }}>
                <td style={{ fontFamily: 'monospace', fontSize: 'var(--fs-0)' }}>{r.code}</td>
                <td style={{ fontWeight: 700, color: 'var(--navy)' }}>
                  <button className="btn-sm" style={{ fontWeight: 700 }} onClick={() => onDetail(r)}
                    title="남아 있는 채권의 내역을 봅니다">{r.company}</button>
                </td>
                <td>{r.place}</td>
                <td style={{ fontSize: 'var(--fs-1)' }}>{r.cpa || <span style={{ color: 'var(--ink-4)' }}>—</span>}</td>
                <td style={{ fontSize: 'var(--fs-1)' }}>{r.staff || <span style={{ color: 'var(--ink-4)' }}>—</span>}</td>
                {BUCKETS.map((b) => {
                  const v = r.buckets[b.key];
                  const old = b.min > OVERDUE_DAYS;
                  return (
                    <td key={b.key} className="r" style={{ color: old && v ? '#c33' : '#666', fontWeight: old && v ? 700 : 400 }}>
                      {v ? won(v) : <span style={{ color: '#DDD' }}>—</span>}
                    </td>
                  );
                })}
                <td className="r" style={{ fontWeight: 700 }}>{won(r.total)}</td>
                <td className="r" style={{ color: r.oldestDays > OVERDUE_DAYS ? '#c33' : '#888' }}>
                  {r.oldestDate ? `${r.oldestDate} (${r.oldestDays}일)` : '—'}
                </td>
                <td style={{ fontSize: 'var(--fs-1)' }}>
                  {r.overdue > 0
                    ? (r.notified ? <span style={{ color: 'var(--good)' }}>✓ 보냄</span> : <span style={{ color: '#C99' }}>아직</span>)
                    : <span style={{ color: '#DDD' }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: '#f5efdd', fontWeight: 700 }}>
              <td colSpan={5}>합계 {sorted.length}곳</td>
              {BUCKETS.map((b) => <td key={b.key} className="r">{won(sum((r) => r.buckets[b.key]))}</td>)}
              <td className="r">{won(sum((r) => r.total))}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** 한 거래처에 남아 있는 채권의 내역 — 무엇이 언제부터 안 들어왔는지. */
export function AgingDetail({ row, asOf, onClose }: { row: AgingRow; asOf: string; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, width: '100%' }}>
        <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          🕰️ {row.company}
          <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>
            {row.place} · {asOf} 기준 잔액 {won(row.total)}
          </span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>
        <div className="alert-i" style={{ fontSize: 'var(--fs-1)' }}>
          입금은 <b>오래된 것부터 갚은 것으로</b> 상계했습니다. 아래는 그러고도 남은 채권입니다.
          <br />담당회계사 <b>{row.cpa || '—'}</b> · 담당직원 <b>{row.staff || '—'}</b>
        </div>
        <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
          <table className="tbl" style={{ fontSize: 'var(--fs-1)' }}>
            <thead>
              <tr><th>발행일</th><th>내용</th><th className="r">남은 금액</th><th className="r">경과</th></tr>
            </thead>
            <tbody>
              {row.items.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 16, color: 'var(--ink-4)' }}>
                  남은 채권이 없습니다. (잔액이 음수라면 입금이 채권보다 많다는 뜻입니다 —
                  발행완료 처리가 안 된 청구가 있는지 보세요.)
                </td></tr>
              )}
              {row.items.map((it, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 700 }}>{it.date}</td>
                  <td>{it.label}</td>
                  <td className="r" style={{ fontWeight: 700 }}>{won(it.amount)}</td>
                  <td className="r" style={{ color: it.days > OVERDUE_DAYS ? '#c33' : '#888', fontWeight: it.days > OVERDUE_DAYS ? 700 : 400 }}>
                    {it.days}일
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
