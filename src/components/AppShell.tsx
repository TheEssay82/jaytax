import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { WizardProvider, useWizard } from '../context/WizardContext';
import { ConfigProvider } from '../context/ConfigContext';
import { can, ROLE_LABELS, type Capability } from '../lib/roles';
import PasswordModal from './PasswordModal';
import ClientsTab from './clients/ClientsTab';
import WizardTab from './wizard/WizardTab';
import HistoryTab from './history/HistoryTab';
import RequestsTab from './requests/RequestsTab';
import TargetsTab from './targets/TargetsTab';
import SettingsTab from './settings/SettingsTab';
import StatsTab from './stats/StatsTab';
import UsersTab from './users/UsersTab';
import StandardsTab from './advisory/StandardsTab';
import TaxLawTab from './advisory/TaxLawTab';
import PlaceholderTab from './common/PlaceholderTab';

// ── 메뉴 구조 (대분류 → 하부메뉴) ───────────────────────────────
type MenuItem = { id: string; label: string; cap?: Capability };
type MenuGroup = { id: string; label: string; items: MenuItem[] };

export const MENU_GROUPS: MenuGroup[] = [
  {
    id: 'billing',
    label: '세무조정수수료 관리시스템',
    items: [
      { id: 'wizard', label: '📝 청구서 작성' },
      { id: 'clients', label: '🏢 거래처 관리', cap: 'manageClients' },
      { id: 'targets', label: '✅ 청구대상', cap: 'manageTargets' },
      { id: 'history', label: '📋 청구기록' },
      { id: 'stats', label: '📊 통계' },
      { id: 'settings', label: '⚙️ 설정', cap: 'changeSettings' },
    ],
  },
  {
    id: 'advisory',
    label: '회계및세무상담시스템',
    items: [
      { id: 'std-kifrs', label: '📚 회계기준 검색' },
      { id: 'std-tax', label: '⚖️ 세법 검색' },
      { id: 'consult', label: '🧑‍💼 상담진행' },
      { id: 'consult-log', label: '🗂️ 상담기록' },
      { id: 'library', label: '📁 자료실' },
    ],
  },
];

// 우측 아이콘 메뉴 (대분류 밖)
const ICON_ITEMS: (MenuItem & { icon: string })[] = [
  { id: 'requests', label: '업데이트요청', icon: '💬' },
  { id: 'users', label: '사용자 관리', icon: '👤', cap: 'manageUsers' },
];

export default function AppShell() {
  return (
    <ConfigProvider>
      <WizardProvider>
        <Shell />
      </WizardProvider>
    </ConfigProvider>
  );
}

