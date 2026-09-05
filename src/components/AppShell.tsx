import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { WizardProvider, useWizard } from '../context/WizardContext';
import { ConfigProvider } from '../context/ConfigContext';
import { can, ROLE_LABELS, PER_HEAD_ALLOWED_ICONS } from '../lib/roles';
import PasswordModal from './PasswordModal';
import MfaModal from './MfaModal';
import NotificationBell from './NotificationBell';
import BizRegistryTab from './clients/BizRegistryTab';
import SalesContractTab from './clients/SalesContractTab';
import BizContactsTab from './clients/BizContactsTab';
import BizStatusTab from './clients/BizStatusTab';
import WizardTab from './wizard/WizardTab';
import HistoryTab from './history/HistoryTab';
import RequestsTab from './requests/RequestsTab';
import TargetSelectionTab from './targets/TargetSelectionTab';
import InvoiceRequestTab from './billing/InvoiceRequestTab';
import ErpReconcileTab from './billing/ErpReconcileTab';
import AuditInvoiceTab from './billing/AuditInvoiceTab';
import ReceivableTab from './billing/ReceivableTab';
import StaffRevenueTab from './billing/StaffRevenueTab';
import CommandPalette, { type PaletteTarget } from './common/CommandPalette';
import { useFitTableHeights } from '../lib/fillHeight';
import { unsavedLabels, useBeforeUnloadGuard } from '../lib/unsaved';
import { setMineOnly, useMineOnly } from '../lib/mineOnly';
import ReceivableOpeningTab from './billing/ReceivableOpeningTab';
import SettingsTab from './settings/SettingsTab';
import StatsTab from './stats/StatsTab';
import UsersTab from './users/UsersTab';
import AccessLogTab from './users/AccessLogTab';
import RetentionTab from './users/RetentionTab';
import BacklogTab from './common/BacklogTab';
import ServiceLimitsTab from './common/ServiceLimitsTab';
import StandardsTab from './advisory/StandardsTab';
import TaxLawTab from './advisory/TaxLawTab';
import ConsultTab from './advisory/ConsultTab';
import LibraryTab from './advisory/LibraryTab';
import ConsultLogTab from './advisory/ConsultLogTab';
import AiUsageTab from './advisory/AiUsageTab';
import DocSendTab from './docsend/DocSendTab';
import DocSendStatusTab from './docsend/DocSendStatusTab';
import EvidenceTab from './evidence/EvidenceTab';
import ConfirmRegisterTab from './confirm/ConfirmRegisterTab';
import ConfirmDispatchTab from './confirm/ConfirmDispatchTab';
import ConfirmCollectTab from './confirm/ConfirmCollectTab';
import ConfirmStatusTab from './confirm/ConfirmStatusTab';
import InternalHome from './home/InternalHome';
import PlaceholderTab from './common/PlaceholderTab';
import DevNotesModal from './common/DevNotesModal';
import { MENU_GROUPS, ICON_ITEMS, menuAllowed, groupAllowed, type MenuItem } from '../lib/menu';

