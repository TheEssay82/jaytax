// 연·월·일을 칸을 나눠 받는 날짜 입력.
//
// 브라우저의 <input type="date"> 는 Enter 로 다음 자리로 못 넘어간다(Tab·방향키만). 실무자는 숫자패드로
// 연 → Enter → 월 → Enter → 일 을 치고 싶어 한다(2026-09-21 요청). 그래서 칸을 셋(월 모드는 둘)으로 나누고
//   · Enter 를 치면 다음 칸으로, 마지막 칸이면 화면의 다음 입력으로 넘어간다(Tab 과 같은 동작)
//   · 자릿수를 다 치면(연 4·월 2·일 2) 저절로 다음 칸으로 간다
//   · 값은 여전히 'YYYY-MM-DD'(월 모드 'YYYY-MM') 문자열 하나로 주고받는다 — 저장 로직은 그대로다
// 붙여넣기(2026-09-21 · 20260921)는 연 칸에 넣으면 알아서 나눈다.
import { useEffect, useRef, useState } from 'react';
import { composeDateParts, type DatePartsMode as Mode } from '../../lib/dateParts';

const digits = (s: string) => s.replace(/\D/g, '');
const pad2 = (s: string) => (s.length === 1 ? '0' + s : s);

function split(value: string, mode: Mode): [string, string, string] {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value || '');
  if (!m) return ['', '', ''];
  return [m[1], m[2], mode === 'date' ? (m[3] ?? '') : ''];
}
/** Tab 처럼 — 문서에서 다음으로 초점을 받을 수 있는 요소로 옮긴다. */
function focusNext(from: HTMLElement) {
  const all = Array.from(document.querySelectorAll<HTMLElement>(
    'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((el) => el.offsetParent !== null);
  const i = all.indexOf(from);
  const next = all[i + 1];
  if (next) { next.focus(); if (next instanceof HTMLInputElement) next.select(); }
}

export default function DateParts({ value, onChange, mode = 'date', disabled, style, title }: {
  value: string; onChange: (v: string) => void; mode?: Mode; disabled?: boolean; style?: React.CSSProperties; title?: string;
}) {
  const [y, setY] = useState(''); const [m, setM] = useState(''); const [d, setD] = useState('');
  const yRef = useRef<HTMLInputElement>(null); const mRef = useRef<HTMLInputElement>(null); const dRef = useRef<HTMLInputElement>(null);

  // 바깥 값이 바뀌면(폼 초기화·다른 건 열기) 칸을 맞춘다. 치는 중(미완성)에는 건드리지 않는다.
  useEffect(() => {
    if (composeDateParts(y, m, d, mode) === (value || '')) return;
    const [a, b, c] = split(value, mode);
    setY(a); setM(b); setD(c);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const emit = (ny: string, nm: string, nd: string) => onChange(composeDateParts(ny, nm, nd, mode));
  const refs = mode === 'date' ? [yRef, mRef, dRef] : [yRef, mRef];
  const goNext = (idx: number) => {
    const next = refs[idx + 1]?.current;
    if (next) { next.focus(); next.select(); } else if (refs[idx].current) focusNext(refs[idx].current!);
  };
  const onKey = (idx: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); goNext(idx); }
  };

  const onYear = (raw: string) => {
    // 통째로 붙여넣은 날짜는 나눠 담는다.
    const ds = digits(raw);
    if (raw.includes('-') || ds.length >= 6) {
      const ny = ds.slice(0, 4), nm = ds.slice(4, 6), nd = mode === 'date' ? ds.slice(6, 8) : '';
      setY(ny); setM(nm); setD(nd); emit(ny, nm, nd);
      if (mode === 'date' && nd.length < 2) dRef.current?.focus(); else if (nm.length < 2) mRef.current?.focus(); else goNext(refs.length - 1);
      return;
    }
    const ny = ds.slice(0, 4);
    setY(ny); emit(ny, m, d);
    if (ny.length === 4) goNext(0);
  };
  const onMonth = (raw: string) => {
    const nm = digits(raw).slice(0, 2);
    setM(nm); emit(y, nm, d);
    if (nm.length === 2 || Number(nm) > 1) goNext(1);
  };
  const onDay = (raw: string) => {
    const nd = digits(raw).slice(0, 2);
    setD(nd); emit(y, m, nd);
    if (nd.length === 2 || Number(nd) > 3) goNext(2);
  };
  // 칸을 떠날 때 한 자리 숫자는 0 을 붙여 보이게 한다(값은 이미 같다).
  const tidyM = () => { if (m.length === 1 && Number(m) > 0) setM(pad2(m)); };
  const tidyD = () => { if (d.length === 1 && Number(d) > 0) setD(pad2(d)); };

  const cell: React.CSSProperties = { textAlign: 'center', padding: '2px 3px' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, ...style }} title={title}>
      <input ref={yRef} value={y} onChange={(e) => onYear(e.target.value)} onKeyDown={onKey(0)}
        placeholder="연" inputMode="numeric" maxLength={10} disabled={disabled} style={{ ...cell, width: 54 }} aria-label="연" />
      <span style={{ color: 'var(--ink-4)' }}>-</span>
      <input ref={mRef} value={m} onChange={(e) => onMonth(e.target.value)} onKeyDown={onKey(1)} onBlur={tidyM}
        placeholder="월" inputMode="numeric" maxLength={2} disabled={disabled} style={{ ...cell, width: 34 }} aria-label="월" />
      {mode === 'date' && (
        <>
          <span style={{ color: 'var(--ink-4)' }}>-</span>
          <input ref={dRef} value={d} onChange={(e) => onDay(e.target.value)} onKeyDown={onKey(2)} onBlur={tidyD}
            placeholder="일" inputMode="numeric" maxLength={2} disabled={disabled} style={{ ...cell, width: 34 }} aria-label="일" />
        </>
      )}
    </span>
  );
}
