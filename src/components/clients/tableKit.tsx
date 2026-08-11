// 거래처관리 표(list) 공용 kit — 세로 스크롤 + 헤더 고정 + 컬럼 필터(드롭다운/텍스트).
// 거래처등록·매출계약등록·거래처담당자·거래처현황 표에서 동일한 동작을 공유한다.
import React from 'react';

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
