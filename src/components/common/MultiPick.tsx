// 여럿 고르기 필터 — 엑셀 피벗의 체크박스와 같은 모양.
//
// 왜 이 모양인가: 「전체 켜고 정우철만 끄기」가 되어야 한다(2026-09-06 지시).
// 드롭다운으로는 그것이 안 되므로 **체크 목록**을 쓴다.
import { useEffect, useRef, useState } from 'react';
import {
  fromSelection, isAll, label, selectedSet, type MultiFilter,
} from '../../lib/multiFilter';

export default function MultiPick(
  { title, opts, value, onChange }: {
    title: string; opts: string[]; value: MultiFilter; onChange: (f: MultiFilter) => void;
  },
) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);

  // 바깥을 누르면 닫는다.
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [open]);

  if (!opts.length) return null;

  const sel = selectedSet(value, opts);
  const shown = q ? opts.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : opts;
  const set = (next: Set<string>) => onChange(fromSelection(next, opts));

  return (
    <div className="mp" ref={box}>
      <button className={`mp-btn${isAll(value) ? '' : ' on'}`} onClick={() => setOpen((v) => !v)}
        title={`${title} — 여럿 고르거나 특정 값만 뺄 수 있습니다`}>
        {title} <b>{label(value, opts.length)}</b> <span className="mp-caret">▾</span>
      </button>

      {open && (
        <div className="mp-pop">
          <input className="mp-q" placeholder="찾기" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="mp-acts">
            <button className="btn-sm" onClick={() => set(new Set(opts))}>전체 켜기</button>
            <button className="btn-sm" onClick={() => set(new Set(shown.filter((o) => !sel.has(o))))}
              title="지금 켠 것과 끈 것을 뒤집습니다">뒤집기</button>
            {/* 「모두 끄기」는 두지 않는다 — 아무것도 안 보이는 표는 쓸모가 없고,
                빈 고름은 「전체」와 같아져 오히려 헷갈린다. */}
          </div>
          <div className="mp-list">
            {shown.length === 0 && <div className="mp-empty">찾는 값이 없습니다.</div>}
            {shown.map((o) => (
              <label key={o} className="mp-row">
                <input type="checkbox" checked={sel.has(o)}
                  onChange={() => {
                    const next = new Set(sel);
                    if (next.has(o)) next.delete(o); else next.add(o);
                    // 마지막 하나까지 끄지는 못하게 한다 — 빈 표가 된다.
                    if (next.size === 0) return;
                    set(next);
                  }} />
                <span>{o || <i style={{ color: 'var(--ink-4)' }}>(미지정)</i>}</span>
              </label>
            ))}
          </div>
          <div className="mp-foot">
            {sel.size} / {opts.length} 켜짐
            <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setOpen(false)}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}
