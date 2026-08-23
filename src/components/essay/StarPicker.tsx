// 별 1~5개 선택. 클릭으로 고르고 '확정'을 눌러야 반영된다(확정 전에는 몇 번이든 바꿀 수 있다).
import { useState } from 'react';

const STAR_PATH =
  'M12 2.6l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.4l-5.8 3.06 1.11-6.46-4.7-4.58 6.49-.94L12 2.6z';

type Props = {
  value: number;
  onChange: (v: number) => void;
  accent: string;
  soft: string;
  size?: number;
  disabled?: boolean;
};

export default function StarPicker({ value, onChange, accent, soft, size = 40, disabled }: Props) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;

  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= shown;
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            aria-label={`별 ${n}개`}
            aria-pressed={value === n}
            onMouseEnter={() => !disabled && setHover(n)}
            onFocus={() => !disabled && setHover(n)}
            onClick={() => !disabled && onChange(n)}
            style={{
              background: 'none',
              border: 'none',
              padding: 2,
              cursor: disabled ? 'default' : 'pointer',
              lineHeight: 0,
              transition: 'transform .12s ease',
              transform: on && hover === n ? 'scale(1.12)' : 'none',
            }}
          >
            <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
              <path
                d={STAR_PATH}
                fill={on ? accent : 'none'}
                stroke={on ? accent : soft}
                strokeWidth={1.3}
                strokeLinejoin="round"
                opacity={on ? 1 : 0.65}
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
