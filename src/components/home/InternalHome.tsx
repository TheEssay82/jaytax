// 내부홈 — 로그인 후 첫 화면(로고 클릭 시 도착). 역할별 '할 일' + 바로가기 + 개발노트.
//  "오늘 내가 뭘 해야 하는지 + 각 업무 진행현황"을 보여주고, 클릭하면 해당 메뉴로 이동하는 관문.
//  ⚠️ 디자인은 잠정안(추후 조정 예정). 할 일 카운트는 homeApi(RLS 자동 적용).
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { can, ROLE_LABELS, type Role } from '../../lib/roles';
import { tabAllowed, screensFor, type Screen } from '../../lib/menu';
import { loadFavorites, saveFavorites } from '../../lib/favoritesApi';
import { CHANGELOG } from '../../lib/changelog';
import { emphasize } from '../../lib/emphasis';
import AnnouncementBar from './AnnouncementBar';
import {
  countDispatchPending,
  countMyDispatchActive,
  countOpenRequests,
  countSsongPending,
  countMyConsultDrafts,
  countMyBillingDrafts,
} from '../../lib/homeApi';

const NAVY = '#1A2B52';

// 카테고리 색: [배경, 테두리, 중간(아이콘/보조), 진한(숫자)]
const C = {
  blue: ['#E6F1FB', '#B5D4F4', '#185FA5', '#0C447C'],
  amber: ['#FAEEDA', '#FAC775', '#BA7517', '#633806'],
  teal: ['#E1F5EE', '#9FE1CB', '#0F6E56', '#085041'],
  purple: ['#EEEDFE', '#CECBF6', '#534AB7', '#3C3489'],
  coral: ['#FAECE7', '#F5C4B3', '#993C1D', '#712B13'],
  green: ['#EAF3DE', '#C0DD97', '#3B6D11', '#27500A'],
} as const;
type ColorKey = keyof typeof C;

type TodoDef = {
  key: string;
  label: string;
  emoji: string;
  color: ColorKey;
  tab: string;
  roles: Role[];
  fetch: (uid: string) => Promise<number>;
};

const TODO_DEFS: TodoDef[] = [
  // 쏭비서 결재 — 맨 앞(대표님 2026-11-21 「결재함이 너무 열기 어렵다」). 0건이어도 아래 줄에서 바로 연다.
  { key: 'ssong', label: '쏭비서 결재 대기', emoji: '🤖', color: 'amber', tab: 'ssong-inbox', roles: ['superuser'], fetch: () => countSsongPending() },
  { key: 'dispatch_wait', label: '처리 대기 발송요청', emoji: '🖨️', color: 'blue', tab: 'doc-process', roles: ['superuser', 'team_lead', 'team_member'], fetch: () => countDispatchPending() },
  { key: 'dispatch_mine', label: '내가 요청한 발송 진행중', emoji: '✉️', color: 'blue', tab: 'doc-status', roles: ['superuser', 'accountant', 'team_lead', 'team_member', 'per_head_accountant'], fetch: (uid) => countMyDispatchActive(uid) },
  { key: 'consult', label: '진행중 상담 초안', emoji: '🧑‍💼', color: 'teal', tab: 'consult-log', roles: ['superuser', 'accountant', 'team_lead', 'team_member'], fetch: (uid) => countMyConsultDrafts(uid) },
  { key: 'bill_draft', label: '내 임시저장 청구서', emoji: '📝', color: 'amber', tab: 'history', roles: ['superuser', 'accountant', 'team_lead', 'team_member'], fetch: (uid) => countMyBillingDrafts(uid) },
  { key: 'reqs', label: '미완료 업데이트요청', emoji: '💬', color: 'purple', tab: 'requests', roles: ['superuser'], fetch: () => countOpenRequests() },
];

type ShortcutDef = { key: string; label: string; emoji: string; color: ColorKey; tab?: string; allow: (r: Role, name: string) => boolean };
/** 메뉴에 있는 화면은 메뉴와 같은 사람에게만 — 규칙은 menu.ts 한 곳(tabAllowed). */
const byMenu = (tab: string) => (r: Role, name: string) => tabAllowed(r, name, tab);