/** 옛 탭 주소 → 지금 화면. 합치거나 이름을 바꿀 때 여기 한 줄을 더한다. */
const TAB_ALIAS: Record<string, string> = {
  'doc-request': 'doc-send-work',
  'doc-process': 'doc-send-work',
};

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
  const { user, signOut, role, readonly, profileName } = useAuth();
  const { resetNew } = useWizard();
  const [curTab, setCurTab] = useState('home');
  const [reloadKey, setReloadKey] = useState(0);
  const [showPw, setShowPw] = useState(false);
  const [showMfa, setShowMfa] = useState(false);
  const [showDevNotes, setShowDevNotes] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openSub, setOpenSub] = useState<string | null>(null); // 열린 중분류 플라이아웃 서브메뉴
  const [openPalette, setOpenPalette] = useState(0);   // 값이 바뀌면 팔레트가 열린다(단추용)
  const navRef = useRef<HTMLElement>(null);
  const fromPop = useRef(false); // popstate로 인한 탭 변경이면 pushState 생략
  const navMounted = useRef(false);
  const curTabRef = useRef<string>('');   // popstate 안에서 '지금 탭'을 보기 위한 거울

  // 표가 화면 아래 끝까지 차게 한다 — 화면이 바뀌면 다시 잰다.
  useFitTableHeights(`${curTab}-${reloadKey}`);
  useBeforeUnloadGuard();
  const mineOnly = useMineOnly();

  // 권한 필터링된 메뉴 그룹/아이콘.
  //  · 외부인: 정해진 조회 메뉴만(EXTERNAL_ALLOWED_TABS), 아이콘 메뉴 없음.
  //  · 인당회계사: 허용된 대분류(PER_HEAD_ALLOWED_GROUPS)만 + 숨김 탭 제외(PER_HEAD_HIDDEN_TABS) + 허용 아이콘만.
  const isExternal = role === 'external';
  const isPerHead = role === 'per_head_accountant';
  const allowed = (it: MenuItem) => menuAllowed(role, profileName, it);
  const visibleGroups = MENU_GROUPS
    .filter((g) => groupAllowed(role, g))
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
  // 접근 가능한 전체 탭 id 집합 (방어용). 내부홈은 외부인 제외 전원에게 허용(로고 클릭 랜딩).
  const allowedIds = new Set<string>([...navItems.map((it) => it.id), ...visibleIcons.map((it) => it.id)]);
  // 옛 주소를 새 화면으로 잇는다 — 홈 타일·즐겨찾기가 「발송요청 및 처리」로 합쳐지기 전
  // 주소를 가리키고 있어, 이어 두지 않으면 엉뚱한 첫 화면으로 튕긴다.
  for (const [old, now] of Object.entries(TAB_ALIAS)) if (allowedIds.has(now)) allowedIds.add(old);
  if (!isExternal) allowedIds.add('home');
  // 기본 탭: 접근 가능하면 현재 탭, 아니면 첫 접근가능 탭
  const firstItem = visibleGroups[0]?.items[0];
  const firstAllowed = (firstItem?.children ? firstItem.children[0]?.id : firstItem?.id) ?? 'wizard';
  const cur = allowedIds.has(curTab) ? curTab : firstAllowed;

  // 현재 탭이 속한 대분류 (버튼 강조용). 옛 주소로 들어왔으면 이어진 화면으로 찾는다.
  const curCanon = TAB_ALIAS[cur] ?? cur;
  const activeGroupId = visibleGroups.find((g) => g.items.some((it) => it.id === curCanon || it.children?.some((c) => c.id === curCanon)))?.id ?? null;

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
  //
  // ⚠️ 여기서 한 번 틀렸었다 — 되돌아간 곳이 **지금 탭과 같으면** setCurTab 이 아무 일도 안 해
  // 아래 [curTab] 효과가 돌지 않고, `fromPop` 이 true 로 남았다. 그러면 **다음 이동의 push 가 통째로
  // 건너뛰어져** 그 다음 뒤로가기가 한 칸을 넘어 뛰고, 결국 홈까지 밀려났다.
  // 그래서 '실제로 탭이 바뀔 때만' 표시를 세운다.
  useEffect(() => {
    history.replaceState({ jaytab: curTab }, '');
    const onPop = (e: PopStateEvent) => {
      const t = (e.state as { jaytab?: string } | null)?.jaytab;
      if (!t || t === curTabRef.current) return;
      fromPop.current = true;
      setCurTab(t);
      setReloadKey((k) => k + 1);
      setOpenMenu(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    curTabRef.current = curTab;
    if (!navMounted.current) { navMounted.current = true; return; } // 초기 렌더는 replaceState가 처리
    if (fromPop.current) { fromPop.current = false; return; } // 뒤로가기로 인한 변경은 push 안 함
    history.pushState({ jaytab: curTab }, '');
  }, [curTab]);

  // 탭 이동: 화면 remount(key 변경)로 데이터 새로고침. 청구서 작성은 항상 새 청구서부터.
  //
  // 옮기면 지금 화면은 통째로 사라진다. 고치던 것이 있으면 **말없이 잃지 않게** 먼저 묻는다.
  // 손을 댄 폼만 세므로(unsaved.ts), 열어만 보고 나가는 데는 걸리지 않는다.
  function goTab(id: string) {
    if (id === cur) { setOpenMenu(null); setOpenSub(null); return; }
    const pending = unsavedLabels();
    if (pending.length > 0
      && !confirm(`저장하지 않은 것이 있습니다 — ${pending.join(' · ')}.
화면을 옮기면 사라집니다. 그래도 옮길까요?`)) {
      setOpenMenu(null); setOpenSub(null);
      return;
    }
    if (id === 'wizard') resetNew();
    setCurTab(id);
    setReloadKey((k) => k + 1);
    setOpenMenu(null);
    setOpenSub(null);
  }

  // Ctrl+K 가 보여 줄 화면 목록 — 권한 판단은 위에서 이미 끝났다. 여기서 다시 하지 않는다.
  const paletteTargets: PaletteTarget[] = [
    ...visibleGroups.flatMap((g) => g.items.flatMap((it) => (it.children ?? [it]).map((c) => ({
      id: c.id, label: c.label, group: g.label,
    })))),
    ...visibleIcons.map((it) => ({ id: it.id, label: `${it.icon} ${it.label}`, group: '관리' })),
    ...(isExternal ? [] : [{ id: 'home', label: '🏠 내부홈', group: '' }]),
  ];

  const curLabel =
    navItems.find((it) => it.id === curCanon)?.label ??
    visibleIcons.find((it) => it.id === curCanon)?.label ??
    '';

  return (
    <>
      <header id="hdr">
        <button
          type="button"
          onClick={() => goTab('home')}
          title="홈으로"
          aria-label="홈으로"
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', flexShrink: 0 }}
        >
          <img className="h-logoimg" src="/logo2.png" alt="JAY · 세무회계 지원" />
        </button>
        <button
          type="button"
          className="h-ver"
          title="개발노트 보기"
          onClick={() => setShowDevNotes(true)}
          style={{
            fontSize: 'var(--fs-1)', color: 'var(--ink-3)', fontWeight: 600, marginLeft: 6,
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          }}
        >
          v{__APP_VERSION__} 📓
        </button>

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
                          <span style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)' }}>{openSub === it.id ? '▾' : '▸'}</span>
                        </button>
                        {openSub === it.id &&
                          it.children.map((c) => (
                            <button
                              key={c.id}
                              className={`h-dropdown-item${cur === c.id ? ' on' : ''}`}
                              role="menuitem"
                              onClick={() => goTab(c.id)}
                              style={{ paddingLeft: 28, fontSize: 'var(--fs-2)' }}
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

        {/* 어디서든 찾기 — 눌러도 열리고 Ctrl+K 로도 열린다.
            단축키만 두면 아무도 모른다. */}
        <button className="cmdk-open" onClick={() => setOpenPalette((v) => v + 1)}
          title="화면·거래처를 이름으로 바로 찾습니다 (Ctrl+K)">
          🔍 찾기 <kbd>Ctrl</kbd><kbd>K</kbd>
        </button>

        {!isExternal && (
          <button className={`mine-sw${mineOnly ? ' on' : ''}`}
            onClick={() => setMineOnly(!mineOnly)}
            aria-pressed={mineOnly}
            title={mineOnly
              ? '지금 내 담당만 보고 있습니다. 누르면 전체가 보입니다.'
              : '매출계약·수금미수금·현황조회·발행요청이 내 담당만 보이게 됩니다.'}>
            <span className="mine-dot" />
            내 것만
          </button>
        )}

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
          {role !== 'external' && <NotificationBell onNavigate={goTab} />}
          <span className="h-title">
            <span className="h-email">{user?.email}</span>
            <span className="bdg b-on" style={{ marginLeft: 6, fontSize: 'var(--fs-0)' }}>
              {ROLE_LABELS[role]}
            </span>
          </span>
          <button className="ha" onClick={() => setShowPw(true)}>
            비밀번호 변경
          </button>
          <button className="ha" onClick={() => setShowMfa(true)} title="로그인할 때 인증 앱의 숫자 6자리를 함께 묻습니다">
            2차 인증
          </button>
          <button className="ha" onClick={signOut}>
            로그아웃
          </button>
        </div>
      </header>

      {showPw && <PasswordModal onClose={() => setShowPw(false)} />}
      {showMfa && <MfaModal onClose={() => setShowMfa(false)} />}
      {showDevNotes && <DevNotesModal onClose={() => setShowDevNotes(false)} />}

      {readonly && (
        <div
          role="status"
          style={{
            background: '#fff4e5', borderBottom: '1px solid #f0c98a', color: '#8a5a00',
            padding: '8px 16px', fontSize: 'var(--fs-2)', fontWeight: 600, textAlign: 'center',
          }}
        >
          🔒 읽기 전용 테스트 계정입니다 — 모든 기능을 열람·사용할 수 있으나 저장·변경·삭제는 서버에서 차단됩니다.
        </div>
      )}

      <main id="main" key={`${cur}-${reloadKey}`}>
        <TabContent cur={cur} setCurTab={setCurTab} curLabel={curLabel} onNavigate={goTab} onOpenDevNotes={() => setShowDevNotes(true)} />
      </main>

      {/* 어디서든 찾기 — Ctrl+K. 화면 어디에 있든 뜨도록 맨 바깥에 둔다. */}
      <CommandPalette targets={paletteTargets} onGo={goTab} openSignal={openPalette} />
    </>
  );
}

function TabContent({
  cur,
  setCurTab,
  curLabel,
  onNavigate,
  onOpenDevNotes,
}: {
  cur: string;
  setCurTab: (id: string) => void;
  curLabel: string;
  onNavigate: (id: string) => void;
  onOpenDevNotes: () => void;
}) {
  switch (cur) {
    case 'home':
      return <InternalHome onNavigate={onNavigate} onOpenDevNotes={onOpenDevNotes} />;
    case 'wizard':
      return <WizardTab />;
    case 'history':
      return <HistoryTab onSwitchTab={setCurTab} />;
    case 'targets':
      return <TargetSelectionTab />;
    case 'stats':
      return <StatsTab />;
    case 'settings':
      return <SettingsTab />;
    case 'requests':
      return <RequestsTab />;
    case 'users':
      return <UsersTab />;
    case 'access-log':
      return <AccessLogTab />;
    case 'retention':
      return <RetentionTab />;
    case 'backlog':
      return <BacklogTab />;
    case 'service-limits':
      return <ServiceLimitsTab />;
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

    // ── 거래처관리 대분류 (2.0.0) ──────────────────────
    case 'clients-hub-home': // 구 진입점 — 거래처등록으로 대체
    case 'biz-register':
      return <BizRegistryTab />;
    case 'biz-contract':
      return <SalesContractTab />;
    case 'biz-contacts':
      return <BizContactsTab />;
    case 'biz-status':
      return <BizStatusTab />;
    case 'invoice-request':
      return <InvoiceRequestTab />;
    case 'audit-invoice':
      return <AuditInvoiceTab />;
    case 'staff-revenue':
      return <StaffRevenueTab />;
    case 'receivable':
      return <ReceivableTab />;
    case 'erp-reconcile':
      return <ErpReconcileTab />;
    case 'receivable-opening':
      return <ReceivableOpeningTab />;
    // 일반업무관리 › 문서발송관리
    case 'doc-send-work':
    case 'doc-request':
      return <DocSendTab />;
    // 홈의 「처리 대기 발송요청」 타일은 처리 자리로 바로 연다.
    case 'doc-process':
      return <DocSendTab initial="process" />;
    case 'doc-status':
      return <DocSendStatusTab />;
    // 일반업무관리 › 자료실
    case 'evidence':
      return <EvidenceTab />;
    // 일반업무관리 › 기타 중분류
    case 'inquiry-send':
    case 'conf-register':
      return <ConfirmRegisterTab />;
    case 'conf-dispatch':
      return <ConfirmDispatchTab />;
    case 'conf-collect':
      return <ConfirmCollectTab />;
    case 'conf-status':
      return <ConfirmStatusTab />;
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
