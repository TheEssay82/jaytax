// 내부홈 공지사항 전광판 — 한 줄짜리 공지가 흐른다.
// · 글자가 폭을 넘칠 때만 흐르고, 짧으면 그냥 멈춰 있다(읽기 쉬움).
// · 마우스를 올리면 멈춘다. 시스템이 '동작 줄이기'면 아예 흐르지 않는다.
// · 등록·수정·삭제는 최고관리자만(오른쪽 작은 관리 버튼). 서버(RLS)에서도 막힌다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  type Announcement,
} from '../../lib/announcementsApi';

const SEP = '　·　'; // 여러 공지를 이어붙일 때 구분자(전각 공백으로 여백 확보)
const SPEED = 60; // px/초 — 낮을수록 천천히

export default function AnnouncementBar() {
  const { role } = useAuth();
  const canManage = role === 'superuser';

  const [items, setItems] = useState<Announcement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [manage, setManage] = useState(false);

  const load = useCallback(async () => {
    try {
      // 관리자는 숨김 공지도 함께 봐야 관리할 수 있다.
      setItems(await listAnnouncements(canManage));
    } catch {
      setItems([]); // 공지는 부가 정보라, 실패해도 홈 전체를 막지 않는다.
    } finally {
      setLoaded(true);
    }
  }, [canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = items.filter((a) => a.isActive);
  // 공지가 없으면: 일반 사용자에겐 아무것도 안 보이고, 관리자에겐 등록 진입점만 남긴다.
  if (loaded && active.length === 0 && !canManage) return null;
  if (!loaded) return null;

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'linear-gradient(90deg, #FFF9E8 0%, #FFFDF6 100%)',
          border: '1px solid #F0DFA8',
          borderRadius: 10,
          padding: '9px 12px',
          marginBottom: 14,
        }}
      >
        <span style={{ fontSize: 13, flexShrink: 0 }} aria-hidden>📢</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: '#8a5a00',
            flexShrink: 0,
            letterSpacing: '-0.02em',
          }}
        >
          공지
        </span>

        {active.length > 0 ? (
          <Marquee text={active.map((a) => a.message).join(SEP)} />
        ) : (
          <span style={{ flex: 1, fontSize: 12, color: '#B08C4F' }}>
            게시중인 공지가 없습니다.
          </span>
        )}

        {canManage && (
          <button
            className="btn-sm"
            onClick={() => setManage(true)}
            title="공지사항 등록·수정·삭제 (최고관리자)"
            style={{ fontSize: 10.5, padding: '2px 8px', flexShrink: 0, color: '#8a5a00' }}
          >
            ✏️ 공지관리
          </button>
        )}
      </div>

      {manage && (
        <ManageModal
          items={items}
          onClose={() => setManage(false)}
          onChanged={() => void load()}
        />
      )}
    </>
  );
}

/** 넘칠 때만 흐르는 전광판. 넘치지 않으면 정지 상태로 그대로 보여준다. */
function Marquee({ text }: { text: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [duration, setDuration] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      const box = boxRef.current;
      const el = textRef.current;
      if (!box || !el) return;
      const over = el.scrollWidth > box.clientWidth + 1;
      setOverflow(over);
      // 한 바퀴 = 글자폭 + 상자폭 만큼 이동
      setDuration(over ? (el.scrollWidth + box.clientWidth) / SPEED : 0);
    };
    measure();

    // ResizeObserver 가 없거나 동작하지 않는 환경도 있어 resize 이벤트를 함께 건다.
    // (둘 다 걸려도 measure 는 같은 값을 쓰므로 중복 호출이 무해하다)
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro && boxRef.current) ro.observe(boxRef.current);
    // 웹폰트가 늦게 붙으면 글자폭이 바뀌므로 로드 후 한 번 더 잰다.
    document.fonts?.ready.then(measure).catch(() => {});

    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [text]);

  return (
    <div
      ref={boxRef}
      style={{ flex: 1, overflow: 'hidden', position: 'relative', minWidth: 0 }}
      title={text}
    >
      <style>{`
        @keyframes jt-marquee { from { transform: translateX(100%); } to { transform: translateX(-100%); } }
        .jt-marquee-run { animation: jt-marquee linear infinite; will-change: transform; }
        .jt-marquee-box:hover .jt-marquee-run { animation-play-state: paused; }
        @media (prefers-reduced-motion: reduce) {
          .jt-marquee-run { animation: none; transform: none; }
        }
      `}</style>
      <div className="jt-marquee-box">
        <span
          ref={textRef}
          className={overflow ? 'jt-marquee-run' : undefined}
          style={{
            display: 'inline-block',
            whiteSpace: 'nowrap',
            fontSize: 12.5,
            color: '#6b4b00',
            fontWeight: 600,
            animationDuration: duration ? `${duration}s` : undefined,
            // 넘치지 않으면 애니메이션 없이 제자리
            maxWidth: overflow ? undefined : '100%',
            overflow: overflow ? undefined : 'hidden',
            textOverflow: overflow ? undefined : 'ellipsis',
          }}
        >
          {text}
        </span>
      </div>
    </div>
  );
}

