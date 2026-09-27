// 중요성 입력 — 2700A-2(1차)·2700A-3(2차)·2700A-4(3차)가 같은 폼을 쓴다. 금액 단위는 백만원(양식 그대로).
import { BENCHES, RATE_RANGE, computedMateriality, suggestRate, suggestLevel, type Paper2700, type BenchKey, type Paper2700A1 } from '../../lib/gwpPaper2700A';

const pct = (n: number | null) => (n == null ? '' : String(Math.round(n * 10000) / 100));
const fromPct = (s: string): number | null => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Math.round(Number(s) * 100) / 10000);
const fromNum = (s: string): number | null => (s.trim() === '' || Number.isNaN(Number(s.replace(/,/g, ''))) ? null : Number(s.replace(/,/g, '')));
const fmt = (n: number | null) => (n == null ? '-' : n.toLocaleString('ko-KR', { maximumFractionDigits: 1 }));

export default function Form2700A({ value, onChange, readOnly, factors, tools }: {
  value: Paper2700;
  onChange: (v: Paper2700) => void;
  readOnly: boolean;
  /** 2700A-1 판단(적용률 추천) */ factors: Paper2700A1 | null;
  /** 위쪽 버튼들(전기 DSD 에서 채우기·앞 단계 값 가져오기) */ tools?: React.ReactNode;
}) {
  const v = value;
  const set = (p: Partial<Paper2700>) => onChange({ ...v, ...p });
  const calc = computedMateriality(v);
  const level = factors ? suggestLevel(factors.factors) : '';
  const sug = level ? suggestRate(v.bench, level) : null;
  const pmAmt = v.materiality != null && v.pmRate != null ? v.materiality * v.pmRate : null;
  const ctAmt = v.materiality != null && v.ctRate != null ? v.materiality * v.ctRate : null;
  const ta = (val: string, on: (s: string) => void, rows = 3) => (
    <textarea className="btn-sm" rows={rows} value={val} disabled={readOnly} onChange={(e) => on(e.target.value)}
      style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
  );
  const box: React.CSSProperties = { border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', marginBottom: 10 };

  return (
    <div style={{ fontSize: 'var(--fs-2)' }}>
      {tools && !readOnly && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>{tools}</div>}

      <div style={box}>
        <b>1. 기본정보</b>
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 6, marginTop: 6, alignItems: 'center' }}>
          <span>회계기간</span><input className="btn-sm" value={v.period} disabled={readOnly} onChange={(e) => set({ period: e.target.value })} />
          <span>상장여부</span><input className="btn-sm" value={v.listed} disabled={readOnly} onChange={(e) => set({ listed: e.target.value })} style={{ maxWidth: 200 }} />
        </div>
      </div>

      <div style={box}>
        <b>2. 재무제표 전체 중요성</b> <span style={{ color: 'var(--ink-3)' }}>(백만원)</span>
        <table className="tbl" style={{ marginTop: 6 }}>
          <thead><tr style={{ background: 'var(--surface-2)' }}>
            <th style={{ width: 50 }}>적용</th><th>Benchmark</th><th style={{ width: 130 }}>금액</th><th style={{ width: 110 }}>적용률 범위</th><th style={{ width: 110 }}>적용비율(%)</th><th style={{ width: 100 }}>계산</th>
          </tr></thead>
          <tbody>
            {BENCHES.map((k: BenchKey) => {
              const on = v.bench === k;
              const [lo, hi] = RATE_RANGE[k];
              return (
                <tr key={k} style={{ background: on ? 'var(--navy-bg)' : undefined }}>
                  <td style={{ textAlign: 'center' }}><input type="radio" checked={on} disabled={readOnly} onChange={() => set({ bench: k })} /></td>
                  <td>{k}</td>
                  <td><input className="btn-sm" style={{ width: '100%', textAlign: 'right' }} value={v.amounts[k] ?? ''} disabled={readOnly}
                    onChange={(e) => set({ amounts: { ...v.amounts, [k]: fromNum(e.target.value) } })} /></td>
                  <td style={{ color: 'var(--ink-3)', textAlign: 'center' }}>{pct(lo)}% ~ {pct(hi)}%</td>
                  <td>{on && <input className="btn-sm" style={{ width: '100%', textAlign: 'right' }} value={pct(v.rate)} disabled={readOnly}
                    onChange={(e) => set({ rate: fromPct(e.target.value) })} />}</td>
                  <td style={{ textAlign: 'right' }}>{on ? fmt(calc) : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sug != null && (
          <div style={{ marginTop: 6, color: 'var(--ink-2)' }}>
            2700A-1 판단: <b>{level} 수준 적용율</b> → {v.bench} <b>{pct(sug)}%</b> 추천
            {!readOnly && v.rate !== sug && <button className="btn-sm" style={{ marginLeft: 6 }} onClick={() => set({ rate: sug })}>적용</button>}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <b>결정된 중요성 금액</b>
          <input className="btn-sm" style={{ width: 120, textAlign: 'right' }} value={v.materiality ?? ''} disabled={readOnly}
            onChange={(e) => set({ materiality: fromNum(e.target.value) })} /> 백만원
          {calc != null && !readOnly && v.materiality !== Math.round(calc) && (
            <button className="btn-sm" onClick={() => set({ materiality: Math.round(calc) })}>계산값 {fmt(Math.round(calc))} 쓰기</button>
          )}
        </div>
        <div style={{ marginTop: 8 }}>근거</div>{ta(v.reason, (s) => set({ reason: s }), 4)}
        <div style={{ marginTop: 6 }}>전기와 다른 Benchmark·적용률이면 변경 근거</div>{ta(v.changeReason, (s) => set({ changeReason: s }), 2)}
      </div>

      <div style={box}>
        <b>3. 수행중요성</b>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
          전체 중요성의 <input className="btn-sm" style={{ width: 70, textAlign: 'right' }} value={pct(v.pmRate)} disabled={readOnly}
            onChange={(e) => set({ pmRate: fromPct(e.target.value) })} />%
          <span style={{ color: 'var(--ink-3)' }}>(50~75%)</span> → <b>{fmt(pmAmt)}</b> 백만원
        </div>
        <div style={{ marginTop: 6 }}>근거</div>{ta(v.pmReason, (s) => set({ pmReason: s }), 2)}
      </div>

      <div style={box}>
        <b>4. 명백하게 사소한 금액</b>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
          전체 중요성의 <input className="btn-sm" style={{ width: 70, textAlign: 'right' }} value={pct(v.ctRate)} disabled={readOnly}
            onChange={(e) => set({ ctRate: fromPct(e.target.value) })} />%
          <span style={{ color: 'var(--ink-3)' }}>(5% 이내)</span> → <b>{fmt(ctAmt)}</b> 백만원
        </div>
        <div style={{ marginTop: 6 }}>근거</div>{ta(v.ctReason, (s) => set({ ctReason: s }), 2)}
      </div>
    </div>
  );
}
