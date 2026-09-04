// 어디서든 찾기 — Ctrl+K (맥은 ⌘K).
//
// 왜 필요한가: 화면이 서른 개를 넘어가면서 메뉴를 짚어 들어가는 비용이 커졌다.
// 「㈜오톰 계약을 보자」 하면 거래처관리 → 매출계약등록 → 필터에 입력, 세 동작이었다.
// 여기서 이름을 치면 한 동작이 된다.
//
// 보이는 것은 **그 사람이 갈 수 있는 화면뿐**이다 — 목록은 AppShell 이 이미 권한으로
// 거른 것을 그대로 받는다. 팔레트가 권한을 새로 판단하지 않는다(두 곳에서 판단하면
// 언젠가 어긋난다).
import { useEffect, useMemo, useRef, useState } from 'react';
import { listEntityIndex, type EntityIndexRow } from '../../lib/bizRegistryApi';
import { setNavQuery } from '../../lib/navSearch';
import { hit, digitsHit } from '../../lib/paletteSearch';

/** 거래처를 고르면 갈 화면. 검색어를 들고 간다. */
const ENTITY_TARGETS = [
  { tab: 'biz-contract', label: '📄 매출계약등록' },
  { tab: 'biz-register', label: '🏢 거래처등록' },
  { tab: 'receivable', label: '💰 수금·미수금' },
] as const;

export interface PaletteTarget { id: string; label: string; group: string }

export default function CommandPalette(
  { targets, onGo, openSignal }: { targets: PaletteTarget[]; onGo: (tab: string) => void; openSignal?: number },
) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [ents, setEnts] = useState<EntityIndexRow[] | null>(null);
  const [entPick, setEntPick] = useState<EntityIndexRow | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 열고 닫기 — Ctrl+K / ⌘K, ESC.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 머리의 「🔍 찾기」 단추 — 값이 바뀔 때만 연다(처음 뜰 때는 열지 않는다).
  const firstSignal = useRef(true);
  useEffect(() => {
    if (firstSignal.current) { firstSignal.current = false; return; }
    setOpen(true);
  }, [openSignal]);

  // 열 때 초기화. 거래처 색인은 **처음 열 때 한 번만** 읽는다.
  useEffect(() => {
    if (!open) return;
    setQ(''); setSel(0); setEntPick(null);
    inputRef.current?.focus();
    if (ents === null) void listEntityIndex().then(setEnts).catch(() => setEnts([]));
  }, [open, ents]);

  const screens = useMemo(
    () => (q ? targets.filter((t) => hit(`${t.label} ${t.group}`, q)) : targets).slice(0, 8),
    [targets, q],
  );
  const clients = useMemo(() => {
    if (!q || !ents) return [];
    return ents
      .filter((e) => hit(e.name, q) || hit(e.code, q)
        || e.places.some((p) => hit(p.name, q) || digitsHit(p.bizRegNo, q)))
      .slice(0, 6);
  }, [ents, q]);

  // 화살표로 고를 목록 — 화면 다음에 거래처.
  const rows = entPick
    ? ENTITY_TARGETS.map((t) => ({ kind: 'goto' as const, tab: t.tab, label: t.label }))
    : [
      ...screens.map((t) => ({ kind: 'screen' as const, tab: t.id, label: t.label, group: t.group })),
      ...clients.map((e) => ({ kind: 'client' as const, ent: e, label: e.name })),
    ];
  const cur = rows[Math.min(sel, rows.length - 1)];

  function choose(r: typeof cur) {
    if (!r) return;
    if (r.kind === 'screen') { onGo(r.tab); setOpen(false); return; }
    if (r.kind === 'client') { setEntPick(r.ent); setSel(0); return; }
    // goto — 고른 거래처 이름을 목적 화면의 검색칸까지 들고 간다.
    setNavQuery(r.tab, entPick?.name ?? '');
    onGo(r.tab);
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={entPick ? entPick.name : q}
          readOnly={!!entPick}
          placeholder="화면 이름 · 거래처 · 계약코드 · 사업자번호 (초성도 됩니다)"
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, rows.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); choose(cur); }
            else if (e.key === 'Backspace' && entPick) { e.preventDefault(); setEntPick(null); setSel(0); }
          }}
        />

        {entPick && (
          <div className="cmdk-note">
            <b>{entPick.name}</b> — 어느 화면에서 볼까요? <span>(← Backspace 로 되돌아갑니다)</span>
          </div>
        )}

        <div className="cmdk-list">
          {rows.length === 0 && (
            <div className="cmdk-empty">
              {ents === null ? '거래처를 불러오는 중…' : '찾는 것이 없습니다.'}
            </div>
          )}
          {rows.map((r, i) => (
            <button key={`${r.kind}-${'tab' in r ? r.tab : r.ent.id}`}
              className={`cmdk-row${i === sel ? ' on' : ''}`}
              onMouseEnter={() => setSel(i)} onClick={() => choose(r)}>
              <span className="cmdk-label">{r.label}</span>
              <span className="cmdk-side">
                {r.kind === 'screen' && r.group}
                {r.kind === 'client' && `${r.ent.code}${r.ent.places[0]?.name && r.ent.places[0].name !== r.ent.name ? ` · ${r.ent.places[0].name}` : ''}`}
              </span>
            </button>
          ))}
        </div>

        <div className="cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> 고르기</span>
          <span><kbd>Enter</kbd> 열기</span>
          <span><kbd>Esc</kbd> 닫기</span>
          <span style={{ marginLeft: 'auto' }}>보이는 것은 <b>내가 갈 수 있는 화면</b>뿐입니다</span>
        </div>
      </div>
    </div>
  );
}
