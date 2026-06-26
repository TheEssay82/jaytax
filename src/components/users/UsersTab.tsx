// 사용자/계정 관리 탭 — 최고관리자(superuser) 전용. 역할 배정 + 담당자명 설정.
import { useEffect, useState } from 'react';
import { ROLES, ROLE_LABELS, type Role } from '../../lib/roles';
import { listProfiles, updateProfile, type UserProfile } from '../../lib/usersApi';
import { useAuth } from '../../context/AuthContext';

export default function UsersTab() {
  const { user } = useAuth();
  const [rows, setRows] = useState<UserProfile[]>([]);
  const [edits, setEdits] = useState<Record<string, { role: Role; name: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  async function load() {
    try {
      setError(null);
      const data = await listProfiles();
      setRows(data);
      setEdits(Object.fromEntries(data.map((r) => [r.id, { role: r.role, name: r.name }])));
    } catch (e) {
      setError(e instanceof Error ? e.message : '사용자를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(''), 2500);
  }

  async function save(id: string) {
    const e = edits[id];
    if (!e) return;
    setSavingId(id);
    try {
      await updateProfile(id, { role: e.role, name: e.name.trim() });
      await load();
      flash('✓ 저장됨');
    } catch (err) {
      alert('저장 실패: ' + (err instanceof Error ? err.message : err));
    } finally {
      setSavingId(null);
    }
  }

  const dirty = (id: string) => {
    const r = rows.find((x) => x.id === id);
    const e = edits[id];
    return r && e && (r.role !== e.role || r.name !== e.name);
  };

  if (loading) {
    return (
      <div className="card">
        <div className="chdr">👤 사용자 관리</div>
        <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>불러오는 중…</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="chdr">
        사용자 / 계정 관리 (총 {rows.length}명)
        {msg && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#059669' }}>{msg}</span>}
      </div>

      {error && <div className="alert-w">{error}</div>}
      <div className="alert-i" style={{ fontSize: 11 }}>
        신규 계정 추가는 Supabase 대시보드(Authentication → Users)에서 합니다. 여기서는 <strong>역할</strong>과{' '}
        <strong>담당자명</strong>을 지정합니다. 담당자명은 통계 본인필터·청구서 담당자와 매칭되니 정확히 입력하세요.
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>담당자명 (이름)</th>
              <th style={{ minWidth: 130 }}>역할</th>
              <th>가입일</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const e = edits[r.id] || { role: r.role, name: r.name };
              const isMe = r.id === user?.id;
              return (
                <tr key={r.id}>
                  <td>
                    <input
                      value={e.name}
                      onChange={(ev) =>
                        setEdits((p) => ({ ...p, [r.id]: { ...e, name: ev.target.value } }))
                      }
                      style={{ width: '100%', minWidth: 180 }}
                      placeholder="예: 김동주"
                    />
                  </td>
                  <td>
                    <select
                      value={e.role}
                      onChange={(ev) =>
                        setEdits((p) => ({ ...p, [r.id]: { ...e, role: ev.target.value as Role } }))
                      }
                      style={{ width: '100%', padding: '4px 6px', fontSize: 12 }}
                      disabled={isMe}
                      title={isMe ? '본인 역할은 변경할 수 없습니다' : ''}
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ fontSize: 10, color: '#999', whiteSpace: 'nowrap' }}>
                    {r.createdAt ? r.createdAt.split('T')[0].replace(/-/g, '.') : ''}
                    {isMe && <span className="bdg b-on" style={{ marginLeft: 5, fontSize: 9 }}>나</span>}
                  </td>
                  <td>
                    <button
                      className="btn-sm btn-sm-blue"
                      onClick={() => save(r.id)}
                      disabled={!dirty(r.id) || savingId === r.id}
                    >
                      {savingId === r.id ? '저장 중…' : '저장'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
