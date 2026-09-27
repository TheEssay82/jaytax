// 2700A-1 적용지침 입력 — 적용률 고려요소마다 낮은·중간·높은 수준과 판단근거. 종합 수준이 2700A-2 의 추천 적용률이 된다.
import { suggestLevel, suggestRate, BENCHES, type Paper2700A1, type Level } from '../../lib/gwpPaper2700A';

const LEVELS: Exclude<Level, ''>[] = ['낮은', '중간', '높은'];

export default function Form2700A1({ value, onChange, readOnly }: {
  value: Paper2700A1;
  onChange: (v: Paper2700A1) => void;
  readOnly: boolean;
}) {
  if (!value.factors.length) return <div style={{ color: 'var(--warn)' }}>조서에서 「구분 · 백분율 적용」 표를 찾지 못했습니다.</div>;
  const lv = suggestLevel(value.factors);
  const set = (i: number, p: Partial<Paper2700A1['factors'][number]>) =>
    onChange({ ...value, factors: value.factors.map((f, j) => (j === i ? { ...f, ...p } : f)) });
  return (
    <div style={{ fontSize: 'var(--fs-2)' }}>
      <div style={{ color: 'var(--ink-2)', lineHeight: 1.7, marginBottom: 8 }}>
        회사 전체 Risk 가 높으면 <b>낮은 수준 적용율</b>입니다. 요소 하나라도 낮은 수준이면 종합도 낮은 수준으로 봅니다(보수적).
      </div>
      <table className="tbl">
        <thead><tr style={{ background: 'var(--surface-2)' }}>
          <th style={{ width: 170 }}>구분</th><th style={{ width: 200 }}>백분율 적용</th><th>판단근거</th>
        </tr></thead>
        <tbody>
          {value.factors.map((f, i) => (
            <tr key={f.label}>
              <td>{f.label}</td>
              <td>
                <div style={{ display: 'flex', gap: 4 }}>
                  {LEVELS.map((l) => (
                    <button key={l} className={`btn-sm${f.level === l ? ' btn-sm-navy' : ''}`} disabled={readOnly}
                      onClick={() => set(i, { level: f.level === l ? '' : l })}>{l}</button>
                  ))}
                </div>
              </td>
              <td><input className="btn-sm" style={{ width: '100%' }} value={f.reason} disabled={readOnly} onChange={(e) => set(i, { reason: e.target.value })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8 }}>추가고려요소</div>
      <input className="btn-sm" style={{ width: '100%' }} value={value.extra} disabled={readOnly} onChange={(e) => onChange({ ...value, extra: e.target.value })} />
      <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)' }}>
        종합: <b>{lv ? `${lv} 수준 적용율` : '아직 고르지 않음'}</b>
        {lv && <span style={{ color: 'var(--ink-2)' }}> → 2700A-2 추천 적용률 {BENCHES.map((b) => `${b} ${Math.round((suggestRate(b, lv) ?? 0) * 10000) / 100}%`).join(' · ')}</span>}
      </div>
    </div>
  );
}
