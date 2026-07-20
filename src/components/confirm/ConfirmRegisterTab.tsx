// 조회서발송관리 › 조회서등록
// 위: 신규 등록 폼(회계연도·거래처·기준일·담당회계사) + 전기 리스트 가져오기
// 아래: 등록된 조회서 목록 — 수정·삭제, 조회처 명세 편집으로 진입
import { useEffect, useMemo, useRef, useState } from 'react';
import { listDocClients, type DocClient } from '../../lib/docClientsApi';
import { listProfiles, type UserProfile } from '../../lib/usersApi';
import {
  listConfirmations,
  listFiscalYears,
  createConfirmation,
  updateConfirmation,
  deleteConfirmation,
  copyFromYear,
  defaultFiscalYear,
  fiscalYearOptions,
  defaultBaseDate,
  type Confirmation,
} from '../../lib/confirmApi';
import ConfirmItemsModal from './ConfirmItemsModal';

/** 담당회계사 후보 — 최고관리자·회계사·인당회계사 */
const ACCOUNTANT_ROLES = ['superuser', 'accountant', 'per_head_accountant'];

export default function ConfirmRegisterTab() {
  const [clients, setClients] = useState<DocClient[]>([]);
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [rows, setRows] = useState<Confirmation[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  // 신규 등록 폼
  const [fy, setFy] = useState(defaultFiscalYear());
  const [clientQ, setClientQ] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [baseDate, setBaseDate] = useState(defaultBaseDate(defaultFiscalYear()));
  const [acctId, setAcctId] = useState('');
  const [saving, setSaving] = useState(false);

  // 목록 필터·편집 상태
  const [filterYear, setFilterYear] = useState<number | 'all'>(defaultFiscalYear());
  const [editId, setEditId] = useState<string | null>(null);
  const [itemsFor, setItemsFor] = useState<Confirmation | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  async function load() {
    try {
      setError(null);
      const [cs, ps, list, ys] = await Promise.all([
        listDocClients(),
        listProfiles(),
        listConfirmations(),
        listFiscalYears(),
      ]);
      setClients(cs);
      setPeople(ps.filter((p) => ACCOUNTANT_ROLES.includes(p.role)));
      setRows(list);
      setYears(ys);
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
    setTimeout(() => setMsg(''), 3000);
  }

  // 회계연도를 바꾸면 기준일을 그 해 12/31 로 맞춰 준다(직접 고친 뒤라도 연도 변경은 우선).
  function changeYear(y: number) {
    setFy(y);
    setBaseDate(defaultBaseDate(y));
  }

  // 거래처 자동완성 — 전기에 조회서를 보낸 곳을 위로 올린다.
  const priorClientIds = useMemo(
    () => new Set(rows.filter((r) => r.fiscalYear < fy).map((r) => r.clientId)),
    [rows, fy],
  );
  const suggestions = useMemo(() => {
    const q = clientQ.trim().toLowerCase();
    const taken = new Set(rows.filter((r) => r.fiscalYear === fy).map((r) => r.clientId));
    const list = clients.filter((c) => !q || c.companyName.toLowerCase().includes(q));
    return [...list]
      .sort((a, b) => {
        const pa = priorClientIds.has(a.id) ? 0 : 1;
        const pb = priorClientIds.has(b.id) ? 0 : 1;
        return pa - pb || a.companyName.localeCompare(b.companyName, 'ko');
      })
      .slice(0, 40)
      .map((c) => ({ ...c, already: taken.has(c.id) }));
  }, [clients, clientQ, rows, fy, priorClientIds]);

  const view = useMemo(
    () => (filterYear === 'all' ? rows : rows.filter((r) => r.fiscalYear === filterYear)),
    [rows, filterYear],
  );

  async function handleCreate() {
    const c = clients.find((x) => x.id === clientId);
    if (!c) {
      alert('거래처를 목록에서 선택하세요.');
      return;
    }
    if (!acctId) {
      alert('담당회계사를 선택하세요.');
      return;
    }
    const p = people.find((x) => x.id === acctId);
    setSaving(true);
    try {
      await createConfirmation({
        fiscalYear: fy,
        clientId: c.id,
        companyName: c.companyName,
        baseDate,
        accountantId: acctId,
        accountantName: p?.name ?? '',
      });
      setClientQ('');
      setClientId(null);
      await load();
      setFilterYear(fy);
      flash(`✅ ${c.companyName} ${fy}년 조회서를 등록했습니다. 아래 목록에서 조회처를 입력하세요.`);
    } catch (e) {
      alert(e instanceof Error ? e.message : '등록하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(r: Confirmation) {
    const warn =
      r.itemCount > 0
        ? `‘${r.companyName}’ ${r.fiscalYear}년 조회서를 삭제하면 등록된 조회처 ${r.itemCount}건도 함께 삭제됩니다. 계속할까요?`
        : `‘${r.companyName}’ ${r.fiscalYear}년 조회서를 삭제할까요?`;
    if (!confirm(warn)) return;
    try {
      await deleteConfirmation(r.id);
      await load();
      flash('🗑 삭제했습니다.');
    } catch (e) {
      alert(e instanceof Error ? e.message : '삭제하지 못했습니다.');
    }
  }

  if (loading) {
    return (
      <div className="card">
        <div className="chdr">📮 조회서등록</div>
        <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>불러오는 중…</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="chdr">조회서등록</div>

      {error && <div className="alert-w">{error}</div>}
      {msg && <div className="alert-s" style={{ fontSize: 12 }}>{msg}</div>}

      <div className="alert-i" style={{ fontSize: 11 }}>
        📮 감사 <b>기준일</b> 현재의 잔액 확인을 위해 보낼 <b>금융기관조회서</b>를 거래처·회계연도별로 등록합니다.
        먼저 아래에서 <b>회계연도·거래처·기준일·담당회계사</b>를 등록한 뒤, 목록에서 <b>조회처(금융기관) 명세</b>를 입력합니다.
        전년도에 보낸 적이 있으면 <b>‘전기 조회서 가져오기’</b>로 거래처를 골라 통째로 복사한 뒤 증감분만 고치는 편이 빠릅니다.
      </div>

      {/* ── 신규 등록 ── */}
      <div style={{ background: '#FaF8F4', border: '1px solid #E3DED3', borderRadius: 10, padding: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <b style={{ fontSize: 12.5, color: '#1A2B52' }}>＋ 새 조회서 등록</b>
          <button
            className="btn-sm btn-sm-blue"
            style={{ marginLeft: 'auto', fontSize: 11 }}
            onClick={() => setImportOpen(true)}
            title="전기에 등록한 조회서를 거래처 단위로 골라 당기로 복사합니다"
          >
            📋 전기 조회서 가져오기
          </button>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="frow" style={{ minWidth: 110 }}>
            <span className="fl">회계연도<span className="req">*</span></span>
            <select value={fy} onChange={(e) => changeYear(Number(e.target.value))}>
              {fiscalYearOptions().map((y) => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
          </div>

          <div className="frow" style={{ minWidth: 260, position: 'relative' }}>
            <span className="fl">거래처명<span className="req">*</span></span>
            <ClientPicker
              query={clientQ}
              onQuery={(v) => { setClientQ(v); setClientId(null); }}
              selectedId={clientId}
              onSelect={(c) => { setClientId(c.id); setClientQ(c.companyName); }}
              suggestions={suggestions}
              priorIds={priorClientIds}
            />
          </div>

          <div className="frow" style={{ minWidth: 160 }}>
            <span className="fl">조회발송기준일<span className="req">*</span></span>
            <input type="date" value={baseDate} onChange={(e) => setBaseDate(e.target.value)} />
          </div>

          <div className="frow" style={{ minWidth: 150 }}>
            <span className="fl">담당회계사<span className="req">*</span></span>
            <select value={acctId} onChange={(e) => setAcctId(e.target.value)}>
              <option value="">선택</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <button className="btn-p" disabled={saving || !clientId || !acctId} onClick={() => void handleCreate()}>
            {saving ? '등록 중…' : '＋ 등록'}
          </button>
        </div>
      </div>

      {/* ── 등록된 조회서 목록 ── */}
      <div className="sbar">
        <select value={String(filterYear)} onChange={(e) => setFilterYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">전체 연도</option>
          {[...new Set([defaultFiscalYear(), ...years])].sort((a, b) => b - a).map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: '#888' }}>{view.length}건</span>
        <button className="btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => void load()}>🔄 새로고침</button>
      </div>

      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 78, textAlign: 'center' }}>회계연도</th>
              <th>거래처명</th>
              <th style={{ width: 116, textAlign: 'center' }}>조회발송기준일</th>
              <th style={{ width: 100 }}>담당회계사</th>
              <th style={{ width: 96, textAlign: 'center' }}>조회처</th>
              <th style={{ width: 80, textAlign: 'center' }}>상태</th>
              <th style={{ width: 120 }}>관리</th>
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: '#BBB', padding: 24 }}>등록된 조회서가 없습니다.</td></tr>
            )}
            {view.map((r) =>
              editId === r.id ? (
                <EditRow
                  key={r.id}
                  row={r}
                  people={people}
                  onCancel={() => setEditId(null)}
                  onSaved={async () => { setEditId(null); await load(); flash('✅ 수정했습니다.'); }}
                />
              ) : (
                <tr key={r.id}>
                  <td style={{ textAlign: 'center', fontSize: 12 }}>{r.fiscalYear}</td>
                  <td style={{ fontSize: 12.5 }}><b style={{ color: '#1A2B52' }}>{r.companyName}</b></td>
                  <td style={{ textAlign: 'center', fontSize: 11.5 }}>{r.baseDate?.replace(/-/g, '.')}</td>
                  <td style={{ fontSize: 12 }}>{r.accountantName || <span style={{ color: '#CCC' }}>—</span>}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      className="btn-sm btn-sm-blue"
                      style={{ fontSize: 11, padding: '2px 8px' }}
                      onClick={() => setItemsFor(r)}
                      title="조회처(금융기관) 명세 입력·수정"
                    >
                      {r.itemCount > 0 ? `${r.itemCount}건 ✏️` : '＋ 입력'}
                    </button>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span
                      className="bdg"
                      style={{
                        fontSize: 10,
                        ...(r.status === '등록완료'
                          ? { background: '#D1FAE5', color: '#065F46' }
                          : { background: '#FEF3C7', color: '#92400E' }),
                      }}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn-sm btn-sm-blue" title="수정" onClick={() => setEditId(r.id)}>✏️</button>
                      <button className="btn-sm btn-sm-del" title="삭제" onClick={() => void handleDelete(r)}>🗑</button>
                    </div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {itemsFor && (
        <ConfirmItemsModal
          confirmation={itemsFor}
          onClose={() => setItemsFor(null)}
          onChanged={() => void load()}
        />
      )}
      {importOpen && (
        <ImportModal
          rows={rows}
          targetYear={fy}
          onClose={() => setImportOpen(false)}
          onDone={async (n) => { setImportOpen(false); await load(); setFilterYear(fy); flash(`📋 ${n}건을 ${fy}년으로 복사했습니다.`); }}
        />
      )}
    </div>
  );
}

/** 거래처 자동완성 — 타이핑하면 걸러지고, 비어 있으면 전체 목록이 뜬다. */
function ClientPicker({
  query, onQuery, selectedId, onSelect, suggestions, priorIds,
}: {
  query: string;
  onQuery: (v: string) => void;
  selectedId: string | null;
  onSelect: (c: DocClient) => void;
  suggestions: (DocClient & { already: boolean })[];
  priorIds: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <input
        value={query}
        placeholder="거래처명 입력 또는 클릭해 선택"
        onChange={(e) => { onQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        style={{ width: '100%', borderColor: selectedId ? '#86C39A' : undefined }}
      />
      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30,
            background: '#fff', border: '1px solid #ddd', borderRadius: 8,
            maxHeight: 260, overflowY: 'auto', boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
          }}
        >
          {suggestions.length === 0 ? (
            <div style={{ padding: 10, fontSize: 12, color: '#888' }}>
              일치하는 거래처가 없습니다. 거래처 담당자 관리에서 먼저 등록해 주세요.
            </div>
          ) : (
            suggestions.map((c) => (
              <button
                key={c.id}
                disabled={c.already}
                onClick={() => { onSelect(c); setOpen(false); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', border: 'none',
                  background: 'transparent', padding: '6px 10px', fontSize: 12.5,
                  cursor: c.already ? 'not-allowed' : 'pointer', color: c.already ? '#BBB' : '#333',
                }}
                title={c.already ? '이 회계연도에 이미 등록된 거래처입니다' : undefined}
              >
                {priorIds.has(c.id) && <span style={{ color: '#2563eb', fontSize: 10 }}>전기 ﹒ </span>}
                {c.companyName}
                {c.already && <span style={{ fontSize: 10, color: '#B91C1C' }}> (등록됨)</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** 목록 인라인 수정 — 기준일·담당회계사·상태만 고친다(연도·거래처는 정체성이라 삭제 후 재등록). */
function EditRow({
  row, people, onCancel, onSaved,
}: {
  row: Confirmation;
  people: UserProfile[];
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [baseDate, setBaseDate] = useState(row.baseDate);
  const [acctId, setAcctId] = useState(row.accountantId ?? '');
  const [status, setStatus] = useState<string>(row.status);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const p = people.find((x) => x.id === acctId);
      await updateConfirmation(row.id, {
        baseDate,
        accountantId: acctId || null,
        accountantName: p?.name ?? '',
        status,
      });
      await onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장하지 못했습니다.');
      setBusy(false);
    }
  }

  return (
    <tr style={{ background: '#EEF6FF' }}>
      <td style={{ textAlign: 'center', fontSize: 12 }}>{row.fiscalYear}</td>
      <td style={{ fontSize: 12.5 }}>{row.companyName}</td>
      <td><input type="date" value={baseDate} onChange={(e) => setBaseDate(e.target.value)} style={{ width: '100%', fontSize: 11.5 }} /></td>
      <td>
        <select value={acctId} onChange={(e) => setAcctId(e.target.value)} style={{ width: '100%', fontSize: 12 }}>
          <option value="">선택</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </td>
      <td style={{ textAlign: 'center', fontSize: 11, color: '#888' }}>{row.itemCount}건</td>
      <td>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: '100%', fontSize: 11.5 }}>
          <option value="작성중">작성중</option>
          <option value="등록완료">등록완료</option>
        </select>
      </td>
      <td>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn-sm btn-p" disabled={busy} onClick={() => void save()}>저장</button>
          <button className="btn-sm" disabled={busy} onClick={onCancel}>취소</button>
        </div>
      </td>
    </tr>
  );
}

/** 전기 조회서 가져오기 — 원본 연도를 고르고, 거래처를 체크해 당기로 복사 */
function ImportModal({
  rows, targetYear, onClose, onDone,
}: {
  rows: Confirmation[];
  targetYear: number;
  onClose: () => void;
  onDone: (copied: number) => void | Promise<void>;
}) {
  const years = useMemo(
    () => [...new Set(rows.map((r) => r.fiscalYear))].filter((y) => y !== targetYear).sort((a, b) => b - a),
    [rows, targetYear],
  );
  const [from, setFrom] = useState<number | null>(years[0] ?? null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const takenClients = useMemo(
    () => new Set(rows.filter((r) => r.fiscalYear === targetYear).map((r) => r.clientId)),
    [rows, targetYear],
  );
  const sources = useMemo(
    () => rows.filter((r) => r.fiscalYear === from).sort((a, b) => a.companyName.localeCompare(b.companyName, 'ko')),
    [rows, from],
  );
  const copyable = sources.filter((s) => !takenClients.has(s.clientId));

  async function run() {
    if (!from || sel.size === 0) return;
    setBusy(true);
    setErr(null);
    try {
      const { copied, skipped } = await copyFromYear(from, targetYear, [...sel]);
      if (skipped.length) alert(`이미 ${targetYear}년에 등록되어 건너뛴 거래처: ${skipped.join(', ')}`);
      await onDone(copied);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '복사하지 못했습니다.');
      setBusy(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, maxWidth: 620, width: '100%', maxHeight: '82vh', overflow: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #eee', position: 'sticky', top: 0, background: '#fff' }}>
          <span style={{ fontWeight: 700, color: '#1A2B52' }}>📋 전기 조회서 가져오기 → {targetYear}년</span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>

        <div style={{ padding: 14 }}>
          {years.length === 0 ? (
            <div style={{ padding: 16, color: '#888', fontSize: 12.5, textAlign: 'center' }}>
              가져올 다른 연도의 등록분이 없습니다.
            </div>
          ) : (
            <>
              <div className="alert-i" style={{ fontSize: 11, marginBottom: 10 }}>
                선택한 거래처의 <b>조회처 명세가 그대로 복사</b>되고, 기준일은 <b>{targetYear}-12-31</b>로 바뀝니다.
                발송·회수 기록은 따라오지 않습니다. 이미 {targetYear}년에 등록된 거래처는 건너뜁니다.
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: '#555' }}>원본 연도</span>
                <select value={from ?? ''} onChange={(e) => { setFrom(Number(e.target.value)); setSel(new Set()); }}>
                  {years.map((y) => <option key={y} value={y}>{y}년</option>)}
                </select>
                <button
                  className="btn-sm"
                  style={{ fontSize: 11 }}
                  onClick={() => setSel(new Set(copyable.map((s) => s.id)))}
                >
                  전체선택 ({copyable.length})
                </button>
                <button className="btn-sm" style={{ fontSize: 11 }} onClick={() => setSel(new Set())}>해제</button>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#1A2B52', fontWeight: 700 }}>{sel.size}건 선택</span>
              </div>

              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 34, textAlign: 'center' }}>☑</th>
                    <th>거래처명</th>
                    <th style={{ width: 80, textAlign: 'center' }}>조회처</th>
                    <th style={{ width: 100 }}>담당회계사</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => {
                    const taken = takenClients.has(s.clientId);
                    return (
                      <tr key={s.id} style={taken ? { color: '#BBB' } : undefined}>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            disabled={taken}
                            checked={sel.has(s.id)}
                            onChange={() =>
                              setSel((p) => {
                                const n = new Set(p);
                                if (n.has(s.id)) n.delete(s.id); else n.add(s.id);
                                return n;
                              })
                            }
                          />
                        </td>
                        <td style={{ fontSize: 12.5 }}>
                          {s.companyName}
                          {taken && <span style={{ fontSize: 10, color: '#B91C1C' }}> · {targetYear}년 등록됨</span>}
                        </td>
                        <td style={{ textAlign: 'center', fontSize: 11.5 }}>{s.itemCount}건</td>
                        <td style={{ fontSize: 12 }}>{s.accountantName}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {err && <div className="alert-w" style={{ fontSize: 11.5, marginTop: 10 }}>{err}</div>}

              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn-sm" onClick={onClose} disabled={busy}>취소</button>
                <button className="btn-p" disabled={busy || sel.size === 0} onClick={() => void run()}>
                  {busy ? '복사 중…' : `${sel.size}건 가져오기`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
