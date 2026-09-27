// 2120A 위험평가 분석적절차 입력 — 전기(이월 때 옮겨 둔 열)와 당기(전기 DSD 로 채움)를 나란히, 증감·비고.
import { useState } from 'react';
import type { Paper2120A, Row2120, FillReport } from '../../lib/gwpPaper2120A';

const fmt = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString('ko-KR'));
const parse = (s: string): number | null => { const t = s.replace(/[,\s]/g, ''); if (!t) return null; const n = Number(t.replace(/^\((.*)\)$/, '-$1')); return Number.isFinite(n) ? n : null; };

const SRC: Record<string, { t: string; c: string }> = {
  문구: { t: 'DSD', c: 'var(--good)' }, 차감: { t: 'DSD 차감', c: 'var(--good)' }, 금액: { t: 'DSD(금액으로 짝)', c: 'var(--navy)' }, 손: { t: '손으로', c: 'var(--ink-2)' },
};

export default function Form2120A({ value, onChange, readOnly, fill, report }: {
  value: Paper2120A;
  onChange: (v: Paper2120A) => void;
  readOnly: boolean;
  /** 전기 DSD 로 채우기 버튼(없으면 자료함에 DSD 가 없는 것) */ fill?: React.ReactNode;
  report: FillReport | null;
}) {
  const [only, setOnly] = useState<'all' | 'big' | 'todo'>('all');
  /** 받을 줄 없는 계정을 더할 줄(계정 → 줄 key) · 이미 더한 계정 */
  const [pick, setPick] = useState<Record<string, string>>({});
  const [placed, setPlaced] = useState<Set<string>>(new Set());
  const set = (key: string, p: Partial<Row2120>) => onChange({ ...value, rows: value.rows.map((r) => (r.key === key ? { ...r, ...p } : r)) });
  const big = (r: Row2120) => {
    if (r.prev == null || r.cur == null) return false;
    const g = r.cur - r.prev;
    return Math.abs(g) >= 10_000_000 && (r.prev === 0 || Math.abs(g / r.prev) >= 0.2);
  };
  const todo = (r: Row2120) => (!!r.prev && r.cur == null) || r.prevDiff != null;
  const rows = value.rows.filter((r) => (only === 'big' ? big(r) : only === 'todo' ? todo(r) : true));
  if (!value.rows.length) return <div style={{ color: 'var(--warn)' }}>2120A 에서 전기·당기 열(「BS: 2024_4Q」 같은 머리)을 찾지 못했습니다.</div>;

  return (
    <div style={{ fontSize: 'var(--fs-2)' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        {!readOnly && fill}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {([['all', '모두'], ['big', '증감 큰 줄'], ['todo', '확인할 줄']] as const).map(([k, l]) => (
            <button key={k} className={`btn-sm${only === k ? ' btn-sm-navy' : ''}`} onClick={() => setOnly(k)}>{l}</button>
          ))}
        </span>
      </div>
      {report && (
        <div style={{ padding: '6px 10px', borderRadius: 8, background: 'var(--surface-2)', marginBottom: 8, lineHeight: 1.6 }}>
          전기 DSD 로 채움 — 문구 {report.byLabel} · 차감 계정 {report.byContra} · 금액으로 짝 {report.byValue}
          {report.scale !== 1 && ` · DSD 단위 ×${report.scale}`}
          {report.missing.length > 0 && <div style={{ color: 'var(--warn)' }}>작년 금액이 있는데 DSD 에서 못 찾은 줄: {report.missing.join(', ')} — 손으로 넣으세요.</div>}
          {report.prevDiff.length > 0 && <div style={{ color: 'var(--warn)' }}>전기 열 금액이 DSD 전기 금액과 다른 줄: {report.prevDiff.join(', ')} — 재분류·재작성인지 보세요.</div>}
          {report.unplaced.filter((u) => !placed.has(u.label)).length > 0 && (
            <div style={{ color: 'var(--warn)' }}>
              DSD 에는 있는데 2120A 에 받을 줄이 없는 계정 — 합계가 이만큼 어긋납니다. 같은 계정인 줄을 골라 더하세요:
              {report.unplaced.filter((u) => !placed.has(u.label)).map((u) => (
                <div key={u.label} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, color: 'var(--ink-1)' }}>
                  <b>{u.label}</b> {fmt(u.cur)} →
                  <select className="btn-sm" disabled={readOnly} value={pick[u.label] ?? ''} onChange={(e) => setPick({ ...pick, [u.label]: e.target.value })}>
                    <option value="">줄 고르기</option>
                    {value.rows.filter((r) => (r.pl ? /손익/ : /재무상태|대차대조/).test(u.statement)).map((r) => (
                      <option key={r.key} value={r.key}>{r.label}{r.fsli ? ` (${r.fsli})` : ''}{r.cur ? ` · ${fmt(r.cur)}` : ''}</option>
                    ))}
                  </select>
                  <button className="btn-sm" disabled={readOnly || !pick[u.label]} onClick={() => {
                    const k = pick[u.label];
                    onChange({ ...value, rows: value.rows.map((r) => (r.key === k ? { ...r, cur: (r.cur ?? 0) + u.cur, src: '손', note: r.note || `${u.label} 포함` } : r)) });
                    setPlaced(new Set(placed).add(u.label));
                  }}>이 줄에 더하기</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <table className="tbl">
        <thead><tr style={{ background: 'var(--surface-2)' }}>
          <th>계정</th><th style={{ width: 120 }}>공시 계정</th>
          <th style={{ width: 130 }}>{value.prevLabel.replace(/\s*PL:.*$/s, '').replace(/^BS:\s*/, '') || '전기'}</th>
          <th style={{ width: 140 }}>{value.curLabel.replace(/\s*PL:.*$/s, '').replace(/^BS:\s*/, '') || '당기'}</th>
          <th style={{ width: 110 }}>증감</th><th style={{ width: 60 }}>%</th><th style={{ width: 200 }}>비고</th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const g = r.prev != null && r.cur != null ? r.cur - r.prev : null;
            const p = g != null && r.prev ? g / r.prev : null;
            const first = i === 0 || rows[i - 1].pl !== r.pl;
            return (
              <FragmentRows key={r.key} head={first ? (r.pl ? '손익' : '재무상태') : null}>
                <tr style={{ background: big(r) ? 'var(--warn-bg)' : undefined }}>
                  <td>{r.label}{r.src && <span style={{ fontSize: 'var(--fs-0)', color: SRC[r.src]?.c, marginLeft: 4 }}>{SRC[r.src]?.t}</span>}</td>
                  <td style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-0)' }}>{r.fsli}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(r.prev)}{r.prevDiff != null && <div style={{ fontSize: 'var(--fs-0)', color: 'var(--warn)' }}>DSD {fmt(r.prevDiff)}</div>}
                  </td>
                  <td><input className="btn-sm" style={{ width: '100%', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} disabled={readOnly}
                    value={fmt(r.cur)} onChange={(e) => set(r.key, { cur: parse(e.target.value), src: '손' })} /></td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: g && g < 0 ? 'var(--bad)' : undefined }}>{fmt(g)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{p == null ? '' : `${Math.round(p * 1000) / 10}%`}</td>
                  <td><input className="btn-sm" style={{ width: '100%' }} disabled={readOnly} value={r.note} onChange={(e) => set(r.key, { note: e.target.value })} /></td>
                </tr>
              </FragmentRows>
            );
          })}
        </tbody>
      </table>
      <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)', marginTop: 6 }}>
        노란 줄은 증감이 1천만원 이상이면서 20% 이상인 줄입니다(비고 칸에 사유를 적어 두면 편합니다). 합계·비율 줄은 엑셀 수식이 계산합니다.
      </div>
    </div>
  );
}

function FragmentRows({ head, children }: { head: string | null; children: React.ReactNode }) {
  return <>{head && <tr><td colSpan={7} style={{ fontWeight: 700, background: 'var(--surface-2)' }}>{head}</td></tr>}{children}</>;
}
