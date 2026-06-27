import { useState } from 'react';
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

/** 원본 TABS 정의 */
export const TABS: [string, string][] = [
  ['wizard', '📝 청구서 작성'],
  ['clients', '🏢 거래처 관리'],
  ['targets', '✅ 청구대상'],
  ['history', '📋 청구기록'],
  ['stats', '📊 통계'],
  ['requests', '💬 업데이트요청'],
  ['settings', '⚙️ 설정'],
  ['users', '👤 사용자 관리'],
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

// 탭별 표시에 필요한 권한 (없으면 전원 표시)
const TAB_CAP: Partial<Record<string, Capability>> = {
  clients: 'manageClients',
  targets: 'manageTargets',
  settings: 'changeSettings',
  users: 'manageUsers',
};

function Shell() {
  const { user, signOut, role } = useAuth();
  const { resetNew } = useWizard();
  const [curTab, setCurTab] = useState('wizard');
  const [showPw, setShowPw] = useState(false);

  const visibleTabs = TABS.filter(([id]) => {
    const cap = TAB_CAP[id];
    return !cap || can(role, cap);
  });

  // 탭 클릭: 청구서 작성 탭은 항상 새 청구서(거래처 선택, 1단계)부터 시작
  function clickTab(id: string) {
    if (id === 'wizard') resetNew();
    setCurTab(id);
  }

  // 권한 없는 탭이 현재 선택돼 있으면 청구서 작성으로 되돌림(방어)
  const cur = visibleTabs.some(([id]) => id === curTab) ? curTab : 'wizard';

  return (
    <>
      <header id="hdr">
        <span className="h-logo">인덕회계법인</span>
        <span className="h-sep" />
        <span className="h-title">세무조정수수료 관리시스템</span>
        <span
          className="h-ver"
          title={`앱 버전 v${__APP_VERSION__}`}
          style={{ fontSize: 11, color: '#9aa0ad', fontWeight: 600, marginLeft: 6 }}
        >
          v{__APP_VERSION__}
        </span>
        <nav className="h-nav" id="h-nav">
          {visibleTabs.map(([id, lbl]) => (
            <button
              key={id}
              className={`h-tab${cur === id ? ' on' : ''}`}
              onClick={() => clickTab(id)}
            >
              {lbl}
            </button>
          ))}
        </nav>
        <div className="h-acts">
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
      <main id="main">
        {cur === 'wizard' ? (
          <WizardTab />
        ) : cur === 'clients' ? (
          <ClientsTab />
        ) : cur === 'history' ? (
          <HistoryTab onSwitchTab={setCurTab} />
        ) : cur === 'targets' ? (
          <TargetsTab />
        ) : cur === 'requests' ? (
          <RequestsTab />
        ) : cur === 'settings' ? (
          <SettingsTab />
        ) : cur === 'stats' ? (
          <StatsTab />
        ) : cur === 'users' ? (
          <UsersTab />
        ) : (
          <div className="card">
            <div className="chdr">{TABS.find(([id]) => id === cur)?.[1]}</div>
            <div className="alert-i">알 수 없는 탭입니다.</div>
          </div>
        )}
      </main>
    </>
  );
}
