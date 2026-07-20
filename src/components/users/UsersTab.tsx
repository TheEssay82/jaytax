// 사용자/계정 관리 탭 — 최고관리자(superuser) 전용. 역할 배정 + 담당자명 설정.
import { useEffect, useState } from 'react';
import { ROLES, ROLE_LABELS, type Role } from '../../lib/roles';
import { listProfiles, updateProfile, createEmployee, type UserProfile } from '../../lib/usersApi';
import { useAuth } from '../../context/AuthContext';

export default function UsersTab() {
  const { user } = useAuth();
  const [rows, setRows] = useState<UserProfile[]>([]);
  const [edits, setEdits] = useState<Record<string, { role: Role; name: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  // 직원 추가 폼
  const [nEmail, setNEmail] = useState('');
  const [nPw, setNPw] = useState('');
  const [nName, setNName] = useState('');
  const [nRole, setNRole] = useState<Role>('team_member');
  const [adding, setAdding] = useState(false);

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

  const [lockingId, setLockingId] = useState<string | null>(null);

  /** 쓰기잠금 토글 — 서버에서도 최고관리자만 바꿀 수 있다(0042). */
  async function toggleLock(r: UserProfile) {
    const next = !r.readonly;
    const q = next
      ? `‘${r.name || r.email}’ 계정을 쓰기잠금할까요?
조회는 되지만 저장·변경·삭제가 서버에서 차단됩니다.`
      : `‘${r.name || r.email}’ 계정의 쓰기잠금을 해제할까요?
이 계정으로 실제 데이터를 저장·삭제할 수 있게 됩니다.`;
    if (!confirm(q)) return;
    setLockingId(r.id);
    try {
      await updateProfile(r.id, { readonly: next });
      await load();
      flash(next ? `🔒 ${r.name} 계정을 잠갔습니다.` : `🔓 ${r.name} 계정의 잠금을 해제했습니다.`);
    } catch (e) {
      alert(e instanceof Error ? e.message : '변경하지 못했습니다.');
    } finally {
      setLockingId(null);
    }
  }

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(''), 2500);
  }

  async function addEmployee() {
    if (!nEmail.trim() || !nPw.trim()) {
      alert('이메일과 비밀번호를 입력하세요.');
      return;
    }
    setAdding(true);
    try {
      await createEmployee({ email: nEmail.trim(), password: nPw, name: nName.trim(), role: nRole });
      setNEmail('');
      setNPw('');
      setNName('');
      setNRole('team_member');
      await load();
      flash('✓ 직원 추가됨');
    } catch (e) {
      alert('직원 추가 실패: ' + (e instanceof Error ? e.message : e));
    } finally {
      setAdding(false);
    }
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

      <div className="card" style={{ background: '#F5F1EB' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 8 }}>＋ 직원 추가 (계정 생성)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div className="frow">
            <span className="fl">이메일<span className="req">*</span></span>
            <input value={nEmail} placeholder="staff@jaytax.co.kr" onChange={(e) => setNEmail(e.target.value)} />
          </div>
          <div className="frow">
            <span className="fl">비밀번호<span className="req">*</span></span>
            <input value={nPw} placeholder="6자 이상" onChange={(e) => setNPw(e.target.value)} />
          </div>
          <div className="frow">
            <span className="fl">담당자명</span>
            <input value={nName} placeholder="예: 김동주" onChange={(e) => setNName(e.target.value)} />
          </div>
          <div className="frow">
            <span className="fl">역할</span>
            <select
              value={nRole}
              onChange={(e) => setNRole(e.target.value as Role)}
              style={{ padding: '4px 7px', fontSize: 12 }}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button className="btn-p" style={{ marginTop: 7 }} onClick={addEmployee} disabled={adding}>
          {adding ? '생성 중…' : '직원 계정 생성'}
        </button>
        <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>
          ※ 담당자명은 통계 본인필터·청구서 담당자와 매칭되니 정확히 입력하세요.
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>담당자명 (이름)</th>
              <th>이메일</th>
              <th style={{ minWidth: 130 }}>역할</th>
              <th style={{ width: 118, textAlign: 'center' }}>쓰기잠금</th>
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
                  <td style={{ fontSize: 11, color: '#666' }}>{r.email || '-'}</td>
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
                  <td style={{ textAlign: 'center' }}>
                    <button
                      className="btn-sm"
                      disabled={isMe || lockingId === r.id}
                      title={
                        isMe
                          ? '본인 계정은 잠글 수 없습니다'
                          : r.readonly
                            ? '잠금 해제 — 저장·변경·삭제가 가능해집니다'
                            : '쓰기잠금 — 조회만 가능해집니다(서버에서 차단)'
                      }
                      onClick={() => void toggleLock(r)}
                      style={{
                        fontSize: 10.5,
                        padding: '2px 8px',
                        fontWeight: 700,
                        ...(r.readonly
                          ? { background: '#FEE2E2', color: '#B91C1C' }
                          : { background: '#D1FAE5', color: '#065F46' }),
                      }}
                    >
                      {lockingId === r.id ? '…' : r.readonly ? '🔒 잠김' : '🔓 쓰기가능'}
                    </button>
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
