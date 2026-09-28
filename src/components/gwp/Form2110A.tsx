// 2110A 업무분장표 입력 — 절차마다 담당자. 열은 조서 머리 줄 그대로(명진 3열, 알티스트·윤성 7열). 해마다 거의 같아 「확인」이 주된 일이다.
import { isReviewCol, norm2110A, type Paper2110A, type AssignRow } from '../../lib/gwpPaper2110A';

export default function Form2110A({ value: raw, onChange, readOnly, partner, author, onReset }: {
  value: Paper2110A;
  onChange: (v: Paper2110A) => void;
  readOnly: boolean;
  partner: string;
  author: string | null;
  /** 최신 엑셀 판의 값으로 되돌린다 */ onReset?: () => void;
}) {
  const value = norm2110A(raw);
  const { cols } = value;
  const names = [...new Set([partner, author ?? '', ...value.rows.flatMap((r) => r.vals)].filter((x) => x && x !== 'N/A'))];
  const set = (i: number, patch: Partial<AssignRow>) => onChange({ ...value, rows: value.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const setVal = (i: number, k: number, v: string) => set(i, { vals: value.rows[i].vals.map((x, j) => (j === k ? v : x)) });
  const all = (f: (r: AssignRow) => string[]) => onChange({ ...value, rows: value.rows.map((r) => (r.heading ? r : { ...r, vals: f(r) })) });
  const mid = cols.indexOf('중간감사'), fin = cols.indexOf('기말감사');
  if (!value.rows.length) return <div style={{ color: 'var(--warn)' }}>조서에서 「중간감사 · 기말감사」 표를 찾지 못했습니다.</div>;

  return (
    <div>
      <datalist id="gwp-2110a-names">{[...names, 'N/A'].map((n) => <option key={n} value={n} />)}</datalist>
      <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7, marginBottom: 8 }}>
        작년 값을 그대로 불러왔습니다. 바뀐 사람이 없으면 그대로 <b>「확인」</b>을 누르세요(탭이 초록이 됩니다).
      </div>
      {!readOnly && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <button className="btn-sm" onClick={() => all((r) => r.vals.map((v, k) => (isReviewCol(cols[k]) && v && v !== 'N/A' ? partner : v)))}>검토를 모두 {partner}로</button>
          {mid >= 0 && fin >= 0 && (
            <button className="btn-sm" onClick={() => all((r) => r.vals.map((v, k) => (k === fin && !v && r.vals[mid] ? r.vals[mid] : v)))}>빈 기말감사 칸 = 중간감사 담당</button>
          )}
          {onReset && <button className="btn-sm" onClick={onReset}>엑셀(최신 판) 값으로 되돌리기</button>}
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead><tr style={{ background: 'var(--surface-2)' }}>
            <th>감사 절차</th>
            {cols.map((c) => <th key={c} style={{ width: 110 }}>{c}</th>)}
            {!readOnly && <th style={{ width: 54 }}></th>}
          </tr></thead>
          <tbody>
            {value.rows.map((r, i) => r.heading ? (
              <tr key={i}><td colSpan={cols.length + (readOnly ? 1 : 2)} style={{ fontWeight: 700, background: 'var(--surface-2)' }}>{r.label}</td></tr>
            ) : (
              <tr key={i} style={{ opacity: r.vals.every((v) => !v || v === 'N/A') && r.vals.some((v) => v === 'N/A') ? 0.55 : 1 }}>
                <td>{r.label}</td>
                {cols.map((c, k) => (
                  <td key={c}>
                    <input className="btn-sm" list="gwp-2110a-names" value={r.vals[k] ?? ''} disabled={readOnly} style={{ width: '100%', minWidth: 70 }}
                      onChange={(e) => setVal(i, k, e.target.value)} />
                  </td>
                ))}
                {!readOnly && (
                  <td><button className="btn-sm" title="이 절차를 하지 않음(N/A) — 비어 있는 분기·반기 검토 칸은 그대로" onClick={() => set(i, { vals: r.vals.map((v, k) => (v || k === mid || k === fin || isReviewCol(cols[k]) ? 'N/A' : v)) })}>N/A</button></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
