// 헤더 알림 벨 — 안 읽은 개수 배지 + 드롭다운 목록.
// · 앱이 열려 있으면 주기적으로(45초) 새 알림을 가져온다.
// · 새 알림이 오고 사용자가 '알림 허용'을 했고 탭이 백그라운드면 윈도우 토스트(브라우저 알림)를 띄운다.
//   허용을 안 했거나 거부하면 벨 안에서만 보인다(그래도 동작).
import { useCallback, useEffect, useRef, useState } from 'react';
import { listNotifications, markRead, markAllRead, type Notification } from '../lib/notificationsApi';

const POLL_MS = 45_000;

const dt = (s: string) => {
  const d = new Date(s);
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const icon = (kind: string) =>
  kind === 'dispatch_new' ? '📥' : kind === 'dispatch_returned' ? '↩️' : kind === 'dispatch_resend' ? '🔄' : '🔔';

export default function NotificationBell({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [permAsk, setPermAsk] = useState(false);
  const seenIds = useRef<Set<number>>(new Set());
  const first = useRef(true);
  const boxRef = useRef<HTMLDivElement>(null);

  const unread = items.filter((n) => !n.readAt).length;

  const refresh = useCallback(async () => {
    let list: Notification[];
    try {
      list = await listNotifications(30);
    } catch {
      return; // 알림은 부가 기능 — 실패해도 앱을 막지 않는다
    }
    // 첫 로드는 기존 알림을 토스트로 띄우지 않는다(로그인할 때마다 쏟아지지 않게).
    if (first.current) {
      list.forEach((n) => seenIds.current.add(n.id));
      first.current = false;
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      // 새로 도착한 안 읽은 알림만 토스트. 탭이 보이는 중이면 벨로 충분하니 생략.
      const fresh = list.filter((n) => !n.readAt && !seenIds.current.has(n.id));
      if (document.hidden && fresh.length) {
        const top = fresh[0];
        const n = new Notification('JAYTAX' + (fresh.length > 1 ? ` · 새 알림 ${fresh.length}건` : ''), {
          body: fresh.length > 1 ? `${top.title} 외 ${fresh.length - 1}건` : `${top.title} — ${top.body}`,
          tag: 'jaytax-notif',
        });
        n.onclick = () => { window.focus(); if (top.tab) onNavigate(top.tab); n.close(); };
      }
      list.forEach((x) => seenIds.current.add(x.id));
    }
    setItems(list);
  }, [onNavigate]);

  // 폴링 + 탭이 다시 보일 때 갱신
  useEffect(() => {
    void refresh();
    const iv = setInterval(() => void refresh(), POLL_MS);
    const onVis = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [refresh]);

  // 아직 결정 안 한 사용자에게만 '알림 켜기' 안내를 노출
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') setPermAsk(true);
  }, []);

  // 바깥 클릭 시 닫기
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  async function enablePush() {
    if (typeof Notification === 'undefined') return;
    const p = await Notification.requestPermission();
    setPermAsk(p === 'default');
  }

  async function onClickItem(n: Notification) {
    setOpen(false);
    if (!n.readAt) {
      try { await markRead(n.id); } catch { /* noop */ }
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
    }
    if (n.tab) onNavigate(n.tab);
  }

  async function onMarkAll() {
    try { await markAllRead(); } catch { /* noop */ }
    const now = new Date().toISOString();
    setItems((prev) => prev.map((x) => ({ ...x, readAt: x.readAt ?? now })));
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        className="ha"
        onClick={() => setOpen((v) => !v)}
        title="알림"
        aria-label={`알림 ${unread}건`}
        style={{ position: 'relative' }}
      >
        🔔
        {unread > 0 && (
          <span
            style={{
              position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, padding: '0 4px',
              background: '#dc2626', color: '#fff', borderRadius: 8, fontSize: 10, fontWeight: 700,
              lineHeight: '16px', textAlign: 'center',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 60,
            width: 340, maxHeight: 460, overflowY: 'auto', background: '#fff',
            border: '1px solid #E3DED3', borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,0.16)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', padding: '9px 12px', borderBottom: '1px solid #eee', position: 'sticky', top: 0, background: '#fff' }}>
            <b style={{ fontSize: 12.5, color: '#1A2B52' }}>알림{unread > 0 ? ` · ${unread}` : ''}</b>
            <button
              className="btn-sm"
              style={{ marginLeft: 'auto', fontSize: 10.5, padding: '2px 7px' }}
              disabled={unread === 0}
              onClick={() => void onMarkAll()}
            >
              모두 읽음
            </button>
          </div>

          {permAsk && (
            <div style={{ padding: '8px 12px', background: '#FFF9E8', borderBottom: '1px solid #F0DFA8', fontSize: 11, color: '#8a5a00' }}>
              💡 다른 창을 보고 있어도 알림을 받으려면{' '}
              <button className="btn-sm" style={{ fontSize: 10.5, padding: '1px 7px', marginLeft: 2 }} onClick={() => void enablePush()}>
                알림 켜기
              </button>
            </div>
          )}

          {items.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#BBB', fontSize: 12 }}>알림이 없습니다.</div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                onClick={() => void onClickItem(n)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', border: 'none',
                  borderBottom: '1px solid #f2f0ea', padding: '9px 12px', cursor: 'pointer',
                  background: n.readAt ? '#fff' : '#F3F8FF',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span aria-hidden>{icon(n.kind)}</span>
                  <b style={{ fontSize: 12, color: '#1A2B52' }}>{n.title}</b>
                  {!n.readAt && <span style={{ width: 6, height: 6, borderRadius: 3, background: '#dc2626', marginLeft: 2 }} />}
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: '#999', whiteSpace: 'nowrap' }}>{dt(n.createdAt)}</span>
                </div>
                {n.body && <div style={{ fontSize: 11, color: '#555', marginTop: 2, lineHeight: 1.35 }}>{n.body}</div>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
