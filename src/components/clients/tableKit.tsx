// 거래처관리 표(list) 공용 kit — 세로 스크롤 + 헤더 고정 + 컬럼 필터(드롭다운/텍스트)
// + 컬럼 너비 조절 + 컬럼 숨김 + 개인별 화면설정 저장.
// 거래처등록·매출계약등록·거래처담당자·거래처현황 표에서 동일한 동작을 공유한다.
import React, { useCallback, useEffect, useState } from 'react';
import { loadTableView, saveTableView, clearTableView, EMPTY_VIEW, type TableViewSettings } from '../../lib/tableViewApi';

/**
 * 컬럼 너비 조절 훅 — 헤더 우측 핸들을 드래그해 폭을 바꾼다(table-layout:fixed + colgroup 전제).
 * widthOf(key, 기본값)로 현재 폭을, startResize(key, 현재폭)으로 드래그 핸들러를 얻는다.
 */
export function useColWidths() {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const widthOf = (key: string, fallback = 90) => widths[key] ?? fallback;
  const startResize = (key: string, cur: number) => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const onMove = (ev: MouseEvent) => setWidths((w) => ({ ...w, [key]: Math.max(36, Math.round(cur + (ev.clientX - startX))) }));
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
  };
  return { widthOf, startResize };
}

/** 헤더 셀 우측 너비조절 핸들. th 는 position:relative 여야 한다. */
export function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <span onMouseDown={onMouseDown} onClick={(e) => e.stopPropagation()} title="드래그로 너비 조절"
      style={{ position: 'absolute', top: 0, right: 0, width: 7, height: '100%', cursor: 'col-resize', userSelect: 'none' }} />
  );
}
/** table-layout:fixed 셀에서 내용이 폭을 넘으면 …로 줄이는 스타일. */
export const clip: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis' };

/** 세로·가로 스크롤 컨테이너. 헤더는 내부 sticky로 고정. */
export const scrollBox = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  overflow: 'auto', maxHeight: '68vh', border: '1px solid #eee', borderRadius: 6, ...extra,
});

/** sticky 헤더 th 스타일(스크롤 시 상단 고정). top=행 오프셋(px), bg=배경(스크롤 내용 가림용). */
export const stickyTop = (top: number, bg: string, extra: React.CSSProperties = {}): React.CSSProperties => ({
  position: 'sticky', top, zIndex: 2, background: bg, ...extra,
});

/** 컬럼 필터 입력 — opts 있으면 드롭다운(값 선택), 없으면 텍스트(부분일치). */
export function ColFilter({ value, onChange, opts }: { value: string; onChange: (v: string) => void; opts?: readonly string[] }) {
  if (opts && opts.length) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} style={selStyle}>
        <option value="">전체</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="필터" style={inputStyle} />;
}

const inputStyle: React.CSSProperties = { width: '100%', fontSize: 10.5, padding: '2px 4px', boxSizing: 'border-box' };
const selStyle: React.CSSProperties = { width: '100%', fontSize: 10.5, padding: '2px 2px', boxSizing: 'border-box' };

/**
 * 표뷰 화면설정 훅 — 열 너비 + 숨김을 함께 들고, 계정에 저장/복원한다.
 *
 * useColWidths 를 대체한다(너비만 쓰던 화면은 그대로 둬도 된다).
 * 저장은 명시적이다 — 드래그·숨김은 화면에서 바로 먹지만, 다음에도 그렇게 열리려면
 * '설정 저장'을 눌러야 한다. 실수로 만진 폭이 영구히 남는 게 더 불편해서다.
 */
export function useTableView(viewKey: string) {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<TableViewSettings>(EMPTY_VIEW);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadTableView(viewKey)
      .then((s) => {
        if (!alive) return;
        if (s) { setWidths(s.widths); setHidden(new Set(s.hidden)); setSaved(s); }
        setLoaded(true);
      })
      .catch(() => { if (alive) setLoaded(true); });   // 설정을 못 읽어도 표는 기본값으로 뜬다
    return () => { alive = false; };
  }, [viewKey]);

  const widthOf = (key: string, fallback = 90) => widths[key] ?? fallback;
  const isHidden = (key: string) => hidden.has(key);
  const toggleHidden = (key: string) =>
    setHidden((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const showAll = () => setHidden(new Set());

  const startResize = (key: string, cur: number) => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const onMove = (ev: MouseEvent) => setWidths((w) => ({ ...w, [key]: Math.max(36, Math.round(cur + (ev.clientX - startX))) }));
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
  };

  const current = useCallback((): TableViewSettings => ({ widths, hidden: [...hidden].sort() }), [widths, hidden]);
  const dirty = JSON.stringify(current()) !== JSON.stringify({ widths: saved.widths, hidden: [...saved.hidden].sort() });

  const save = async () => { const s = current(); await saveTableView(viewKey, s); setSaved(s); };
  /** 저장분까지 지우고 기본 화면으로. */
  const reset = async () => {
    await clearTableView(viewKey);
    setWidths({}); setHidden(new Set()); setSaved(EMPTY_VIEW);
  };

  return { widthOf, startResize, isHidden, toggleHidden, showAll, hiddenCount: hidden.size, dirty, save, reset, loaded };
}

/**
 * 열 설정 패널 — 열 체크로 숨기고/보이고, 개인 설정으로 저장한다.
 * cols 는 표가 쓰는 컬럼 정의 그대로(키·라벨만 본다).
 */
export function ColumnSettings({ cols, view, onMessage }: {
  cols: readonly { key: string; label: string }[];
  view: ReturnType<typeof useTableView>;
  onMessage?: (t: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try { await fn(); onMessage?.(ok); }
    catch (e) { alert('실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  };

  return (
    <span style={{ position: 'relative' }}>
      <button className="btn-sm btn-sm-blue" onClick={() => setOpen((v) => !v)}
        title="열 숨김·너비를 정하고 내 계정에 저장합니다">
        ⚙️ 열 설정{view.hiddenCount ? ` (${view.hiddenCount} 숨김)` : ''}{view.dirty ? ' •' : ''}
      </button>
      {open && (
        <>
          <span onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 40, display: 'block' }} />
          <div style={{
            position: 'absolute', top: '110%', left: 0, zIndex: 41, background: '#fff',
            border: '1px solid #ddd', borderRadius: 6, boxShadow: '0 6px 20px rgba(0,0,0,.12)',
            padding: 10, minWidth: 230, maxHeight: '60vh', overflow: 'auto', textAlign: 'left',
          }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 6, lineHeight: 1.5 }}>
              체크를 풀면 그 열이 숨겨집니다. 너비는 머리글 오른쪽 끝을 끌어 조절합니다.<br />
              <b>설정 저장</b>을 눌러야 다음에도 이 모습으로 열립니다.
            </div>
            {cols.map((c) => (
              <label key={c.key} style={{ display: 'block', fontSize: 12, padding: '2px 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={!view.isHidden(c.key)} onChange={() => view.toggleHidden(c.key)} />
                {' '}{c.label}
              </label>
            ))}
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="btn-sm btn-sm-blue" disabled={busy || !view.hiddenCount} onClick={view.showAll}>
                모든 열 보이기
              </button>
              <button className="btn-p" disabled={busy || !view.dirty}
                onClick={() => void run(view.save, '✓ 화면설정을 저장했습니다')}>
                설정 저장
              </button>
              <button className="btn-sm" disabled={busy}
                onClick={() => void run(view.reset, '✓ 기본 화면으로 되돌렸습니다')}>
                기본값으로
              </button>
            </div>
          </div>
        </>
      )}
    </span>
  );
}
