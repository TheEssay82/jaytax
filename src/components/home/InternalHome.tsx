// 내부홈 — 로그인 후 첫 화면(로고 클릭 시 도착). 역할별 '할 일' + 바로가기 + 개발노트.
//  "오늘 내가 뭘 해야 하는지 + 각 업무 진행현황"을 보여주고, 클릭하면 해당 메뉴로 이동하는 관문.
//  ⚠️ 디자인은 잠정안(추후 조정 예정). 할 일 카운트는 homeApi(RLS 자동 적용).
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { can, ROLE_LABELS, type Role } from '../../lib/roles';
import { CHANGELOG } from '../../lib/changelog';
import AnnouncementBar from './AnnouncementBar';
import {
  countDispatchPending,
  countMyDispatchActive,
  countOpenRequests,
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
  { key: 'dispatch_wait', label: '처리 대기 발송요청', emoji: '🖨️', color: 'blue', tab: 'doc-process', roles: ['superuser', 'team_lead', 'team_member'], fetch: () => countDispatchPending() },
  { key: 'dispatch_mine', label: '내가 요청한 발송 진행중', emoji: '✉️', color: 'blue', tab: 'doc-status', roles: ['superuser', 'accountant', 'team_lead', 'team_member', 'per_head_accountant'], fetch: (uid) => countMyDispatchActive(uid) },
  { key: 'consult', label: '진행중 상담 초안', emoji: '🧑‍💼', color: 'teal', tab: 'consult-log', roles: ['superuser', 'accountant', 'team_lead', 'team_member'], fetch: (uid) => countMyConsultDrafts(uid) },
  { key: 'bill_draft', label: '내 임시저장 청구서', emoji: '📝', color: 'amber', tab: 'history', roles: ['superuser', 'accountant', 'team_lead', 'team_member'], fetch: (uid) => countMyBillingDrafts(uid) },
  { key: 'reqs', label: '미완료 업데이트요청', emoji: '💬', color: 'purple', tab: 'requests', roles: ['superuser'], fetch: () => countOpenRequests() },
];

type ShortcutDef = { key: string; label: string; emoji: string; color: ColorKey; tab?: string; allow: (r: Role) => boolean };

const READY: ShortcutDef[] = [
  { key: 'doc', label: '문서발송관리', emoji: '📄', color: 'blue', tab: 'doc-request', allow: (r) => r !== 'external' },
  { key: 'evidence', label: '증빙 자료실', emoji: '📑', color: 'blue', tab: 'evidence', allow: (r) => r !== 'external' },
  { key: 'bill', label: '청구서 작성', emoji: '🧾', color: 'amber', tab: 'wizard', allow: (r) => can(r, 'saveInvoice') },
  { key: 'consult', label: '상담진행', emoji: '🧑‍💼', color: 'teal', tab: 'consult', allow: (r) => ['superuser', 'accountant', 'team_lead', 'team_member'].includes(r) },
  { key: 'library', label: '자료실', emoji: '📁', color: 'teal', tab: 'library', allow: (r) => ['superuser', 'accountant', 'team_lead', 'team_member'].includes(r) },
];

