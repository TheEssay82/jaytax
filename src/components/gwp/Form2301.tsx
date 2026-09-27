// 2301 감사위험의 평가 입력 — 전체 재무제표 수준 5개 + 계정별. 줄마다 유의적 위험(Y/N/N/A)·경영진주장·판단근거,
// 그리고 추천(규칙·2120A 변동·양식 사례)을 보여 주고 [적용]으로 받는다. 사용자는 확인만 하고 반영(CONFIRM)한다.
import { useState } from 'react';
import {
  ASSERTIONS, ASR_NAME, hintsFor, casesFor, defaultAssertions,
  type Paper2301, type RiskLine, type Sig, type Asr, type LibCase,
} from '../../lib/gwpPaper2301';

const SIGS: Sig[] = ['Y', 'N', 'N/A'];

export default function Form2301({ value, onChange, readOnly, big, lib }: {
  value: Paper2301;
  onChange: (v: Paper2301) => void;
  readOnly: boolean;
  /** 2120A 에서 크게 변한 계정(라벨 → 설명) */ big: Map<string, string>;
  /** 양식 참고자료 — 계정별 왜곡표시위험 사례 */ lib: LibCase[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const setLine = (part: 'entity' | 'accounts', i: number, p: Partial<RiskLine>) =>
    onChange({ ...value, [part]: value[part].map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const allHints = [
    ...value.entity.map((x, i) => ({ part: 'entity' as const, i, h: hintsFor(x, 'entity', big, lib) })),
    ...value.accounts.map((x, i) => ({ part: 'accounts' as const, i, h: hintsFor(x, 'account', big, lib) })),
  ].filter((x) => x.h.some((h) => h.apply));
  const applyAll = () => {
    const next: Paper2301 = { entity: [...value.entity], accounts: [...value.accounts] };
    for (const { part, i, h } of allHints) for (const x of h) if (x.apply) next[part][i] = { ...next[part][i], ...x.apply };
    onChange(next);
  };

  const row = (part: 'entity' | 'accounts', x: RiskLine, i: number) => {
    const hints = hintsFor(x, part === 'entity' ? 'entity' : 'account', big, lib);
    const cases = part === 'accounts' ? casesFor(x.label, lib) : [];
    const id = `${part}:${i}`;
    const na = x.sig === 'N/A';
    return (
      <div key={id} style={{ borderTop: '1px solid var(--line)', padding: '8px 0', opacity: na ? 0.6 : 1 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {part === 'accounts' && !readOnly
            ? <input className="btn-sm" style={{ width: 150, fontWeight: 700 }} value={x.label} onChange={(e) => setLine(part, i, { label: e.target.value })} />
            : <b style={{ flex: part === 'entity' ? 1 : undefined, minWidth: 0 }}>{x.label}</b>}
          <span style={{ display: 'flex', gap: 3 }}>
            {SIGS.map((s) => (
              <button key={s} className={`btn-sm${x.sig === s ? ' btn-sm-navy' : ''}`} disabled={readOnly}
                style={x.sig === s && s === 'Y' ? { background: 'var(--bad)', borderColor: 'var(--bad)' } : undefined}
                onClick={() => setLine(part, i, { sig: s, asr: s === 'N/A' ? [] : x.asr.length ? x.asr : defaultAssertions(x.label) })}>{s}</button>
            ))}
          </span>
          {!na && (
            <span style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              {ASSERTIONS.map((a) => {
                const on = x.asr.includes(a);
                return (
                  <button key={a} className="btn-sm" disabled={readOnly} title={ASR_NAME[a]}
                    style={{ padding: '1px 5px', fontSize: 'var(--fs-0)', background: on ? 'var(--navy-bg)' : undefined, color: on ? 'var(--navy)' : 'var(--ink-4)', fontWeight: on ? 700 : 400 }}
                    onClick={() => setLine(part, i, { asr: on ? x.asr.filter((y) => y !== a) : [...x.asr, a] as Asr[] })}>{a}</button>
                );
              })}
            </span>
          )}
          {part === 'accounts' && !readOnly && (
            <button className="btn-sm" style={{ marginLeft: 'auto' }} title="이 계정 줄을 뺍니다"
              onClick={() => onChange({ ...value, accounts: value.accounts.filter((_, j) => j !== i) })}>빼기</button>
          )}
        </div>
        {!na && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 6, marginTop: 4 }}>
            <input className="btn-sm" placeholder="유의적위험 판단근거 및 설명" value={x.basis} disabled={readOnly} onChange={(e) => setLine(part, i, { basis: e.target.value })} />
            <input className="btn-sm" placeholder="위험평가 수행절차·조서번호" value={x.proc} disabled={readOnly} onChange={(e) => setLine(part, i, { proc: e.target.value })} />
          </div>
        )}
        {hints.map((h, k) => (
          <div key={k} style={{ fontSize: 'var(--fs-1)', color: h.kind === '규칙' ? 'var(--bad)' : h.kind === '2120A' ? 'var(--warn)' : 'var(--ink-2)', marginTop: 3 }}>
            💡 {h.text}
            {h.apply && !readOnly && <button className="btn-sm" style={{ marginLeft: 6 }} onClick={() => setLine(part, i, h.apply!)}>적용</button>}
            {h.kind === '사례' && <button className="btn-sm" style={{ marginLeft: 6 }} onClick={() => setOpen(open === id ? null : id)}>{open === id ? '접기' : '사례 보기'}</button>}
          </div>
        ))}
        {open === id && (
          <div style={{ marginTop: 4, padding: '6px 8px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 'var(--fs-1)', lineHeight: 1.6 }}>
            {cases.map((c, k) => (
              <div key={k}>
                {!readOnly && <button className="btn-sm" style={{ fontSize: 'var(--fs-0)', marginRight: 4 }}
                  onClick={() => setLine(part, i, { basis: x.basis && !/일반적인 위험/.test(x.basis) ? `${x.basis} / ${c.risk}` : c.risk, asr: [...new Set([...x.asr, ...c.asr])] as Asr[] })}>넣기</button>}
                {c.risk} <span style={{ color: 'var(--ink-3)' }}>({c.asr.join(', ')})</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ fontSize: 'var(--fs-2)' }}>
      <div style={{ color: 'var(--ink-2)', lineHeight: 1.7, marginBottom: 8 }}>
        작년 판단을 불러왔습니다. 💡 추천을 보고 필요하면 [적용]하세요. 경영진주장은 양식 작성사례의 기본값에서 시작합니다(
        {ASSERTIONS.map((a) => `${a} ${ASR_NAME[a]}`).join(' · ')}).
        {allHints.length > 0 && !readOnly && <button className="btn-sm btn-sm-navy" style={{ marginLeft: 8 }} onClick={applyAll}>규칙 추천 모두 적용 ({allHints.length})</button>}
      </div>
      <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px', marginBottom: 10 }}>
        <b>Ⅰ. 전체 재무제표 수준</b>
        {value.entity.map((x, i) => row('entity', x, i))}
      </div>
      <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px' }}>
        <b>Ⅱ. 거래유형·계정잔액·공시(경영진주장 수준)</b>
        <span style={{ color: 'var(--ink-3)', marginLeft: 6 }}>{value.accounts.length}개 · 유의적 {value.accounts.filter((x) => x.sig === 'Y').length}</span>
        {value.accounts.map((x, i) => row('accounts', x, i))}
        {!readOnly && (
          <button className="btn-sm" style={{ marginTop: 8 }}
            onClick={() => onChange({ ...value, accounts: [...value.accounts, { label: '새 계정', sig: 'N', asr: defaultAssertions(''), basis: '일반적인 위험', proc: '' }] })}>
            + 계정 추가
          </button>
        )}
      </div>
    </div>
  );
}
