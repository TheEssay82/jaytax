// 2301(일반·K-IFRS 2026) 중요왜곡표시위험의 식별·평가 및 대응(재무제표 수준) 입력 — 위험 한 줄마다 8칸.
// 작년 판단에서 시작하고, 양식의 작성 예시를 골라 더한다. 계정 수준(2302)은 엑셀.
import { RISK_KINDS, type FsRisk, type Paper2301G, type YN } from '../../lib/gwpPaper2301G';
import { phrasesFor, fillPhrase, type Phrase } from '../../lib/gwp2301Phrases';
import type { AuditBasis } from '../../lib/gwpSetup';

const EMPTY: FsRisk = { risk: '', sig: '', kind: '', affects: '', impact: '', control: '', response: '', note: '' };

export default function Form2301G({ value, onChange, readOnly, examples, big, basis }: {
  value: Paper2301G;
  onChange: (v: Paper2301G) => void;
  readOnly: boolean;
  /** 양식의 작성 예시 줄 */ examples: FsRisk[];
  /** 2120A 에서 크게 변한 계정 — 참고 */ big: Map<string, string>;
  /** 재무제표 회계기준 — 표준 문구의 기준서 이름(특수관계자 공시) */ basis?: AuditBasis | null;
}) {
  const risks = value.risks ?? [];
  const set = (i: number, p: Partial<FsRisk>) => onChange({ risks: risks.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const del = (i: number) => onChange({ risks: risks.filter((_, j) => j !== i) });
  const add = (x: FsRisk) => onChange({ risks: [...risks, x] });
  /** 표준 문구 넣기 — 관련 통제(G)·전반적 대응(H). 이미 적은 글이 있으면 물어보고 바꾼다. */
  const applyPhrase = (i: number, p: Phrase) => {
    const x = risks[i];
    const control = fillPhrase(p.control, basis), response = fillPhrase(p.response, basis);
    const had = [x.control.trim() && x.control.trim() !== control, x.response.trim() && x.response.trim() !== response].some(Boolean);
    if (had && !confirm('관련 통제·전반적 대응에 적어 둔 글을 표준 문구로 바꿉니다. 바꿀까요?')) return;
    set(i, { control, response });
  };
  const have = new Set(risks.map((x) => x.risk.trim()));
  const yn = (v: YN, on: (y: YN) => void) => (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {(['Y', 'N'] as const).map((k) => (
        <button key={k} className={`btn-sm${v === k ? ' btn-sm-navy' : ''}`} disabled={readOnly} onClick={() => on(v === k ? '' : k)}>{k}</button>
      ))}
    </span>
  );
  const area = (v: string, on: (s: string) => void, ph: string, rows = 2) => (
    <textarea className="btn-sm" rows={rows} value={v} disabled={readOnly} placeholder={ph}
      style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} onChange={(e) => on(e.target.value)} />
  );

  return (
    <div style={{ fontSize: 'var(--fs-2)' }}>
      <div style={{ color: 'var(--ink-2)', lineHeight: 1.7, marginBottom: 8 }}>
        재무제표 전체에 영향을 주는 위험을 한 줄씩 적습니다. 작년 판단을 불러왔으니 올해도 맞는지 보고, 유의적(Y)인 위험은 <b>전반적인 대응</b>까지 적으세요.
        부정 위험은 기준서 240 에 따라 유의적 위험입니다. 계정·경영진주장 수준은 <b>2302</b>(엑셀)에서 합니다.
      </div>
      {big.size > 0 && (
        <div style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)', marginBottom: 8 }}>
          참고 — 2120A 에서 크게 변한 계정: {[...big.keys()].slice(0, 8).join(', ')}{big.size > 8 ? ` 외 ${big.size - 8}개` : ''}
        </div>
      )}
      {risks.map((x, i) => (
        <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', marginBottom: 8, background: x.sig === 'Y' ? 'var(--surface-2)' : undefined }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <b style={{ minWidth: 20 }}>{i + 1}</b>
            {area(x.risk, (s) => set(i, { risk: s }), '재무제표 수준의 중요왜곡표시위험')}
            {!readOnly && <button className="btn-sm" title="이 줄 지우기" onClick={() => del(i)}>✕</button>}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0 6px 26px' }}>
            <span>유의적 위험 {yn(x.sig, (y) => set(i, { sig: y }))}</span>
            <span>해당 위험{' '}
              <select className="btn-sm" value={x.kind} disabled={readOnly} onChange={(e) => set(i, { kind: e.target.value })}>
                <option value="">-</option>
                {[...new Set([...RISK_KINDS, x.kind].filter(Boolean))].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </span>
            <span>경영진주장 수준 위험 평가에 영향 {yn(x.affects, (y) => set(i, { affects: y }))}</span>
          </div>
          {!readOnly && phrasesFor(x.risk, x.sig).length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '0 0 6px 26px' }}>
              <span style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)' }}>표준 문구 넣기(관련 통제·전반적 대응)</span>
              {phrasesFor(x.risk, x.sig).map((p) => (
                <button key={p.label} className="btn-sm" title={`${p.from} — ${fillPhrase(p.response, basis)}`} onClick={() => applyPhrase(i, p)}>{p.label}</button>
              ))}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginLeft: 26 }}>
            {area(x.impact, (s) => set(i, { impact: s }), '재무제표에 미치는 전반적인 영향의 성격·규모')}
            {area(x.control, (s) => set(i, { control: s }), '관련 통제 이해 요약 또는 조서번호')}
            {area(x.response, (s) => set(i, { response: s }), '전반적인 대응')}
            {area(x.note, (s) => set(i, { note: s }), '비고', 1)}
          </div>
        </div>
      ))}
      {!readOnly && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          <button className="btn-sm" onClick={() => add({ ...EMPTY })}>+ 줄 추가</button>
          {examples.filter((x) => !have.has(x.risk.trim())).map((x) => (
            <button key={x.risk} className="btn-sm" title={`예시 — ${x.response}`} onClick={() => add({ ...x, control: x.control.replace(/-XX$/, '') })}>
              + 예시: {x.risk.length > 28 ? `${x.risk.slice(0, 28)}…` : x.risk}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
