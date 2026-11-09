// 넵튠이용자(client_user) 가 jaytax.co.kr 첫 화면으로 들어오면 본 앱(메뉴) 대신 자기 회사 1118 화면으로 보낸다.
// 연결된 회사가 하나면 주소를 /kifrs1118_<회사키> 로 바꿔 그 화면을 연다.
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { listIfrs18Clients, type Ifrs18ClientRow } from '../../lib/ifrs18Api';
import Ifrs18Page from './Ifrs18Page';

export default function ClientUserHome() {
  const { signOut } = useAuth();
  const [rows, setRows] = useState<Ifrs18ClientRow[] | null>(null);
  useEffect(() => { listIfrs18Clients().then(setRows).catch(() => setRows([])); }, []);
  useEffect(() => {
    if (rows?.length === 1) history.replaceState(null, '', `/kifrs1118_${rows[0].key}`);
  }, [rows]);
  if (rows === null) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--ink-3)' }}>불러오는 중…</div>;
  if (rows.length === 1) return <Ifrs18Page clientKey={rows[0].key} />;
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <div className="card" style={{ minWidth: 320 }}>
        <b>K-IFRS 1118 월결산</b>
        {rows.length === 0
          ? <p style={{ color: 'var(--ink-3)' }}>연결된 회사가 없습니다. 인덕회계법인에 연결을 요청해 주세요.</p>
          : <ul>{rows.map((r) => <li key={r.key}><a href={`/kifrs1118_${r.key}`}>{r.name}</a></li>)}</ul>}
        <button className="btn-sm" onClick={() => { void signOut(); }}>로그아웃</button>
      </div>
    </div>
  );
}
