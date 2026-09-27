// 2110A 업무분장표 입력 — 절차마다 중간감사·기말감사·검토 담당자. 해마다 거의 같아 「확인」이 주된 일이다.
import type { Paper2110A, AssignRow } from '../../lib/gwpPaper2110A';

export default function Form2110A({ value, onChange, readOnly, partner, author, onReset }: {
  value: Paper2110A;
  onChange: (v: Paper2110A) => void;
  readOnly: boolean;
  partner: string;
  author: string | null;
  /** 최신 엑셀 판의 값으로 되돌린다 */ onReset?: () => void;
}) {
  const names = [...new Set([partner, author ?? '', ...value.rows.flatMap((r) => [r.mid, r.fin, r.rev])].filter((x) => x && x !== 'N/A'))];
  const set = (i: number, patch: Partial<AssignRow>) => onChange({ rows: value.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const all = (patch: (r: AssignRow) => Partial<AssignRow>) => onChange({ rows: value.rows.map((r) => (r.heading ? r : { ...r, ...patch(r) })) });
  const cell = (i: number, k: 'mid' | 'fin' | 'rev', v: string) => (
    <input className="btn-sm" list="gwp-2110a-names" value={v} disabled={readOnly} style={{ width: '100%', minWidth: 0 }}
      onChange={(e) => set(i, { [k]: e.target.value })} />
  );
  if (!value.rows.length) return <div style={{ color: 'var(--warn)' }}>조서에서 「중간감사 · 기말감사 · 검토」 표를 찾지 못했습니다.</div>;

  return (
    <div>
      <datalist id="gwp-2110a-names">{[...names, 'N/A'].map((n) => <option key={n} value={n} />)}</datalist>
      <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7, marginBottom: 8 }}>
        작년 값을 그대로 불러왔습니다. 바뀐 사람이 없으면 그대로 <b>「확인하고 엑셀에 반영」</b>을 누르세요(탭이 초록이 됩니다).
      </div>
      {!readOnly && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <button className="btn-sm" onClick={() => all((r) => (r.rev && r.rev !== 'N/A' ? { rev: partner } : {}))}>검토를 모두 {partner}로</button>
          <button className="btn-sm" onClick={() => all((r) => (r.mid && !r.fin ? { fin: r.mid } : {}))}>빈 기말감사 칸 = 중간감사 담당</button>
          {onReset && <button className="btn-sm" onClick={onReset}>엑셀(최신 판) 값으로 되돌리기</button>}
        </div>
      )}
      <table className="tbl">
        <thead><tr style={{ background: 'var(--surface-2)' }}>
          <th>감사 절차</th><th style={{ width: 130 }}>중간감사</th><th style={{ width: 130 }}>기말감사</th><th style={{ width: 130 }}>검토</th>
          {!readOnly && <th style={{ width: 54 }}></th>}
        </tr></thead>
        <tbody>
          {value.rows.map((r, i) => r.heading ? (
            <tr key={i}><td colSpan={readOnly ? 4 : 5} style={{ fontWeight: 700, background: 'var(--surface-2)' }}>{r.label}</td></tr>
          ) : (
            <tr key={i} style={{ opacity: r.mid === 'N/A' && r.fin === 'N/A' ? 0.55 : 1 }}>
              <td>{r.label}</td>
              <td>{cell(i, 'mid', r.mid)}</td>
              <td>{cell(i, 'fin', r.fin)}</td>
              <td>{cell(i, 'rev', r.rev)}</td>
              {!readOnly && (
                <td><button className="btn-sm" title="이 절차를 하지 않음(N/A)" onClick={() => set(i, { mid: 'N/A', fin: 'N/A', rev: 'N/A' })}>N/A</button></td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
