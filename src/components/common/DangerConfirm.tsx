/**
 * 되돌릴 수 없는 확인창.
 *
 * 왜 만드는가: 브라우저 기본 `confirm()` 은 「청구예정에서 3건을 지웁니다」와
 * 「보존기간이 지난 1,240건을 파기합니다」가 **생김새가 똑같다**. 글이 길면 잘리고,
 * 대상 이름이 문장 속에 묻힌다. 손이 먼저 움직이는 자리라 무게가 다르면 화면도 달라야 한다.
 *
 * 세 단계 — 판단 규칙은 `lib/danger.ts` 에 있다.
 *   delete  붉은 창에 **대상 이름을 크게**. 눈이 한 번 지나간다.
 *   bulk    같은 창에 **목록**을 편다. 몇 건인지 세고 넘어가게.
 *   purge   대상 이름을 **그대로 받아 적어야** 단추가 열린다. 파기·영구삭제·초기화.
 *
 * 쓰는 쪽은 `confirm()` 자리에 그대로 갈아 끼우면 된다 —
 *   `if (!await confirmDanger({ title: '…', target: name })) return;`
 * 창을 상태로 들고 있을 필요가 없다. 다만 **호출부가 async 여야 한다.**
 */
import { useEffect, useRef, useState } from 'react';
import { canProceed, needsTyping, splitList, targetLine, wordToType, type DangerAsk } from '../../lib/danger';
import { useEscape } from '../../lib/useEscape';

// ── 부르는 쪽에서 쓰는 것 ────────────────────────────────────────────────
type Pending = { ask: DangerAsk; resolve: (ok: boolean) => void };
let put: ((p: Pending | null) => void) | null = null;

/**
 * 확인창을 띄우고 **답을 기다린다.** 진행이면 true.
 *
 * 창을 그릴 자리(`<DangerConfirmHost/>`)가 아직 없으면 브라우저 기본 창으로 내려간다 —
 * 확인을 통째로 건너뛰어 그냥 지워 버리는 것보다 낫다.
 */
export function confirmDanger(ask: DangerAsk): Promise<boolean> {
  if (!put) {
    const line = targetLine(ask);
    return Promise.resolve(window.confirm([ask.title, line && `\n${line}`, ask.detail && `\n${ask.detail}`]
      .filter(Boolean).join('')));
  }
  return new Promise<boolean>((resolve) => put!({ ask, resolve }));
}

// ── 창을 그릴 자리 — AppShell 맨 바깥에 하나만 둔다 ──────────────────────
export function DangerConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    put = setPending;
    return () => { put = null; };
  }, []);
  if (!pending) return null;
  return (
    <Dialog
      // 창이 바뀔 때 입력칸을 비우려면 새로 그려야 한다.
      key={pending.ask.title + (pending.ask.target ?? '')}
      ask={pending.ask}
      done={(ok) => { pending.resolve(ok); setPending(null); }}
    />
  );
}

const RED = '#B91C1C';
const RED_BG = '#FEF2F2';
const RED_RULE = '#FCA5A5';

function Dialog({ ask, done }: { ask: DangerAsk; done: (ok: boolean) => void }) {
  const [typed, setTyped] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEscape(() => done(false));

  const typing = needsTyping(ask);
  const word = wordToType(ask);
  const ok = canProceed(ask, typed);
  const line = targetLine(ask);
  const { shown, more } = splitList(ask.targets);
  // 목록은 두 건 이상일 때만 편다 — 한 건이면 위의 굵은 줄과 같은 말이 된다.
  const list = shown.length > 1 ? shown : [];

  // **처음 초점은 '그만두기'에 둔다.** Enter 를 습관적으로 치는 손이 진행으로 가면 안 된다.
  // 받아 적는 창만 입력칸으로 — 어차피 글자를 채워야 열린다.
  useEffect(() => { (typing ? inputRef.current : cancelRef.current)?.focus(); }, [typing]);

  return (
    <div
      className="modal-overlay"
      style={{ zIndex: 9600 }}   // 창 위에 뜨는 창이라 기본(9000)보다 위
      onClick={() => done(false)}
      role="alertdialog"
      aria-modal="true"
    >
      <div
        className="modal-box"
        style={{ maxWidth: 460, width: '92vw', padding: 0, overflow: 'hidden', borderTop: `4px solid ${RED}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px 14px' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 18, lineHeight: 1.2 }} aria-hidden>⚠️</span>
            <div style={{ fontSize: 'var(--fs-4)', fontWeight: 700, color: RED, lineHeight: 1.45 }}>
              {ask.title}
            </div>
          </div>

          {line && (
            <div
              style={{
                marginTop: 12, padding: '9px 12px', background: RED_BG,
                border: `1px solid ${RED_RULE}`, borderRadius: 'var(--r)',
                fontSize: 'var(--fs-3)', fontWeight: 700, color: 'var(--ink)', wordBreak: 'break-all',
              }}
            >
              {line}
            </div>
          )}

          {list.length > 0 && (
            <ul style={{ margin: '8px 0 0', padding: '0 0 0 18px', fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7 }}>
              {list.map((t, i) => <li key={i} style={{ wordBreak: 'break-all' }}>{t}</li>)}
              {more > 0 && <li style={{ color: 'var(--ink-3)', listStyle: 'none', marginLeft: -18 }}>… 외 {more}건</li>}
            </ul>
          )}

          {ask.detail && (
            <div style={{ marginTop: 10, fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
              {ask.detail}
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: 'var(--fs-2)', fontWeight: 600, color: RED }}>
            되돌릴 수 없습니다.
          </div>

          {typing && (
            <label style={{ display: 'block', marginTop: 14 }}>
              {/* **조사를 붙이지 않는다.** 받아 적을 글자는 이름일 수도, 「3개 삭제」일 수도,
                  연월일 수도 있다. 받침에 따라 을/를이 갈리므로(김효주를 · 이도현을) 어떤
                  하나를 박아 두면 절반은 틀린다. 글자는 아래 줄에 따로 놓는다. */}
              <span style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)' }}>
                확인을 위해 아래 글자를 그대로 입력하세요
              </span>
              <div style={{ marginTop: 4, fontSize: 'var(--fs-3)', fontWeight: 700, color: 'var(--ink)', wordBreak: 'break-all' }}>
                {word}
              </div>
              <input
                ref={inputRef}
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && ok) done(true); }}
                placeholder={word}
                autoComplete="off"
                spellCheck={false}
                style={{ marginTop: 6, width: '100%', borderColor: ok ? undefined : RED_RULE }}
              />
            </label>
          )}
        </div>

        <div
          style={{
            display: 'flex', justifyContent: 'flex-end', gap: 8,
            padding: '12px 20px', background: 'var(--surface-2)', borderTop: '1px solid var(--rule-2)',
          }}
        >
          <button ref={cancelRef} className="btn-s" onClick={() => done(false)}>그만두기</button>
          <button
            className="btn-p"
            disabled={!ok}
            onClick={() => done(true)}
            style={{
              background: ok ? RED : '#E5C4C0', cursor: ok ? 'pointer' : 'not-allowed',
            }}
          >
            {ask.okLabel ?? '삭제합니다'}
          </button>
        </div>
      </div>
    </div>
  );
}
