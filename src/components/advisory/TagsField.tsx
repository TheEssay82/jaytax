// 상담 키워드 해시태그 — 편집기(추가/삭제)와 표시/필터 칩.
import { useState } from 'react';

const chip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600,
  color: '#1A2B52', background: '#eef1f7', border: '1px solid #d6ddec', borderRadius: 12, padding: '2px 8px',
};

/** 정규화: 앞 #/공백 제거, 20자 제한. */
function norm(s: string): string {
  return s.replace(/^#+/, '').trim().slice(0, 20);
}

/** 편집 가능한 태그 입력 — 칩 + 입력(Enter/쉼표로 추가). */
export function TagEditor({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('');

  function add(raw: string) {
    const t = norm(raw);
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft('');
  }
  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', border: '1px solid #e4e0d8', borderRadius: 8, padding: '6px 8px', background: '#fff' }}>
      {value.map((t) => (
        <span key={t} style={chip}>
          #{t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label="제거"
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9aa0ad', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => draft && add(draft)}
        placeholder={value.length ? '태그 추가…' : '예: 수익인식, 매입세액공제 (Enter로 추가)'}
        style={{ flex: 1, minWidth: 140, border: 'none', outline: 'none', fontSize: 12.5, background: 'transparent', padding: '2px 0' }}
      />
    </div>
  );
}

/** 읽기 전용 태그 칩 — onSelect 주면 클릭 필터로 동작. */
export function TagList({ tags, onSelect, active }: { tags: string[]; onSelect?: (t: string) => void; active?: string | null }) {
  if (!tags.length) return null;
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 5 }}>
      {tags.map((t) => {
        const on = active === t;
        return (
          <span
            key={t}
            onClick={onSelect ? () => onSelect(t) : undefined}
            style={{
              ...chip,
              cursor: onSelect ? 'pointer' : 'default',
              ...(on ? { background: '#1A2B52', color: '#fff', borderColor: '#1A2B52' } : null),
            }}
          >
            #{t}
          </span>
        );
      })}
    </span>
  );
}
