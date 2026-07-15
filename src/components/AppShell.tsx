import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { WizardProvider, useWizard } from '../context/WizardContext';
import { ConfigProvider } from '../context/ConfigContext';
import {
  can,
  ROLE_LABELS,
  EXTERNAL_ALLOWED_TABS,
  PER_HEAD_ALLOWED_GROUPS,
  PER_HEAD_HIDDEN_TABS,
  PER_HEAD_ALLOWED_ICONS,
  type Capability,
} from '../lib/roles';
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
import ConsultTab from './advisory/ConsultTab';
import LibraryTab from './advisory/LibraryTab';
import ConsultLogTab from './advisory/ConsultLogTab';
import AiUsageTab from './advisory/AiUsageTab';
import DocClientsTab from './docsend/DocClientsTab';
import PlaceholderTab from './common/PlaceholderTab';

// ── 메뉴 구조 (대분류 → 하부메뉴) ───────────────────────────────
// children: 중분류가 하위 소분류를 가지면 클릭·호버 시 플라이아웃 서브메뉴로 펼친다(컨테이너 자체는 페이지 없음).
type MenuItem = { id: string; label: string; cap?: Capability; children?: MenuItem[] };
type MenuGroup = { id: string; label: string; items: MenuItem[] };

export const MENU_GROUPS: MenuGroup[] = [
  {
    id: 'clients-hub',
    label: '거래처관리',
    items: [
      { id: 'clients-hub-home', label: '🏢 거래처관리 (준비 중)' },
    ],
  },
  {
    id: 'billing-req',
    label: '기장및개별업무청구관리',
    items: [
      { id: 'billing-req-home', label: '🧾 기장·개별업무 청구 (준비 중)' },
    ],
  },
  {
    id: 'general',
    label: '일반업무관리',
    items: [
      {
        id: 'doc-send',
        label: '📄 문서발송관리',
        children: [
          { id: 'doc-contacts', label: '👤 거래처 담당자 관리' },
          { id: 'doc-request', label: '✉️ 발송요청' },
          { id: 'doc-process', label: '🖨️ 발송요청 처리' },
          { id: 'doc-status', label: '📊 발송업무 현황' },
        ],
      },
      { id: 'inquiry-send', label: '📮 조회서 발송관리' },
      { id: 'vacation', label: '🌴 휴가관리' },
      { id: 'estimate', label: '🧮 견적산출 시스템' },
    ],
  },
  {
    id: 'billing',
    label: '세무조정수수료관리',
    items: [
      { id: 'wizard', label: '📝 청구서 작성' },
      { id: 'clients', label: '🏢 거래처 관리', cap: 'viewClients' },
      { id: 'targets', label: '✅ 청구대상', cap: 'manageTargets' },
      { id: 'history', label: '📋 청구기록' },
      { id: 'stats', label: '📊 통계' },
      { id: 'settings', label: '⚙️ 설정', cap: 'changeSettings' },
    ],
  },
  {
    id: 'advisory',
    label: '회계및세무상담관리',
    items: [
      { id: 'std-kifrs', label: '📚 회계기준 검색' },
      { id: 'std-tax', label: '⚖️ 세법 검색' },
      { id: 'consult', label: '🧑‍💼 상담진행' },
      { id: 'consult-log', label: '🗂️ 상담기록' },
      { id: 'library', label: '📁 자료실' },
      { id: 'ai-usage', label: '📊 AI 사용량', cap: 'viewAiUsage' },
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
  const { user, signOut, role, readonly } = useAuth();
  const { resetNew } = useWizard();
  const [curTab, setCurTab] = useState('wizard');
  const [reloadKey, setReloadKey] = useState(0);
  const [showPw, setShowPw] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openSub, setOpenSub] = useState<string | null>(null); // 열린 중분류 플라이아웃 서브메뉴
  const navRef = useRef<HTMLElement>(null);
  const fromPop = useRef(false); // popstate로 인한 탭 변경이면 pushState 생략
  const navMounted = useRef(false);

  // 권한 필터링된 메뉴 그룹/아이콘.
  //  · 외부인: 정해진 조회 메뉴만(EXTERNAL_ALLOWED_TABS), 아이콘 메뉴 없음.
  //  · 인당회계사: 허용된 대분류(PER_HEAD_ALLOWED_GROUPS)만 + 숨김 탭 제외(PER_HEAD_HIDDEN_TABS) + 허용 아이콘만.
  const isExternal = role === 'external';
  const isPerHead = role === 'per_head_accountant';
  const allowed = (it: MenuItem) => {
    if (isExternal) return EXTERNAL_ALLOWED_TABS.has(it.id);
    if (isPerHead && PER_HEAD_HIDDEN_TABS.has(it.id)) return false;
    return !it.cap || can(role, it.cap);
  };
  const visibleGroups = MENU_GROUPS
    .filter((g) => !isPerHead || PER_HEAD_ALLOWED_GROUPS.has(g.id))
    .map((g) => ({
      ...g,
      items: g.items
        .map((it) => (it.children ? { ...it, children: it.children.filter(allowed) } : it))
        .filter((it) => (it.children ? it.children.length > 0 : allowed(it))),
    }))
    .filter((g) => g.items.length > 0);
  const visibleIcons = isExternal
    ? []
    : ICON_ITEMS.filter((it) => (!it.cap || can(role, it.cap)) && (!isPerHead || PER_HEAD_ALLOWED_ICONS.has(it.id)));

  // 실제 이동 가능한 항목(컨테이너는 제외, 하위 소분류로 대체)
  const navItems = visibleGroups.flatMap((g) => g.items.flatMap((it) => it.children ?? [it]));
  // 접근 가능한 전체 탭 id 집합 (방어용)
  const allowedIds = new Set<string>([...navItems.map((it) => it.id), ...visibleIcons.map((it) => it.id)]);
  // 기본 탭: 접근 가능하면 현재 탭, 아니면 첫 접근가능 탭
  const firstItem = visibleGroups[0]?.items[0];
  const firstAllowed = (firstItem?.children ? firstItem.children[0]?.id : firstItem?.id) ?? 'wizard';
  const cur = allowedIds.has(curTab) ? curTab : firstAllowed;

  // 현재 탭이 속한 대분류 (버튼 강조용)
  const activeGroupId = visibleGroups.find((g) => g.items.some((it) => it.id === cur || it.children?.some((c) => c.id === cur)))?.id ?? null;

  // 바깥 클릭 / ESC 로 드롭다운 닫기
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) { setOpenMenu(null); setOpenSub(null); }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpenMenu(null); setOpenSub(null); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  // 브라우저 뒤로/앞으로가 사이트를 벗어나지 않고 앱 내 탭 사이를 이동하게 한다.
  // 탭 변경마다 history 항목을 쌓고, popstate 시 해당 탭으로 복원한다.
  useEffect(() => {
    history.replaceState({ jaytab: curTab }, '');
    const onPop = (e: PopStateEvent) => {
      const t = (e.state as { jaytab?: string } | null)?.jaytab;
      if (t) {
        fromPop.current = true;
        setCurTab(t);
        setReloadKey((k) => k + 1);
        setOpenMenu(null);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!navMounted.current) { navMounted.current = true; return; } // 초기 렌더는 replaceState가 처리
    if (fromPop.current) { fromPop.current = false; return; } // 뒤로가기로 인한 변경은 push 안 함
    history.pushState({ jaytab: curTab }, '');
  }, [curTab]);

  // 탭 이동: 화면 remount(key 변경)로 데이터 새로고침. 청구서 작성은 항상 새 청구서부터.
  function goTab(id: string) {
    if (id === 'wizard') resetNew();
    setCurTab(id);
    setReloadKey((k) => k + 1);
    setOpenMenu(null);
    setOpenSub(null);
  }

  const curLabel =
    navItems.find((it) => it.id === cur)?.label ??
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
                  {g.items.map((it) =>
                    it.children ? (
                      // 중분류(컨테이너): 클릭/호버 시 하위 소분류를 바로 아래로 펼침(아코디언).
                      <div key={it.id}>
                        <button
                          className={`h-dropdown-item${it.children.some((c) => c.id === cur) ? ' on' : ''}`}
                          role="menuitem"
                          aria-haspopup="true"
                          aria-expanded={openSub === it.id}
                          onClick={() => setOpenSub((s) => (s === it.id ? null : it.id))}
                          onMouseEnter={() => setOpenSub(it.id)}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%' }}
                        >
                          <span>{it.label}</span>
                          <span style={{ color: '#9aa0ad', fontSize: 11 }}>{openSub === it.id ? '▾' : '▸'}</span>
                        </button>
                        {openSub === it.id &&
                          it.children.map((c) => (
                            <button
                              key={c.id}
                              className={`h-dropdown-item${cur === c.id ? ' on' : ''}`}
                              role="menuitem"
                              onClick={() => goTab(c.id)}
                              style={{ paddingLeft: 28, fontSize: 12 }}
                            >
                              {c.label}
                            </button>
                          ))}
                      </div>
                    ) : (
                      <button
                        key={it.id}
                        className={`h-dropdown-item${cur === it.id ? ' on' : ''}`}
                        role="menuitem"
                        onClick={() => goTab(it.id)}
                      >
                        {it.label}
                      </button>
                    ),
                  )}
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

      {readonly && (
        <div
          role="status"
          style={{
            background: '#fff4e5', borderBottom: '1px solid #f0c98a', color: '#8a5a00',
            padding: '8px 16px', fontSize: 12.5, fontWeight: 600, textAlign: 'center',
          }}
        >
          🔒 읽기 전용 테스트 계정입니다 — 모든 기능을 열람·사용할 수 있으나 저장·변경·삭제는 서버에서 차단됩니다.
        </div>
      )}

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
      return <ConsultTab />;
    case 'consult-log':
      return <ConsultLogTab />;
    case 'library':
      return <LibraryTab />;
    case 'ai-usage':
      return <AiUsageTab />;

    // ── 신규 대분류 (골격 — 기능 개발 예정) ──────────────────────
    case 'clients-hub-home':
      return <PlaceholderTab title="🏢 거래처관리" desc="거래처 정보를 통합 관리하는 대분류입니다. (개발 예정 — 향후 세무조정수수료관리의 거래처 관리가 이곳으로 이관될 예정)" />;
    case 'billing-req-home':
      return <PlaceholderTab title="🧾 기장 및 개별업무 청구관리" desc="기장·개별 업무 건별 청구를 관리하는 대분류입니다. (설계 예정)" />;
    // 일반업무관리 › 문서발송관리
    case 'doc-contacts':
      return <DocClientsTab />;
    case 'doc-request':
      return <PlaceholderTab title="✉️ 발송요청" desc="거래처 담당자에게 보낼 문서 발송을 요청합니다. (설계 예정 · 전 직원 + 인당회계사 등급 요청 가능 예정)" />;
    case 'doc-process':
      return <PlaceholderTab title="🖨️ 발송요청 처리" desc="요청된 발송 건을 담당자가 처리합니다. (설계 예정 · 최고관리자/기장팀장/기장팀원)" />;
    case 'doc-status':
      return <PlaceholderTab title="📊 발송업무 현황" desc="발송 요청·처리 내역을 결합해 진행현황을 보여주는 대시보드입니다. (설계 예정)" />;
    // 일반업무관리 › 기타 중분류
    case 'inquiry-send':
      return <PlaceholderTab title="📮 조회서 발송관리" desc="설계 예정" />;
    case 'vacation':
      return <PlaceholderTab title="🌴 휴가관리" desc="설계 예정" />;
    case 'estimate':
      return <PlaceholderTab title="🧮 견적산출 시스템" desc="설계 예정" />;

    default:
      return (
        <div className="card">
          <div className="chdr">{curLabel || '알 수 없는 메뉴'}</div>
          <div className="alert-i">알 수 없는 메뉴입니다.</div>
        </div>
      );
  }
}