/** 공지 관리(최고관리자) — 등록·수정·게시중지·삭제 */
function ManageModal({
  items,
  onClose,
  onChanged,
}: {
  items: Announcement[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(job: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await job();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 10, maxWidth: 640, width: '100%', maxHeight: '80vh', overflow: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #eee', position: 'sticky', top: 0, background: '#fff' }}>
          <span style={{ fontWeight: 700, color: '#1A2B52' }}>📢 공지사항 관리</span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>

        <div style={{ padding: 14 }}>
          <div className="alert-i" style={{ fontSize: 11, marginBottom: 10 }}>
            한 줄로 짧게 쓰는 것이 좋습니다. 여러 건을 게시하면 전광판에서 이어서 흐릅니다.
            <b> 게시중지</b>하면 내용은 남고 화면에서만 내려갑니다.
          </div>

          {/* 새 공지 */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <input
              className="inp"
              style={{ flex: 1, fontSize: 12.5 }}
              placeholder="예: 2026-08-01 기존 EXCEL버젼 문서발송업무 Jaytax로 완전이관 예정"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim() && !busy) {
                  void run(async () => { await createAnnouncement(draft); setDraft(''); });
                }
              }}
            />
            <button
              className="btn-p"
              style={{ fontSize: 11.5 }}
              disabled={busy || !draft.trim()}
              onClick={() => void run(async () => { await createAnnouncement(draft); setDraft(''); })}
            >
              + 등록
            </button>
          </div>

          {err && <div className="alert-w" style={{ fontSize: 11.5, marginBottom: 10 }}>{err}</div>}

          {items.length === 0 ? (
            <div style={{ padding: 16, color: '#888', fontSize: 12.5, textAlign: 'center' }}>등록된 공지가 없습니다.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 60, textAlign: 'center' }}>상태</th>
                  <th>내용</th>
                  <th style={{ width: 150 }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id}>
                    <td style={{ textAlign: 'center' }}>
                      <span
                        className="bdg"
                        style={{
                          fontSize: 10,
                          ...(a.isActive
                            ? { background: '#D1FAE5', color: '#065F46' }
                            : { background: '#F3F4F6', color: '#6B7280' }),
                        }}
                      >
                        {a.isActive ? '게시중' : '중지'}
                      </span>
                    </td>
                    <td style={{ fontSize: 12.5 }}>
                      {editId === a.id ? (
                        <input
                          className="inp"
                          style={{ width: '100%', fontSize: 12.5 }}
                          value={editText}
                          autoFocus
                          onChange={(e) => setEditText(e.target.value)}
                        />
                      ) : (
                        a.message
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {editId === a.id ? (
                          <>
                            <button
                              className="btn-sm btn-sm-blue"
                              disabled={busy || !editText.trim()}
                              onClick={() => void run(async () => {
                                await updateAnnouncement(a.id, { message: editText });
                                setEditId(null);
                              })}
                            >
                              저장
                            </button>
                            <button className="btn-sm" disabled={busy} onClick={() => setEditId(null)}>취소</button>
                          </>
                        ) : (
                          <>
                            <button
                              className="btn-sm btn-sm-blue"
                              title="수정"
                              disabled={busy}
                              onClick={() => { setEditId(a.id); setEditText(a.message); }}
                            >
                              ✏️
                            </button>
                            <button
                              className="btn-sm"
                              title={a.isActive ? '게시중지' : '게시하기'}
                              disabled={busy}
                              onClick={() => void run(() => updateAnnouncement(a.id, { isActive: !a.isActive }))}
                            >
                              {a.isActive ? '중지' : '게시'}
                            </button>
                            <button
                              className="btn-sm btn-sm-del"
                              title="삭제"
                              disabled={busy}
                              onClick={() => {
                                if (!confirm('이 공지를 삭제하시겠습니까? 되돌릴 수 없습니다.')) return;
                                void run(() => deleteAnnouncement(a.id));
                              }}
                            >
                              🗑
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
