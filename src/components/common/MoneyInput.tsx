// 금액 칸 — 세 자리마다 쉼표(사용자 2026-10-19). 고칠 때만 숫자로 풀고, 나가면 다시 쉼표.
// 경비귀속처리에서 시작해 기장배분도 같이 쓴다.
import { useEffect, useState } from 'react';

const won = (n: number) => Math.round(n).toLocaleString();

export default function MoneyInput({ value, onCommit, width = 96, disabled }: { value: number | null; onCommit: (v: number | null) => void; width?: number; disabled?: boolean }) {
  const [txt, setTxt] = useState(value == null ? '' : won(value));
  useEffect(() => { setTxt(value == null ? '' : won(value)); }, [value]);
  return (
    <input inputMode="numeric" value={txt} disabled={disabled}
      onFocus={() => setTxt(value == null ? '' : String(value))}
      onChange={(e) => setTxt(e.target.value.replace(/[^0-9-]/g, ''))}
      onBlur={() => { const v = txt.trim() === '' ? null : Number(txt.replace(/,/g, '')); setTxt(v == null ? '' : won(v)); if (v !== value) onCommit(v); }}
      style={{ width, textAlign: 'right', fontFamily: 'inherit', fontSize: 'var(--fs-1)', padding: '2px 4px', border: '1px solid var(--rule)', borderRadius: 3 }} />
  );
}
