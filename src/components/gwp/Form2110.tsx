// 2110 감사계획의 수립 입력 — 감사팀 구성(수행자·파악한 내용)·감사일정·실사장소·보고서 예정일.
import type { Paper2110 } from '../../lib/gwpPaper2110';

export default function Form2110({ value, onChange, readOnly, fy, author }: {
  value: Paper2110;
  onChange: (v: Paper2110) => void;
  readOnly: boolean;
  /** 당기 사업연도 — 작년 날짜가 남은 칸을 알려 준다 */ fy: number;
  author: string | null;
}) {
  const v = value;
  const set = (p: Partial<Paper2110>) => onChange({ ...v, ...p });
  const old = (s: string) => {
    const ys = [...s.matchAll(/(20\d{2})/g)].map((m) => Number(m[1]));
    return ys.length > 0 && Math.max(...ys) < fy;
  };
  const box: React.CSSProperties = { border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', marginBottom: 10 };
  const inp = (val: string, on: (s: string) => void, w?: number) => (
    <input className="btn-sm" value={val} disabled={readOnly} onChange={(e) => on(e.target.value)}
      style={{ width: w ?? '100%', borderColor: old(val) ? 'var(--warn)' : undefined }} />
  );
  const anyOld = [...v.schedule, ...v.sites].some((x) => old(x.value)) || old(v.reportDue);

  return (
    <div style={{ fontSize: 'var(--fs-2)' }}>
      {!readOnly && author && (
        <div style={{ marginBottom: 8 }}>
          <button className="btn-sm" onClick={() => set({ team: v.team.map((t) => ({ ...t, performer: author })), contractPerformer: author })}>
            수행자를 모두 {author}로
          </button>
        </div>
      )}
      <div style={box}>
        <b>감사팀의 구성</b>
        {v.team.map((t, i) => (
          <div key={i} style={{ marginTop: 8 }}>
            <div style={{ color: 'var(--ink-2)', lineHeight: 1.5 }}>{t.label}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 100px 90px', gap: 6, marginTop: 4, alignItems: 'center' }}>
              <span>파악한 내용</span>
              {inp(t.text, (s) => set({ team: v.team.map((x, j) => (j === i ? { ...x, text: s } : x)) }))}
              <span style={{ textAlign: 'right' }}>별도 조서번호</span>
              {inp(t.ref, (s) => set({ team: v.team.map((x, j) => (j === i ? { ...x, ref: s } : x)) }))}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
              <span style={{ width: 64 }}>수행자</span>{inp(t.performer, (s) => set({ team: v.team.map((x, j) => (j === i ? { ...x, performer: s } : x)) }), 120)}
            </div>
          </div>
        ))}
      </div>

      <div style={box}>
        <b>감사계획 수립의 확인</b>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
          주요감사계약 확인 수행자 {inp(v.contractPerformer, (s) => set({ contractPerformer: s }), 120)}
          <span style={{ marginLeft: 12 }}>감사목적과 범위</span>
          {(['일반', '임의'] as const).map((k) => (
            <label key={k} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="radio" checked={v.scope === k} disabled={readOnly} onChange={() => set({ scope: k })} />{k}
            </label>
          ))}
        </div>
        {anyOld && <div style={{ color: 'var(--warn)', marginTop: 6 }}>주황 테두리 칸은 작년 날짜가 남아 있습니다 — 올해 일정으로 고치세요.</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 6, marginTop: 8, alignItems: 'center' }}>
          {v.schedule.map((x, i) => (
            <FragmentRow key={x.label} label={x.label}>
              {inp(x.value, (s) => set({ schedule: v.schedule.map((y, j) => (j === i ? { ...y, value: s } : y)) }))}
            </FragmentRow>
          ))}
          {v.sites.map((x, i) => (
            <FragmentRow key={x.label} label={`실사장소 · ${x.label}`}>
              {inp(x.value, (s) => set({ sites: v.sites.map((y, j) => (j === i ? { ...y, value: s } : y)) }))}
            </FragmentRow>
          ))}
          <FragmentRow label="보고서 제출 예정일">{inp(v.reportDue, (s) => set({ reportDue: s }))}</FragmentRow>
          <FragmentRow label="부수">
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>국문 {inp(v.copiesKo, (s) => set({ copiesKo: s }), 60)} 부 · 영문 {inp(v.copiesEn, (s) => set({ copiesEn: s }), 60)} 부</span>
          </FragmentRow>
        </div>
      </div>
    </div>
  );
}

function FragmentRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <><span>{label}</span><span>{children}</span></>;
}
