// 8110ARP 종결단계 분석적검토 입력 — 확정 정산표로 채운 당기·전기, 증감이 수행중요성(2700A-4)을 넘는 줄에 Explanation.
import { useState } from 'react';
import type { Paper8110, ArpRow, WtbReport } from '../../lib/gwpPaper8110';

const fmt = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString('ko-KR'));
const parse = (s: string): number | null => { const t = s.replace(/[,\s]/g, ''); if (!t) return null; const n = Number(t.replace(/^\((.*)\)$/, '-$1')); return Number.isFinite(n) ? n : null; };

export default function Form8110({ value, onChange, readOnly, pm, pmNote, fill, report }: {
  value: Paper8110;
  onChange: (v: Paper8110) => void;
  readOnly: boolean;
  /** 수행중요성(원) — 이것을 넘는 증감이 Unusual */ pm: number | null;
  pmNote: string;
  fill?: React.ReactNode;
  report: WtbReport | null;
}) {
  const [only, setOnly] = useState<'unusual' | 'all'>('unusual');
  const set = (key: string, p: Partial<ArpRow>) => onChange({ rows: value.rows.map((r) => (r.key === key ? { ...r, ...p } : r)) });
  const gap = (r: ArpRow) => (r.cur != null && r.prev != null ? r.cur - r.prev : null);
  const unusual = (r: ArpRow) => pm != null && Math.abs(gap(r) ?? 0) > pm;
  const need = value.rows.filter((r) => unusual(r) && !r.explanation.trim()).length;
  const rows = value.rows.filter((r) => (only === 'unusual' ? unusual(r) : true));
  if (!value.rows.length) return <div style={{ color: 'var(--warn)' }}>8110ARP_BS·PL 시트에서 「소계정 · 당기 · 전기」 표를 찾지 못했습니다.</div>;

  return (
    <div style={{ fontSize: 'var(--fs-2)' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        {!readOnly && fill}
        <span style={{ color: 'var(--ink-2)' }}>기준(수행중요성) <b>{pm != null ? `${fmt(Math.round(pm))}원` : '없음'}</b> <span style={{ color: 'var(--ink-3)' }}>{pmNote}</span></span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button className={`btn-sm${only === 'unusual' ? ' btn-sm-navy' : ''}`} onClick={() => setOnly('unusual')}>Unusual 만 ({value.rows.filter(unusual).length})</button>
          <button className={`btn-sm${only === 'all' ? ' btn-sm-navy' : ''}`} onClick={() => setOnly('all')}>모두 ({value.rows.length})</button>
        </span>
      </div>
      {report && (
        <div style={{ padding: '6px 10px', borderRadius: 8, background: 'var(--surface-2)', marginBottom: 8, lineHeight: 1.6 }}>
          확정 정산표에서 {report.filled}줄을 채웠습니다 — 당기 열 BS {report.curCol.BS ?? '못 찾음'} · PL {report.curCol.PL ?? '못 찾음'}
          {(report.prevCol.BS || report.prevCol.PL) && ` · 전기 열 BS ${report.prevCol.BS ?? '-'} · PL ${report.prevCol.PL ?? '-'}`}
          {report.missing.length > 0 && <div style={{ color: 'var(--warn)' }}>정산표에서 못 찾은 줄: {report.missing.join(', ')} — 손으로 넣으세요.</div>}
        </div>
      )}
      {need > 0 && <div style={{ color: 'var(--warn)', marginBottom: 6 }}>Unusual 인데 Explanation 이 빈 줄이 {need}개 있습니다.</div>}
      <table className="tbl">
        <thead><tr style={{ background: 'var(--surface-2)' }}>
          <th style={{ width: 36 }}></th><th style={{ width: 110 }}>대계정</th><th>소계정</th><th style={{ width: 130 }}>당기</th><th style={{ width: 120 }}>전기</th>
          <th style={{ width: 110 }}>증감</th><th style={{ width: 56 }}>%</th><th style={{ width: 260 }}>Explanation</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const g = gap(r);
            const u = unusual(r);
            return (
              <tr key={r.key} style={{ background: u ? 'var(--warn-bg)' : undefined }}>
                <td style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}>{r.sheet}</td>
                <td style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}>{r.group}</td>
                <td>{r.label}{u && <b style={{ color: 'var(--warn)', marginLeft: 4 }}>X</b>}</td>
                <td><input className="btn-sm" style={{ width: '100%', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} disabled={readOnly}
                  value={fmt(r.cur)} onChange={(e) => set(r.key, { cur: parse(e.target.value), src: '손' })} /></td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.prev)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: g && g < 0 ? 'var(--bad)' : undefined }}>{fmt(g)}</td>
                <td style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{g != null && r.prev ? `${Math.round((g / r.prev) * 1000) / 10}%` : ''}</td>
                <td>
                  <input className="btn-sm" style={{ width: '100%' }} disabled={readOnly} value={r.explanation} placeholder={r.lastYear ? `작년: ${r.lastYear}` : ''}
                    onChange={(e) => set(r.key, { explanation: e.target.value })} />
                  {r.lastYear && !readOnly && !r.explanation && (
                    <button className="btn-sm" style={{ fontSize: 'var(--fs-0)', marginTop: 2 }} onClick={() => set(r.key, { explanation: r.lastYear })}>작년 글 쓰기</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)', marginTop: 6 }}>
        반영하면 8110ARP_BS 의 OM·PM·DM 은 2700A-4(백만원 → 원)에, PL 은 BS 에 이어집니다. 작년 Explanation 은 흐리게 보이기만 하고, 새로 적지 않은 줄은 비웁니다.
      </div>
    </div>
  );
}