const READY: ShortcutDef[] = [
  { key: 'clients', label: '거래처관리', emoji: '🏢', color: 'purple', tab: 'biz-register', allow: (r) => r !== 'external' },
  { key: 'doc', label: '문서발송관리', emoji: '📄', color: 'blue', tab: 'doc-request', allow: (r) => r !== 'external' },
  { key: 'evidence', label: '자료실', emoji: '📁', color: 'blue', tab: 'evidence', allow: (r) => r !== 'external' },
  { key: 'bill', label: '청구서 작성', emoji: '🧾', color: 'amber', tab: 'wizard', allow: (r) => can(r, 'saveInvoice') },
  { key: 'inv-bk', label: '발행요청 · 기장팀', emoji: '🧾', color: 'amber', tab: 'invoice-request', allow: byMenu('invoice-request') },
  { key: 'inv-aud', label: '발행요청 · 감사팀', emoji: '🧾', color: 'amber', tab: 'audit-invoice', allow: byMenu('audit-invoice') },
  { key: 'consult', label: '상담진행', emoji: '🧑‍💼', color: 'teal', tab: 'consult', allow: (r) => ['superuser', 'accountant', 'team_lead', 'team_member'].includes(r) },
  { key: 'inquiry', label: '조회서 발송', emoji: '📮', color: 'blue', tab: 'conf-register', allow: (r) => ['superuser', 'accountant', 'team_lead', 'team_member', 'per_head_accountant'].includes(r) },
  // 감사업무관리(2026-10-28 사용자 「바로가기 타일 업데이트」)
  { key: 'wtb', label: '정산표 관리', emoji: '📒', color: 'amber', tab: 'wtb', allow: byMenu('wtb') },
  { key: 'dsd', label: '주석·DSD 관리', emoji: '📗', color: 'teal', tab: 'dsd', allow: byMenu('dsd') },
  { key: 'gwp', label: '일반조서 관리', emoji: '📘', color: 'blue', tab: 'gwp', allow: byMenu('gwp') },
  { key: 'issue', label: '감사이슈 LOG', emoji: '📝', color: 'coral', tab: 'issue', allow: byMenu('issue') },
  { key: 'schedule', label: '기말감사일정', emoji: '📅', color: 'teal', tab: 'schedule', allow: byMenu('schedule') },
  { key: 'je', label: 'Journal Entry', emoji: '🔍', color: 'purple', tab: 'je', allow: byMenu('je') },
  // 팀결산(네 사람만)
  { key: 'expense', label: '경비귀속처리', emoji: '💳', color: 'green', tab: 'expense', allow: byMenu('expense') },
  { key: 'bk-settle', label: '기장배분', emoji: '🧮', color: 'green', tab: 'bk-settle', allow: byMenu('bk-settle') },
];

// 체험 계정(심리실 등) — 감사업무관리만 쓰므로 바로가기도 그것만(2026-10-06).
/** 즐겨찾기 타일 색 — 대분류마다(바로가기와 같은 결). */
const GROUP_COLOR: Record<string, ColorKey> = {
  'clients-hub': 'purple', 'billing-req': 'amber', billing: 'amber', advisory: 'teal',
  audit: 'blue', general: 'blue', mgmt: 'green', icons: 'purple',
};

const SANDBOX: ShortcutDef[] = [
  { key: 'wtb', label: '정산표 관리', emoji: '📒', color: 'amber', tab: 'wtb', allow: () => true },
  { key: 'dsd', label: '주석·DSD 관리', emoji: '📗', color: 'teal', tab: 'dsd', allow: () => true },
  { key: 'gwp', label: '일반조서 관리', emoji: '📘', color: 'blue', tab: 'gwp', allow: () => true },
  { key: 'inquiry', label: '조회서 발송', emoji: '📮', color: 'blue', tab: 'conf-register', allow: () => true },
];

