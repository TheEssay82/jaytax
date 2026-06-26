import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { WizardProvider } from '../context/WizardContext';
import ClientsTab from './clients/ClientsTab';
import WizardTab from './wizard/WizardTab';
import HistoryTab from './history/HistoryTab';

/** 원본 TABS 정의 */
export const TABS: [string, string][] = [
  ['wizard', '📝 청구서 작성'],
  ['clients', '🏢 거래처 관리'],
  ['targets', '✅ 청구대상'],
  ['history', '📋 청구기록'],
  ['stats', '📊 통계'],
  ['requests', '💬 업데이트요청'],
  ['settings', '⚙️ 설정'],
];

export default function AppShell() {
  const { user, signOut } = useAuth();
  const [curTab, setCurTab] = useState('wizard');

  return (
    <WizardProvider>
      <header id="hdr">
        <span className="h-logo">인덕회계법인</span>
        <span className="h-sep" />
        <span className="h-title">세무조정수수료 관리시스템</span>
        <nav className="h-nav" id="h-nav">
          {TABS.map(([id, lbl]) => (
            <button
              key={id}
              className={`h-tab${curTab === id ? ' on' : ''}`}
              onClick={() => setCurTab(id)}
            >
              {lbl}
            </button>
          ))}
        </nav>
        <div className="h-acts">
          <span className="h-title">{user?.email}</span>
          <button className="ha" onClick={signOut}>
            로그아웃
          </button>
        </div>
      </header>
      <main id="main">
        {curTab === 'wizard' ? (
          <WizardTab />
        ) : curTab === 'clients' ? (
          <ClientsTab />
        ) : curTab === 'history' ? (
          <HistoryTab onSwitchTab={setCurTab} />
        ) : (
          <div className="card">
            <div className="chdr">{TABS.find(([id]) => id === curTab)?.[1]}</div>
            <div className="alert-i">
              🚧 토대 준비 완료 — 이 탭 화면은 다음 단계에서 원본 기능을 포팅합니다.
            </div>
          </div>
        )}
      </main>
    </WizardProvider>
  );
}
