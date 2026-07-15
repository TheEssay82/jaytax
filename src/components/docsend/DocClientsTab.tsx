// 문서발송 › 거래처 담당자 관리 — 계층형(거래처 회사 → 담당자) CRUD + 회사명 변경이력 + 변경 로그
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  listDocClients,
  createDocClient,
  updateDocClient,
  deleteDocClient,
  createDocContact,
  updateDocContact,
  deleteDocContact,
  listNameHistory,
  listAuditLog,
  DOC_ACCOUNTANTS,
  type DocClient,
  type DocContact,
  type DocNameHistory,
  type DocAudit,
} from '../../lib/docClientsApi';

const dtTime = (s?: string): string => {
  if (!s) return '';
  const d = new Date(s);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// ── 폼 데이터 타입 ──────────────────────────────────────────
interface ContactDraft {
  contactName: string;
  honorific: string;
  phone: string;
  email: string;
  address: string;
  note: string;
}
const emptyContact = (): ContactDraft => ({ contactName: '', honorific: '', phone: '', email: '', address: '', note: '' });

export default function DocClientsTab() {
  const { readonly } = useAuth();
  const canWrite = !readonly;
  const [clients, setClients] = useState<DocClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const [filter, setFilter] = useState('');
  const [acctFilter, setAcctFilter] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [editClientId, setEditClientId] = useState<string | null>(null);
  const [addContactFor, setAddContactFor] = useState<string | null>(null);
  const [editContactId, setEditContactId] = useState<string | null>(null);

  const [historyFor, setHistoryFor] = useState<DocClient | null>(null);
  const [historyRows, setHistoryRows] = useState<DocNameHistory[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [logRows, setLogRows] = useState<DocAudit[]>([]);

  async function load() {
    try {
      setError(null);
      setClients(await listDocClients());
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오지 못했습니다.');
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

  const totalContacts = useMemo(() => clients.reduce((s, c) => s + c.contacts.length, 0), [clients]);

  const view = useMemo(() => {
    let list = clients;
    if (acctFilter) list = list.filter((c) => c.accountant === acctFilter);
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      list = list.filter((c) => {
        if (c.companyName.toLowerCase().includes(q) || c.accountant.toLowerCase().includes(q)) return true;
        return c.contacts.some(
          (t) =>
            t.contactName.toLowerCase().includes(q) ||
            (t.phone || '').toLowerCase().includes(q) ||
            (t.email || '').toLowerCase().includes(q) ||
            (t.address || '').toLowerCase().includes(q),
        );
      });
    }
    return list;
  }, [clients, filter, acctFilter]);

  // ── 액션 ─────────────────────────────────────────────────
  async function handleAddClient(company: { companyName: string; accountant: string; note: string }, first: ContactDraft) {
    try {
      const id = await createDocClient(company);
      await createDocContact({ clientId: id, ...first });
      setShowAdd(false);
      await load();
      flash('✓ 거래처 등록됨');
    } catch (e) {
      alert('등록 실패: ' + (e instanceof Error ? e.message : e));
    }
  }
  async function handleSaveClient(id: string, patch: { companyName: string; accountant: string; note: string }) {
    try {
      await updateDocClient(id, patch);
      setEditClientId(null);
      await load();
      flash('✓ 거래처 수정됨');
    } catch (e) {
      alert('수정 실패: ' + (e instanceof Error ? e.message : e));
    }
  }
  async function handleDeleteClient(c: DocClient) {
    if (!confirm(`'${c.companyName}' 거래처와 담당자 ${c.contacts.length}명을 모두 삭제하시겠습니까?`)) return;
    try {
      await deleteDocClient(c.id);
      await load();
      flash('✓ 거래처 삭제됨');
    } catch (e) {
      alert('삭제 실패: ' + (e instanceof Error ? e.message : e));
    }
  }
  async function handleAddContact(clientId: string, d: ContactDraft) {
    try {
      await createDocContact({ clientId, ...d });
      setAddContactFor(null);
      await load();
      flash('✓ 담당자 추가됨');
    } catch (e) {
      alert('추가 실패: ' + (e instanceof Error ? e.message : e));
    }
  }
  async function handleSaveContact(id: string, d: ContactDraft) {
    try {
      await updateDocContact(id, d);
      setEditContactId(null);
      await load();
      flash('✓ 담당자 수정됨');
    } catch (e) {
      alert('수정 실패: ' + (e instanceof Error ? e.message : e));
    }
  }
  async function handleDeleteContact(t: DocContact) {
    if (!confirm(`담당자 '${t.contactName}'을(를) 삭제하시겠습니까?`)) return;
    try {
      await deleteDocContact(t.id);
      await load();
      flash('✓ 담당자 삭제됨');
    } catch (e) {
      alert('삭제 실패: ' + (e instanceof Error ? e.message : e));
    }
  }
  async function openHistory(c: DocClient) {
    setHistoryFor(c);
    try {
      setHistoryRows(await listNameHistory(c.id));
    } catch {
      setHistoryRows([]);
    }
  }
  async function openLog() {
    setShowLog(true);
    try {
      setLogRows(await listAuditLog(200));
    } catch {
      setLogRows([]);
    }
  }

  if (loading) {
    return (
      <div className="card">
        <div className="chdr">👤 거래처 담당자 관리</div>
        <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>불러오는 중…</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="chdr">
        거래처 담당자 관리 (거래처 {clients.length}개 · 담당자 {totalContacts}명)
        {msg && <span style={{ marginLeft: 12, fontSize: 11, color: '#059669' }}>{msg}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 5, alignItems: 'center' }}>
          <button className="btn-sm btn-sm-blue" onClick={openLog}>
            📜 변경 로그
          </button>
          {canWrite && (
            <button
              className="btn-sm"
              onClick={() => {
                setShowAdd((v) => !v);
                setEditClientId(null);
              }}
            >
              + 새 거래처
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert-w">{error}</div>}
      <div className="alert-i" style={{ fontSize: 11 }}>
        📄 문서발송 대상 거래처(회사)와 담당자를 관리합니다. <b>회사명·담당회계사·담당자명·호칭·수령지주소</b>는 필수이며, 호칭 미기재 시 <b>‘님’</b>으로 저장됩니다. 회사명을 바꾸면 <b>변경이력</b>이 남고, 모든 등록·수정·삭제는 <b>담당자와 함께 로그</b>에 기록됩니다.
        {!canWrite && <span style={{ color: '#8a5a00' }}> · 🔒 읽기전용 계정은 조회만 가능합니다.</span>}
      </div>

      {showAdd && canWrite && <AddClientForm onSubmit={handleAddClient} onCancel={() => setShowAdd(false)} />}

      <div className="sbar">
        <input placeholder="🔍 회사명·담당자·회계사·연락처·주소" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select value={acctFilter} onChange={(e) => setAcctFilter(e.target.value)}>
          <option value="">담당회계사 전체</option>
          {DOC_ACCOUNTANTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: '#888' }}>{view.length}개 표시</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {view.length === 0 && (
          <div style={{ textAlign: 'center', padding: 24, color: '#BBB' }}>표시할 거래처가 없습니다.</div>
        )}
        {view.map((c) => (
          <div key={c.id} style={{ border: '1px solid #E3DED3', borderRadius: 8, overflow: 'hidden' }}>
            {editClientId === c.id ? (
              <div style={{ padding: 12, background: '#F5F1EB' }}>
                <ClientEditForm client={c} onSave={(p) => handleSaveClient(c.id, p)} onCancel={() => setEditClientId(null)} />
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  background: '#FaF8F4',
                  borderBottom: '1px solid #Eee',
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontWeight: 700, color: '#1A2B52', fontSize: 14 }}>{c.companyName}</span>
                <span className="bdg b-on" style={{ fontSize: 10 }}>
                  {c.accountant}
                </span>
                <span style={{ fontSize: 11, color: '#888' }}>담당자 {c.contacts.length}명</span>
                {c.note && <span style={{ fontSize: 11, color: '#a06a00' }}>· {c.note}</span>}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  <button className="btn-sm btn-sm-blue" title="회사명 변경이력" onClick={() => openHistory(c)}>
                    🕘 이력
                  </button>
                  {canWrite && (
                    <>
                      <button className="btn-sm btn-sm-blue" title="거래처 수정" onClick={() => { setEditClientId(c.id); setShowAdd(false); }}>
                        ✏️ 수정
                      </button>
                      <button className="btn-sm" title="담당자 추가" onClick={() => { setAddContactFor(c.id); setEditContactId(null); }}>
                        ＋ 담당자
                      </button>
                      <button className="btn-sm btn-sm-del" title="거래처 삭제" onClick={() => handleDeleteClient(c)}>
                        🗑
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {addContactFor === c.id && canWrite && (
              <div style={{ padding: 12, background: '#EEF6FF', borderBottom: '1px solid #DDE' }}>
                <ContactForm
                  title="＋ 담당자 추가"
                  onSave={(d) => handleAddContact(c.id, d)}
                  onCancel={() => setAddContactFor(null)}
                />
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 90 }}>담당자명</th>
                    <th style={{ minWidth: 70 }}>호칭</th>
                    <th style={{ minWidth: 110 }}>연락처</th>
                    <th style={{ minWidth: 150 }}>이메일</th>
                    <th>수령지주소</th>
                    {canWrite && <th style={{ width: 70 }}>관리</th>}
                  </tr>
                </thead>
                <tbody>
                  {c.contacts.length === 0 && (
                    <tr>
                      <td colSpan={canWrite ? 6 : 5} style={{ textAlign: 'center', color: '#BBB', padding: 12 }}>
                        담당자 없음 — ‘＋ 담당자’로 추가하세요.
                      </td>
                    </tr>
                  )}
                  {c.contacts.map((t) =>
                    editContactId === t.id ? (
                      <tr key={t.id}>
                        <td colSpan={canWrite ? 6 : 5} style={{ background: '#EEF6FF' }}>
                          <ContactForm
                            title="✏️ 담당자 수정"
                            initial={t}
                            onSave={(d) => handleSaveContact(t.id, d)}
                            onCancel={() => setEditContactId(null)}
                          />
                        </td>
                      </tr>
                    ) : (
                      <tr key={t.id}>
                        <td style={{ fontWeight: 600 }}>{t.contactName}</td>
                        <td>{t.honorific}</td>
                        <td style={{ fontSize: 11 }}>{t.phone || <span style={{ color: '#CCC' }}>—</span>}</td>
                        <td style={{ fontSize: 11 }}>{t.email || <span style={{ color: '#CCC' }}>—</span>}</td>
                        <td style={{ fontSize: 11.5 }}>{t.address || <span style={{ color: '#CCC' }}>—</span>}</td>
                        {canWrite && (
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn-sm btn-sm-blue" title="수정" onClick={() => { setEditContactId(t.id); setAddContactFor(null); }}>
                                ✏️
                              </button>
                              <button className="btn-sm btn-sm-del" title="삭제" onClick={() => handleDeleteContact(t)}>
                                🗑
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {historyFor && (
        <HistoryModal client={historyFor} rows={historyRows} onClose={() => setHistoryFor(null)} />
      )}
      {showLog && <LogModal rows={logRows} onClose={() => setShowLog(false)} />}
    </div>
  );
}

// ── 새 거래처 등록 폼 (회사 + 첫 담당자) ─────────────────────
function AddClientForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (company: { companyName: string; accountant: string; note: string }, first: ContactDraft) => void;
  onCancel: () => void;
}) {
  const [companyName, setCompanyName] = useState('');
  const [accountant, setAccountant] = useState<string>(DOC_ACCOUNTANTS[0]);
  const [note, setNote] = useState('');
  const [c, setC] = useState<ContactDraft>(emptyContact());
  const set = (k: keyof ContactDraft) => (e: React.ChangeEvent<HTMLInputElement>) => setC((p) => ({ ...p, [k]: e.target.value }));

  function submit() {
    if (!companyName.trim() || !accountant || !c.contactName.trim() || !c.address.trim()) {
      alert('회사명·담당회계사·담당자명·수령지주소는 필수입니다.');
      return;
    }
    onSubmit({ companyName: companyName.trim(), accountant, note: note.trim() }, c);
  }

  return (
    <div className="card" style={{ background: '#F5F1EB' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 8 }}>＋ 새 거래처 등록</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
        <div className="frow">
          <span className="fl">회사명<span className="req">*</span></span>
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="예: ㈜유니테스트" />
        </div>
        <div className="frow">
          <span className="fl">담당회계사<span className="req">*</span></span>
          <select value={accountant} onChange={(e) => setAccountant(e.target.value)} style={{ padding: '4px 7px', fontSize: 12 }}>
            {DOC_ACCOUNTANTS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div className="frow" style={{ gridColumn: '1 / -1' }}>
          <span className="fl">비고</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="(선택)" />
        </div>
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#345', margin: '10px 0 6px' }}>· 담당자 정보</div>
      <ContactFields c={c} set={set} />
      <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
        <button className="btn-p" onClick={submit}>거래처 등록</button>
        <button className="btn-sm" onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

// ── 거래처(회사) 수정 폼 ────────────────────────────────────
function ClientEditForm({
  client,
  onSave,
  onCancel,
}: {
  client: DocClient;
  onSave: (p: { companyName: string; accountant: string; note: string }) => void;
  onCancel: () => void;
}) {
  const [companyName, setCompanyName] = useState(client.companyName);
  const [accountant, setAccountant] = useState(client.accountant);
  const [note, setNote] = useState(client.note);
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 8 }}>✏️ 거래처 수정</div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', gap: '0 14px' }}>
        <div className="frow">
          <span className="fl">회사명<span className="req">*</span></span>
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        </div>
        <div className="frow">
          <span className="fl">담당회계사<span className="req">*</span></span>
          <select value={accountant} onChange={(e) => setAccountant(e.target.value)} style={{ padding: '4px 7px', fontSize: 12 }}>
            {DOC_ACCOUNTANTS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
            {!DOC_ACCOUNTANTS.includes(accountant as (typeof DOC_ACCOUNTANTS)[number]) && (
              <option value={accountant}>{accountant} (기존)</option>
            )}
          </select>
        </div>
        <div className="frow">
          <span className="fl">비고</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#8a5a00', margin: '2px 0 8px' }}>
        ※ 회사명을 바꾸면 변경이력이 기록되며, 과거 발송기록은 과거 회사명으로 유지됩니다.
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          className="btn-p"
          onClick={() => {
            if (!companyName.trim() || !accountant) {
              alert('회사명·담당회계사는 필수입니다.');
              return;
            }
            onSave({ companyName: companyName.trim(), accountant, note: note.trim() });
          }}
        >
          저장
        </button>
        <button className="btn-sm" onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

// ── 담당자 폼 (추가/수정 공용) ──────────────────────────────
function ContactForm({
  title,
  initial,
  onSave,
  onCancel,
}: {
  title: string;
  initial?: DocContact;
  onSave: (d: ContactDraft) => void;
  onCancel: () => void;
}) {
  const [c, setC] = useState<ContactDraft>(
    initial
      ? {
          contactName: initial.contactName,
          honorific: initial.honorific,
          phone: initial.phone,
          email: initial.email,
          address: initial.address,
          note: initial.note,
        }
      : emptyContact(),
  );
  const set = (k: keyof ContactDraft) => (e: React.ChangeEvent<HTMLInputElement>) => setC((p) => ({ ...p, [k]: e.target.value }));
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 6 }}>{title}</div>
      <ContactFields c={c} set={set} />
      <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
        <button
          className="btn-p"
          onClick={() => {
            if (!c.contactName.trim() || !c.address.trim()) {
              alert('담당자명·수령지주소는 필수입니다.');
              return;
            }
            onSave(c);
          }}
        >
          저장
        </button>
        <button className="btn-sm" onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

function ContactFields({
  c,
  set,
}: {
  c: ContactDraft;
  set: (k: keyof ContactDraft) => (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
      <div className="frow">
        <span className="fl">담당자명<span className="req">*</span></span>
        <input value={c.contactName} onChange={set('contactName')} placeholder="예: 이상화" />
      </div>
      <div className="frow">
        <span className="fl">호칭</span>
        <input value={c.honorific} onChange={set('honorific')} placeholder="미기재 시 ‘님’ (예: 팀장, 프로)" />
      </div>
      <div className="frow">
        <span className="fl">연락처</span>
        <input value={c.phone} onChange={set('phone')} placeholder="(선택) 010-0000-0000" />
      </div>
      <div className="frow">
        <span className="fl">이메일</span>
        <input value={c.email} onChange={set('email')} placeholder="(선택)" />
      </div>
      <div className="frow" style={{ gridColumn: '1 / -1' }}>
        <span className="fl">수령지주소<span className="req">*</span></span>
        <input value={c.address} onChange={set('address')} placeholder="문서 수령지 주소" />
      </div>
    </div>
  );
}

// ── 회사명 변경이력 모달 ────────────────────────────────────
function HistoryModal({ client, rows, onClose }: { client: DocClient; rows: DocNameHistory[]; onClose: () => void }) {
  return (
    <Modal title={`🕘 회사명 변경이력 — ${client.companyName}`} onClose={onClose}>
      {rows.length === 0 ? (
        <div style={{ padding: 16, color: '#888', fontSize: 12.5 }}>변경 이력이 없습니다.</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>변경일시</th>
              <th>이전 회사명</th>
              <th>변경 회사명</th>
              <th>담당자</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.id}>
                <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{dtTime(h.changedAt)}</td>
                <td>{h.oldName}</td>
                <td style={{ fontWeight: 600 }}>{h.newName}</td>
                <td>{h.changedByName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

// ── 변경 로그 모달 ──────────────────────────────────────────
function LogModal({ rows, onClose }: { rows: DocAudit[]; onClose: () => void }) {
  const actionLabel = (a: DocAudit['action']) => (a === 'insert' ? '등록' : a === 'update' ? '수정' : '삭제');
  const actionColor = (a: DocAudit['action']) => (a === 'insert' ? '#059669' : a === 'update' ? '#2563eb' : '#dc2626');
  return (
    <Modal title="📜 변경 로그 (최근 200건)" onClose={onClose}>
      {rows.length === 0 ? (
        <div style={{ padding: 16, color: '#888', fontSize: 12.5 }}>기록이 없습니다.</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ minWidth: 120 }}>일시</th>
              <th>담당자</th>
              <th>작업</th>
              <th>내용</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{dtTime(r.at)}</td>
                <td style={{ fontWeight: 600 }}>{r.actorName}</td>
                <td style={{ color: actionColor(r.action), fontWeight: 700, fontSize: 11 }}>
                  {r.entity === 'client' ? '거래처' : '담당자'} {actionLabel(r.action)}
                </td>
                <td style={{ fontSize: 12 }}>{r.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

// ── 공용 모달 ───────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 10, maxWidth: 820, width: '100%', maxHeight: '80vh',
          overflow: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #eee', position: 'sticky', top: 0, background: '#fff' }}>
          <span style={{ fontWeight: 700, color: '#1A2B52' }}>{title}</span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>
        <div style={{ padding: 12 }}>{children}</div>
      </div>
    </div>
  );
}