// 준비 중(미개발) — 로드맵 노출용. 클릭 불가.
const COMING: ShortcutDef[] = [
  { key: 'clients', label: '거래처관리', emoji: '🏢', color: 'purple', allow: (r) => ['superuser', 'accountant', 'team_lead', 'team_member'].includes(r) },
  { key: 'indiv', label: '개별업무 청구', emoji: '💰', color: 'amber', allow: (r) => ['superuser', 'accountant', 'team_lead', 'team_member'].includes(r) },
  { key: 'inquiry', label: '조회서 발송', emoji: '📮', color: 'blue', allow: (r) => r !== 'external' },
  { key: 'vacation', label: '휴가관리', emoji: '🌴', color: 'coral', allow: (r) => r !== 'external' },
  { key: 'estimate', label: '견적산출', emoji: '🧮', color: 'green', allow: (r) => r !== 'external' },
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
  onOpenDevNotes: () => void;
}) {
  const { user, role, profileName } = useAuth();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);

  const myTodos = TODO_DEFS.filter((t) => t.roles.includes(role));

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

  const ready = READY.filter((s) => s.allow(role));
  const coming = COMING.filter((s) => s.allow(role));
  const latest = CHANGELOG[0];
  const name = profileName || user?.email || '';

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      {/* 인사바 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: '#faf8f4', border: '1px solid #ece8df', borderRadius: 14, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: NAVY, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 15, flexShrink: 0 }}>
          {(name[0] || '?').toUpperCase()}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1f2937' }}>
            안녕하세요, {name} <span style={{ color: '#6b7280', fontWeight: 500 }}>{ROLE_LABELS[role]}님</span>
          </div>
          <div style={{ fontSize: 12.5, color: '#8a8170' }}>{todayStr()} · 오늘도 좋은 하루 되세요</div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#9aa0ad', whiteSpace: 'nowrap' }}>🏠 내부홈</div>
      </div>

      {/* 공지사항 전광판 — 로그인 직후 가장 먼저 보이도록 '내 할 일' 위에 둔다 */}
      <AnnouncementBar />

      {/* 내 할 일 */}
      <SectionTitle>내 할 일{loaded && myTodos.length === 0 ? ' · 표시할 항목이 없습니다' : ''}</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 11, marginBottom: 22 }}>
        {myTodos.map((t) => {
          const c = C[t.color];
          const n = counts[t.key] ?? 0;
          return (
            <button key={t.key} onClick={() => onNavigate(t.tab)} style={{ textAlign: 'left', background: c[0], border: `1px solid ${c[1]}`, borderRadius: 14, padding: '14px 15px', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 18 }}>{t.emoji}</span>
                <span style={{ fontSize: 13, color: c[2] }}>↗</span>
              </div>
              <div style={{ fontSize: 27, fontWeight: 700, color: c[3], marginTop: 10, lineHeight: 1 }}>
                {loaded ? n : '–'}<span style={{ fontSize: 13, fontWeight: 400, color: c[2] }}> 건</span>
              </div>
              <div style={{ fontSize: 12, color: c[2], marginTop: 6, lineHeight: 1.35 }}>{t.label}</div>
            </button>
          );
        })}
      </div>

      {/* 바로가기 */}
      <SectionTitle hint="흐린 타일은 준비 중">바로가기</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 11, marginBottom: 22 }}>
        {ready.map((s) => {
          const c = C[s.color];
          return (
            <button key={s.key} onClick={() => s.tab && onNavigate(s.tab)} style={{ background: '#fff', border: '1px solid #e4e0d8', borderRadius: 14, padding: '15px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
              <span style={{ width: 40, height: 40, borderRadius: 11, background: c[0], border: `1px solid ${c[1]}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{s.emoji}</span>
              <span style={{ fontSize: 12.5, color: '#1f2937', fontWeight: 500 }}>{s.label}</span>
            </button>
          );
        })}
        {coming.map((s) => (
          <div key={s.key} style={{ background: '#faf8f4', border: '1px dashed #d8d2c6', borderRadius: 14, padding: '15px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 40, height: 40, borderRadius: 11, background: '#fff', border: '1px solid #e4e0d8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, filter: 'grayscale(1)', opacity: 0.55 }}>{s.emoji}</span>
            <span style={{ fontSize: 12.5, color: '#9aa0ad' }}>{s.label}</span>
            <span style={{ fontSize: 10, color: '#9aa0ad', background: '#fff', border: '1px solid #e4e0d8', padding: '1px 8px', borderRadius: 20 }}>준비 중</span>
          </div>
        ))}
      </div>

      {/* 개발노트 */}
      <SectionTitle hint="최신 업데이트">개발노트</SectionTitle>
      <button onClick={onOpenDevNotes} style={{ display: 'block', width: '100%', textAlign: 'left', background: '#fff', border: '1px solid #e4e0d8', borderRadius: 14, padding: '13px 15px', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#0F6E56', background: '#E1F5EE', border: '1px solid #9FE1CB', padding: '2px 9px', borderRadius: 20 }}>v{latest.version}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>{latest.title}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#9aa0ad' }}>{latest.date}</span>
        </div>
        {latest.highlights[0] && (
          <div style={{ fontSize: 12.5, color: '#4b5563', marginTop: 7, lineHeight: 1.55 }}>{latest.highlights[0]}</div>
        )}
        <div style={{ fontSize: 11.5, color: '#9aa0ad', marginTop: 8 }}>전체 개발내역 보기 ↗</div>
      </button>
    </div>
  );
}

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '2px 2px 9px' }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: '#1f2937' }}>{children}</span>
      {hint && <span style={{ fontSize: 12, color: '#9aa0ad' }}>{hint}</span>}
    </div>
  );
}
