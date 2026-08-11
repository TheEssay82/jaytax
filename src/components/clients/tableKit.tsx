// 거래처관리 표(list) 공용 kit — 세로 스크롤 + 헤더 고정 + 컬럼 필터(드롭다운/텍스트) + 컬럼 너비 조절.
// 거래처등록·매출계약등록·거래처담당자·거래처현황 표에서 동일한 동작을 공유한다.
import React, { useState } from 'react';

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
