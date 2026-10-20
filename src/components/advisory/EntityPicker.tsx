// 거래처 선택 — 입력해서 찾고(이름·코드·사업장명·사업자번호) 목록에서 고른다. ↑↓ 이동, Enter 선택, Esc 닫기.
//  후보는 거래처관리(biz_entity) 전체.
import { useMemo, useRef, useState } from 'react';
import type { EntityIndexRow } from '../../lib/bizRegistryApi';

interface Props {
  entities: EntityIndexRow[];
  loading?: boolean;
  value: string;
  onChange: (id: string) => void;
}

const norm = (s: string) => s.replace(/[\s\-()㈜㈲]/g, '').toLowerCase();

export default function EntityPicker({ entities, loading, value, onChange }: Props) {
  const sel = entities.find((e) => e.id === value) ?? null;
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = norm(text);
    if (!q) return entities;
    return entities.filter((e) =>
      norm(e.display).includes(q) || norm(e.code).includes(q) ||
      e.places.some((p) => norm(p.name).includes(q) || (p.bizRegNo && p.bizRegNo.replace(/-/g, '').includes(q))));
  }, [entities, text]);

  const label = sel ? `${sel.display} (${sel.code})` : text;
  // 고른 뒤 포커스가 남은 채 다시 치면, 고른 이름 뒤에 붙지 않고 새 검색어로 시작한다.
  const typed = (v: string) => (!open && sel && v.startsWith(label) ? v.slice(label.length) : v);

  const pick = (e: EntityIndexRow) => { onChange(e.id); setText(''); setOpen(false); };

  const scrollTo = (i: number) => {
    const el = listRef.current?.children[i] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  };

  const onKey = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setOpen(true); const n = Math.min(hi + 1, matches.length - 1); setHi(n); scrollTo(n); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); const n = Math.max(hi - 1, 0); setHi(n); scrollTo(n); }
    else if (ev.key === 'Enter') { if (open && matches[hi]) { ev.preventDefault(); pick(matches[hi]); } }
    else if (ev.key === 'Escape') { setOpen(false); setText(''); }
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        value={open ? text : label}
        placeholder={loading ? '불러오는 중…' : `거래처명·코드·사업자번호로 검색 (${entities.length}곳)`}
        disabled={loading}
        onFocus={() => { setOpen(true); setText(''); setHi(0); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onClick={() => { if (!open) { setOpen(true); setText(''); setHi(0); } }}
        onChange={(e) => { setText(typed(e.target.value)); setOpen(true); setHi(0); if (value) onChange(''); }}
        onKeyDown={onKey}
      />
      {open && (
        <div
          ref={listRef}
          style={{
            position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', marginTop: 2,
            maxHeight: 280, overflowY: 'auto', background: 'var(--card, #fff)',
            border: '1px solid var(--line, #d1d5db)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,.12)',
          }}
        >
          {matches.length === 0 ? (
            <div style={{ padding: '8px 10px', color: 'var(--ink-3)', fontSize: 'var(--fs-2)' }}>
              일치하는 거래처가 없습니다 — 거래처관리에 등록돼 있는지 확인하세요.
            </div>
          ) : matches.map((e, i) => {
            const placeNames = e.places.map((p) => p.name).filter((n) => n && n !== e.name);
            return (
              <div
                key={e.id}
                onMouseDown={(ev) => { ev.preventDefault(); pick(e); }}
                onMouseEnter={() => setHi(i)}
                style={{
                  padding: '6px 10px', cursor: 'pointer', fontSize: 'var(--fs-2)',
                  background: i === hi ? 'var(--hover, #eef2ff)' : undefined,
                }}
              >
                <span style={{ color: 'var(--ink-3)', marginRight: 6 }}>{e.code}</span>
                {e.display}
                {e.kind === '개인' && <span style={{ color: 'var(--ink-3)' }}> · 개인</span>}
                {placeNames.length > 0 && (
                  <span style={{ color: 'var(--ink-3)' }}> · {placeNames.slice(0, 3).join(', ')}{placeNames.length > 3 ? ` 외 ${placeNames.length - 3}` : ''}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