function todayStr(): string {
  const d = new Date();
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

export default function InternalHome({
  onNavigate,
  onOpenDevNotes,
}: {
  onNavigate: (tab: string) => void;
  /** 개발노트를 열 수 있으면 그 함수, 볼 수 없는 등급이면 null — 섹션을 아예 그리지 않는다. */
  onOpenDevNotes: (() => void) | null;
}) {
  const { user, role, profileName, sandbox } = useAuth();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);

  const myTodos = TODO_DEFS.filter((t) => t.roles.includes(role));

  // ⭐ 즐겨찾기 — 체험 계정·외부인은 쓰지 않는다(볼 화면이 정해져 있다).
  const canFav = !sandbox && role !== 'external' && role !== 'client_user';
  const [favs, setFavs] = useState<string[]>([]);
  const [editFav, setEditFav] = useState(false);
  const [favErr, setFavErr] = useState('');
  useEffect(() => {
    if (!canFav) return;
    let active = true;
    loadFavorites().then((ids) => { if (active) setFavs(ids); }).catch((e: Error) => { if (active) setFavErr(e.message); });
    return () => { active = false; };
  }, [canFav, user?.id]);
  const screens: Screen[] = canFav ? screensFor(role, profileName) : [];
  const byId = new Map(screens.map((s) => [s.id, s]));
  // 고른 뒤 권한이 바뀌어 못 여는 화면은 조용히 뺀다(저장값은 그대로 — 권한이 돌아오면 다시 보인다).
  const favScreens = favs.map((id) => byId.get(id)).filter((s): s is Screen => !!s);
  const favGroups = [...screens.reduce((m, s) => m.set(s.group, [...(m.get(s.group) ?? []), s]), new Map<string, Screen[]>())];
  function toggleFav(id: string) {
    const next = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id];
    const prev = favs;
    setFavs(next); setFavErr('');
    saveFavorites(next).catch((e: Error) => { setFavs(prev); setFavErr(`저장 못 함 — ${e.message}`); });
  }

  useEffect(() => {
    let active = true;
    const uid = user?.id ?? '';
    Promise.all(myTodos.map((t) => t.fetch(uid).then((n) => [t.key, n] as const))).then((pairs) => {
      if (!active) return;
      setCounts(Object.fromEntries(pairs));
      setLoaded(true);
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, user?.id]);

  // 다 세기 전에는 전부 위에 크게 둔다 — 0으로 보이다가 숫자가 튀어 오르면 눈이 어지럽다.
  const openTodos = loaded ? myTodos.filter((t) => (counts[t.key] ?? 0) > 0) : myTodos;
  const doneTodos = loaded ? myTodos.filter((t) => (counts[t.key] ?? 0) === 0) : [];

  const ready = sandbox ? SANDBOX : READY.filter((s) => s.allow(role, profileName));
  const latest = CHANGELOG[0];
  const name = profileName || user?.email || '';

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      {/* 인사바 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: '#faf8f4', border: '1px solid var(--rule-2)', borderRadius: 14, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: NAVY, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 'var(--fs-4)', flexShrink: 0 }}>
          {(name[0] || '?').toUpperCase()}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--fs-4)', fontWeight: 600, color: 'var(--ink-2)' }}>
            안녕하세요, {name} <span style={{ color: 'var(--ink-3)', fontWeight: 500 }}>{ROLE_LABELS[role]}님</span>
          </div>
          <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-3)' }}>{todayStr()} · 오늘도 좋은 하루 되세요</div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 'var(--fs-2)', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>🏠 내부홈</div>
      </div>

      {/* 공지사항 전광판 — 로그인 직후 가장 먼저 보이도록 '내 할 일' 위에 둔다 */}
      <AnnouncementBar />

      {/* 내 할 일 — **할 일이 있는 것만 크게.** 0건은 아래 한 줄로 접는다.
          로그인 직후 가장 먼저 보는 자리인데, 예전에는 0건 타일 넷이 자리를 똑같이 먹어
          '오늘 뭘 해야 하나'가 묻혔다. 0건도 지우지는 않는다 — 그 업무가 있다는 것과
          '지금은 없다'는 것 자체가 정보이고, 눌러서 화면으로 갈 수도 있어야 한다. */}
      <SectionTitle>
        내 할 일
        {loaded && myTodos.length === 0 && ' · 표시할 항목이 없습니다'}
        {loaded && myTodos.length > 0 && openTodos.length === 0 && ' · 지금 할 일이 없습니다'}
      </SectionTitle>

      {openTodos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 11, marginBottom: doneTodos.length ? 10 : 22 }}>
          {openTodos.map((t) => {
            const c = C[t.color];
            const n = counts[t.key] ?? 0;
            return (
              <button key={t.key} onClick={() => onNavigate(t.tab)} style={{ textAlign: 'left', background: c[0], border: `1px solid ${c[1]}`, borderRadius: 14, padding: '14px 15px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 18 }}>{t.emoji}</span>
                  <span style={{ fontSize: 'var(--fs-3)', color: c[2] }}>↗</span>
                </div>
                <div style={{ fontSize: 27, fontWeight: 700, color: c[3], marginTop: 10, lineHeight: 1 }}>
                  {n}<span style={{ fontSize: 'var(--fs-3)', fontWeight: 400, color: c[2] }}> 건</span>
                </div>
                <div style={{ fontSize: 'var(--fs-2)', color: c[2], marginTop: 6, lineHeight: 1.35 }}>{t.label}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* 0건 — 한 줄. 눌러서 그 화면으로는 갈 수 있다. */}
      {doneTodos.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 22 }}>
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-4)' }}>비어 있음</span>
          {doneTodos.map((t) => (
            <button key={t.key} onClick={() => onNavigate(t.tab)} className="todo-zero"
              title={`${t.label} — 지금 0건입니다. 눌러서 화면으로 갑니다.`}>
              {t.emoji} {t.label} <b>0</b>
            </button>
          ))}
        </div>
      )}

      {/* ⭐ 즐겨찾기 — 사람마다 자주 여는 화면(사용자 2026-11-15 「메뉴판이 너무 복잡하다」).
          메뉴를 뒤지지 않고 홈에서 바로 간다. 고른 차례대로 놓이고, 계정에 붙어 어느 PC에서나 같다. */}
      {canFav && (
        <>
          <SectionTitle hint={editFav ? '눌러서 넣고 빼기 · 넣은 차례대로 놓입니다' : undefined}>
            ⭐ 즐겨찾기
            <button className="btn-sm" style={{ marginLeft: 8, fontSize: 'var(--fs-1)', padding: '1px 8px', fontWeight: 400 }}
              onClick={() => setEditFav((v) => !v)}>{editFav ? '다 골랐어요' : favs.length ? '편집' : '⭐ 고르기'}</button>
            {favErr && <span className="err" style={{ marginLeft: 8, fontWeight: 400, fontSize: 'var(--fs-1)' }}>{favErr}</span>}
          </SectionTitle>
          {favScreens.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 11, marginBottom: editFav ? 10 : 22 }}>
              {favScreens.map((s) => {
                const c = C[GROUP_COLOR[s.groupId] ?? 'blue'];
                return (
                  <div key={s.id} style={{ position: 'relative' }}>
                    <button onClick={() => onNavigate(s.id)} title={`${s.group} › ${s.label}`}
                      style={{ width: '100%', background: '#fff', border: '1px solid var(--rule)', borderRadius: 14, padding: '15px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
                      <span style={{ width: 40, height: 40, borderRadius: 11, background: c[0], border: `1px solid ${c[1]}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-5)' }}>{s.emoji}</span>
                      <span style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', fontWeight: 500, textAlign: 'center' }}>{s.label}</span>
                    </button>
                    {editFav && (
                      <button onClick={() => toggleFav(s.id)} title="즐겨찾기에서 빼기" aria-label={`${s.label} 빼기`}
                        style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--rule)', background: '#fff', cursor: 'pointer', fontSize: 12, lineHeight: 1, color: 'var(--ink-3)' }}>✕</button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : !editFav && (
            <button onClick={() => setEditFav(true)}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: '#fff', border: '1px dashed var(--rule)', borderRadius: 14, padding: '13px 15px', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 'var(--fs-2)', marginBottom: 22 }}>
              자주 여는 화면을 ⭐ 로 골라 두면 여기 모입니다 — 메뉴를 뒤지지 않고 바로 갑니다. <b style={{ color: 'var(--navy)' }}>고르기 ↗</b>
            </button>
          )}
          {editFav && (
            <div style={{ display: 'grid', gap: 8, padding: 12, background: '#faf8f4', border: '1px solid var(--rule-2)', borderRadius: 14, marginBottom: 22 }}>
              {favGroups.map(([g, list]) => (
                <div key={g} style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                  <b style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', width: 92, flexShrink: 0 }}>{g}</b>
                  {list.map((s) => {
                    const on = favs.includes(s.id);
                    return (
                      <button key={s.id} onClick={() => toggleFav(s.id)} className={on ? 'btn-p' : 'btn-sm'}
                        style={{ fontSize: 'var(--fs-1)', padding: '2px 9px' }}>
                        {on ? '⭐' : '☆'} {s.emoji} {s.label}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* 바로가기 */}
      <SectionTitle>바로가기</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 11, marginBottom: 22 }}>
        {ready.map((s) => {
          const c = C[s.color];
          return (
            <button key={s.key} onClick={() => s.tab && onNavigate(s.tab)} style={{ background: '#fff', border: '1px solid var(--rule)', borderRadius: 14, padding: '15px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
              <span style={{ width: 40, height: 40, borderRadius: 11, background: c[0], border: `1px solid ${c[1]}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-5)' }}>{s.emoji}</span>
              <span style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', fontWeight: 500 }}>{s.label}</span>
            </button>
          );
        })}
      </div>

      {/* 개발노트 — **기장팀장·기장팀원에게는 내놓지 않는다**(2026-09-08).
          개발내역에 거래처 이름·금액·직원 이름이 그대로 적혀 있다. 눌러서 막히는 것이
          아니라 있는 줄도 모르게 한다. */}
      {onOpenDevNotes && (
        <>
      <SectionTitle hint="최신 업데이트">개발노트</SectionTitle>
      <button onClick={onOpenDevNotes} style={{ display: 'block', width: '100%', textAlign: 'left', background: '#fff', border: '1px solid var(--rule)', borderRadius: 14, padding: '13px 15px', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 'var(--fs-1)', fontWeight: 700, color: '#0F6E56', background: '#E1F5EE', border: '1px solid #9FE1CB', padding: '2px 9px', borderRadius: 20 }}>v{latest.version}</span>
          <span style={{ fontSize: 'var(--fs-3)', fontWeight: 600, color: 'var(--ink-2)' }}>
            {emphasize(latest.title).map((p, i) => <span key={i}>{p.text}</span>)}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>{latest.date}</span>
        </div>
        {latest.highlights[0] && (
          <div style={{ fontSize: 'var(--fs-2)', color: '#4b5563', marginTop: 7, lineHeight: 1.55 }}>
            {/* 꺾쇠(`<…>`)는 강조 표시다 — 글자로 새어 나오지 않게 굵게 그린다. */}
            {emphasize(latest.highlights[0]).map((p, i) => (p.em
              ? <b key={i} style={{ color: 'var(--navy)' }}>{p.text}</b>
              : <span key={i}>{p.text}</span>))}
          </div>
        )}
        <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginTop: 8 }}>전체 개발내역 보기 ↗</div>
      </button>
        </>
      )}
    </div>
  );
}

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '2px 2px 9px' }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-2)' }}>{children}</span>
      {hint && <span style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-3)' }}>{hint}</span>}
    </div>
  );
}
