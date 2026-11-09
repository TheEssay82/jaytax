// 결산 현황(대시보드) + 작업 기록 — 회사 담당자가 「몇 월까지 마감했는지 · 누가 언제 무엇을 했는지」를 한눈에(사용자 2026-11-09).
// 숫자는 마감 때 남긴 요약(ifrs18_close)에서 온다. 분개장을 올려 둔 상태면, 마감한 달을 지금 분개장으로 다시 계산해
// 마감 때와 다르면(마감 뒤 소급 기표 등) ⚠ 로 알린다.
import { useState } from 'react';
import type { Ifrs18CloseRow, Ifrs18LogRow } from '../../lib/ifrs18Api';

const won = (n: number) => (n < 0 ? `(${Math.abs(Math.round(n)).toLocaleString()})` : Math.round(n).toLocaleString());
const td: React.CSSProperties = { padding: '3px 5px', borderBottom: '1px solid var(--rule)', fontSize: 'var(--fs-0)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const th: React.CSSProperties = { ...td, background: '#F1F5F9', fontWeight: 700, textAlign: 'center' };
const lab: React.CSSProperties = { ...td, textAlign: 'left', fontWeight: 700, background: '#F8FAFC' };

export interface Drift { op: number; ni: number }

export default function Ifrs18Dashboard({ year, month, closes, logs, drift, onPick }: {
  year: number; month: number; closes: Ifrs18CloseRow[]; logs: Ifrs18LogRow[];
  drift: Map<number, Drift>; onPick: (m: number) => void;
}) {
  const [logMonthOnly, setLogMonthOnly] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const cm = new Map(closes.filter((c) => c.year === year).map((c) => [c.month, c]));
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const lastClosed = Math.max(0, ...cm.keys());
  /** 분기 = 분기 마지막 달을 마감할 때 남긴 「당분기」(누적 − 직전 분기 말 누적). 분기 중이면 지금까지 마감한 달의 당분기. */
  const qVal = (q: number, k: 'op' | 'ni') => {
    const m = [q * 3, q * 3 - 1, q * 3 - 2].find((x) => cm.has(x));
    return m ? { v: cm.get(m)!.summary[k].quarter, partial: m !== q * 3, m } : null;
  };
  const shownLogs = logs.filter((l) => !logMonthOnly || (l.year === year && l.month === month));

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <b style={{ color: 'var(--navy)' }}>📊 {year}년 결산 현황</b>
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
          마감 {cm.size}개월{lastClosed ? ` · 마지막 마감 ${lastClosed}월` : ''} · 칸을 누르면 그 달을 기준월로 엽니다. 금액은 마감 때 남긴 값(1118, 수익+).
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed', minWidth: 1320 }}>
          <colgroup><col style={{ width: 130 }} />{months.map((m) => <col key={m} />)}</colgroup>
          <thead>
            <tr><th style={{ ...th, textAlign: 'left' }}>구분</th>{months.map((m) => (
              <th key={m} style={{ ...th, cursor: 'pointer', outline: m === month ? '2px solid var(--navy)' : undefined }} onClick={() => onPick(m)}>{m}월</th>
            ))}</tr>
          </thead>
          <tbody>
            <tr><td style={lab}>상태</td>{months.map((m) => {
              const c = cm.get(m); const d = drift.get(m);
              return (
                <td key={m} style={{ ...td, textAlign: 'center', cursor: 'pointer', color: c ? (d ? '#B45309' : '#16A34A') : 'var(--ink-3)', fontWeight: 700 }} onClick={() => onPick(m)}
                  title={c ? `${c.byName ?? ''} ${new Date(c.at).toLocaleString('ko-KR')} · ${c.summary.fileName}${d ? `\n⚠ 지금 분개장으로 다시 계산하면 영업손익 ${won(d.op)} · 순손익 ${won(d.ni)} 차이` : ''}` : '미마감'}>
                  {c ? (d ? '⚠ 변동' : '✔ 마감') : '—'}
                </td>
              );
            })}</tr>
            <tr><td style={lab}>마감일 · 담당</td>{months.map((m) => {
              const c = cm.get(m);
              return <td key={m} style={{ ...td, textAlign: 'center', fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}>{c ? `${new Date(c.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} ${c.byName ?? ''}` : ''}</td>;
            })}</tr>
            {([['당월 영업손익', 'op', 'month'], ['누적 영업손익', 'op', 'cum'], ['당월 당기순손익', 'ni', 'month'], ['누적 당기순손익', 'ni', 'cum']] as const).map(([t, k, p]) => (
              <tr key={t}><td style={lab}>{t}</td>{months.map((m) => { const c = cm.get(m); return <td key={m} style={td}>{c ? won(c.summary[k][p]) : ''}</td>; })}</tr>
            ))}
            <tr><td style={lab}>조정 판단 · 주의 라인</td>{months.map((m) => { const c = cm.get(m); return <td key={m} style={{ ...td, textAlign: 'center' }}>{c ? `${c.summary.adjCount} / ${c.summary.watchCount}` : ''}</td>; })}</tr>
          </tbody>
        </table>
      </div>
      <table style={{ borderCollapse: 'collapse', marginTop: 8, minWidth: 560 }}>
        <thead><tr><th style={{ ...th, textAlign: 'left' }}>분기(마감 기준)</th>{[1, 2, 3, 4].map((q) => <th key={q} style={th}>{q}분기</th>)}</tr></thead>
        <tbody>
          {([['영업손익', 'op'], ['당기순손익', 'ni']] as const).map(([t, k]) => (
            <tr key={k}><td style={lab}>{t}</td>{[1, 2, 3, 4].map((q) => { const x = qVal(q, k); return <td key={q} style={td} title={x?.partial ? `${x.m}월까지` : ''}>{x == null ? '—' : `${won(x.v)}${x.partial ? ` (~${x.m}월)` : ''}`}</td>; })}</tr>
          ))}
        </tbody>
      </table>
      {[...drift.keys()].length > 0 && (
        <div className="alert-w" style={{ marginTop: 6 }}>
          ⚠ 마감한 달 중 {[...drift.keys()].map((m) => `${m}월`).join(' · ')}을 지금 올린 분개장으로 다시 계산하면 마감 때와 다릅니다(마감 뒤 소급 기표 · 판단 변경 등). 해당 달을 「마감 해제」 후 다시 마감하거나, 차이를 당월에 반영했는지 확인하세요.
        </div>
      )}

      <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn-sm" onClick={() => setShowLog((v) => !v)}>{showLog ? '▾' : '▸'} 작업 기록 {logs.length}건</button>
        {showLog && <label style={{ fontSize: 'var(--fs-1)' }}><input type="checkbox" checked={logMonthOnly} onChange={(e) => setLogMonthOnly(e.target.checked)} /> {year}년 {month}월만</label>}
      </div>
      {showLog && (
        <div style={{ maxHeight: 280, overflow: 'auto', marginTop: 4 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr>{['일시', '기준월', '작업', '담당', '내용'].map((h) => <th key={h} style={{ ...th, textAlign: 'left', position: 'sticky', top: 0 }}>{h}</th>)}</tr></thead>
            <tbody>{shownLogs.map((l) => (
              <tr key={l.id}>
                <td style={{ ...td, textAlign: 'left' }}>{new Date(l.at).toLocaleString('ko-KR')}</td>
                <td style={{ ...td, textAlign: 'left' }}>{l.year && l.month ? `${l.year}.${l.month}` : ''}</td>
                <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>{l.action}</td>
                <td style={{ ...td, textAlign: 'left' }}>{l.byName}</td>
                <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal' }}>{describe(l)}</td>
              </tr>
            ))}{!shownLogs.length && <tr><td style={{ ...td, textAlign: 'left' }} colSpan={5}>기록이 없습니다.</td></tr>}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function describe(l: Ifrs18LogRow): string {
  const d = l.detail as Record<string, string | number | undefined>;
  switch (l.action) {
    case '분개장 읽음': return `${d.fileName ?? ''} · ${Number(d.lines ?? 0).toLocaleString()}줄 · 마지막 전기일 ${d.lastDate ?? ''}`;
    case '판단 저장': return `${d.docNo} / ${d.gl} → ${d.decision}${d.target ? `(${d.target})` : ''}${d.reason ? ` — ${d.reason}` : ''}`;
    case '판단 삭제': return `${d.docNo} / ${d.gl} 판단 취소`;
    case '마감': return `영업손익 누적 ${won(Number(d.opCum ?? 0))} · 당월 ${won(Number(d.opMonth ?? 0))} · ${d.fileName ?? ''}`;
    case '마감 해제': return `사유: ${d.reason ?? ''}`;
    case '엑셀 내려받기': return String(d.file ?? '');
    default: return '';
  }
}