function Shell() {
  const { user, signOut, role } = useAuth();
  const { resetNew } = useWizard();
  const [curTab, setCurTab] = useState('wizard');
  const [reloadKey, setReloadKey] = useState(0);
  const [showPw, setShowPw] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // 권한 필터링된 메뉴 그룹/아이콘
  const visibleGroups = MENU_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((it) => !it.cap || can(role, it.cap)) }))
    .filter((g) => g.items.length > 0);
  const visibleIcons = ICON_ITEMS.filter((it) => !it.cap || can(role, it.cap));

  // 접근 가능한 전체 탭 id 집합 (방어용)
  const allowedIds = new Set<string>([
    ...visibleGroups.flatMap((g) => g.items.map((it) => it.id)),
    ...visibleIcons.map((it) => it.id),
  ]);
  const cur = allowedIds.has(curTab) ? curTab : 'wizard';

  // 현재 탭이 속한 대분류 (버튼 강조용)
  const activeGroupId = visibleGroups.find((g) => g.items.some((it) => it.id === cur))?.id ?? null;

  // 바깥 클릭 / ESC 로 드롭다운 닫기
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  // 탭 이동: 화면 remount(key 변경)로 데이터 새로고침. 청구서 작성은 항상 새 청구서부터.
  function goTab(id: string) {
    if (id === 'wizard') resetNew();
    setCurTab(id);
    setReloadKey((k) => k + 1);
    setOpenMenu(null);
  }

  const curLabel =
    visibleGroups.flatMap((g) => g.items).find((it) => it.id === cur)?.label ??
    visibleIcons.find((it) => it.id === cur)?.label ??
    '';

  return (
    <>
      <header id="hdr">
        <img
          src="/logo2.png"
          alt="JAY · 세무회계 지원"
          style={{ height: 56, display: 'block', flexShrink: 0 }}
        />
        <span
          className="h-ver"
          title={`앱 버전 v${__APP_VERSION__}`}
          style={{ fontSize: 11, color: '#9aa0ad', fontWeight: 600, marginLeft: 6 }}
        >
          v{__APP_VERSION__}
        </span>

        {/* 대분류 드롭다운 메뉴 */}
        <nav className="h-menus" ref={navRef}>
          {visibleGroups.map((g) => (
            <div className="h-menu" key={g.id}>
              <button
                className={`h-menu-btn${activeGroupId === g.id ? ' on' : ''}`}
                onClick={() => setOpenMenu((m) => (m === g.id ? null : g.id))}
                aria-expanded={openMenu === g.id}
              >
                {g.label}
                <span className="caret">{openMenu === g.id ? '▲' : '▼'}</span>
              </button>
              {openMenu === g.id && (
                <div className="h-dropdown" role="menu">
                  {g.items.map((it) => (
                    <button
                      key={it.id}
                      className={`h-dropdown-item${cur === it.id ? ' on' : ''}`}
                      role="menuitem"
                      onClick={() => goTab(it.id)}
                    >
                      {it.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* 우측: 아이콘 메뉴 + 사용자 정보 + 액션 */}
        <div className="h-right">
          {visibleIcons.map((it) => (
            <button
              key={it.id}
              className={`h-iconbtn${cur === it.id ? ' on' : ''}`}
              title={it.label}
              aria-label={it.label}
              onClick={() => goTab(it.id)}
            >
              {it.icon}
            </button>
          ))}
          <span className="h-title">
            {user?.email}
            <span className="bdg b-on" style={{ marginLeft: 6, fontSize: 10 }}>
              {ROLE_LABELS[role]}
            </span>
          </span>
          <button className="ha" onClick={() => setShowPw(true)}>
            비밀번호 변경
          </button>
          <button className="ha" onClick={signOut}>
            로그아웃
          </button>
        </div>
      </header>

      {showPw && <PasswordModal onClose={() => setShowPw(false)} />}

      <main id="main" key={`${cur}-${reloadKey}`}>
        <TabContent cur={cur} setCurTab={setCurTab} curLabel={curLabel} />
      </main>
    </>
  );
}

function TabContent({
  cur,
  setCurTab,
  curLabel,
}: {
  cur: string;
  setCurTab: (id: string) => void;
  curLabel: string;
}) {
  switch (cur) {
    case 'wizard':
      return <WizardTab />;
    case 'clients':
      return <ClientsTab />;
    case 'history':
      return <HistoryTab onSwitchTab={setCurTab} />;
    case 'targets':
      return <TargetsTab />;
    case 'stats':
      return <StatsTab />;
    case 'settings':
      return <SettingsTab />;
    case 'requests':
      return <RequestsTab />;
    case 'users':
      return <UsersTab />;
    case 'std-kifrs':
      return <StandardsTab />;
    case 'std-tax':
      return <TaxLawTab />;
    case 'consult':
      return (
        <PlaceholderTab
          title="🧑‍💼 상담진행"
          desc="회계·세무 상담을 진행·기록하는 작업 화면입니다. 세부 설계 예정."
        />
      );
    case 'consult-log':
      return (
        <PlaceholderTab title="🗂️ 상담기록" desc="지난 상담 이력을 조회하는 화면입니다. 세부 설계 예정." />
      );
    case 'library':
      return (
        <PlaceholderTab title="📁 자료실" desc="상담·검토에 활용할 자료 보관소입니다. 세부 설계 예정." />
      );
    default:
      return (
        <div className="card">
          <div className="chdr">{curLabel || '알 수 없는 메뉴'}</div>
          <div className="alert-i">알 수 없는 메뉴입니다.</div>
        </div>
      );
  }
}
