// 조회서등록 › 조회처(금융기관) 명세 편집
// 한 줄씩 추가·수정·삭제하거나, 엑셀 양식을 업로드해 통째로 채운다.
// 양식 다운로드 2종: 빈 양식(거래처 배포용) / 현재 명세(손봐서 다시 올리는 용도)
import { useEffect, useRef, useState } from 'react';
import {
  listItems,
  addItems,
  updateItem,
  deleteItem,
  replaceItems,
  nextSeq,
  renumberItems,
  updateConfirmation,
  ITEM_KINDS,
  DEFAULT_CONTACT,
  type Confirmation,
  type ConfirmItem,
  type ItemInput,
  type ItemKind,
} from '../../lib/confirmApi';
import { downloadBlankTemplate, downloadItems, parseItemsFile } from '../../lib/confirmExcel';

const emptyInput = (seq: number): ItemInput => ({
  seq,
  kind: '은행',
  institution: '',
  isElectronic: true, // 2025년 260건 중 194건이 전자조회라 이쪽을 기본값으로 둔다
  address: '',
  postalCode: '',
  phone: '',
  dept: '',
  contactName: DEFAULT_CONTACT,
  contactTitle: '',
  note: '',
});

const toInput = (it: ConfirmItem): ItemInput => {
  const { id: _id, confirmationId: _c, ...rest } = it;
  return rest;
};

export default function ConfirmItemsModal({
  confirmation, onClose, onChanged,
}: {
  confirmation: Confirmation;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<ConfirmItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // 부모가 넘긴 confirmation 은 모달이 열린 시점의 스냅샷이라, 여기서 상태를 바꿔도
  // prop 은 그대로다. 화면 표시는 로컬 상태로 들고 가야 토글이 반영된다.
  const [status, setStatus] = useState(confirmation.status);

  const [draft, setDraft] = useState<ItemInput>(emptyInput(1));
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ItemInput>(emptyInput(1));
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      setErr(null);
      const list = await listItems(confirmation.id);
      setItems(list);
      setDraft(emptyInput(list.length + 1));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmation.id]);

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(''), 3000);
  }

  async function run(job: () => Promise<void>, done?: string) {
    setBusy(true);
    setErr(null);
    try {
      await job();
      await load();
      onChanged();
      if (done) flash(done);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const { items: parsed, warnings } = await parseItemsFile(file);
      const replace =
        items.length === 0 ||
        confirm(
          `이미 ${items.length}건이 등록되어 있습니다.\n\n[확인] 기존 명세를 지우고 파일 내용(${parsed.length}건)으로 교체\n[취소] 기존에 이어서 추가`,
        );
      if (replace) await replaceItems(confirmation.id, parsed);
      else await addItems(confirmation.id, parsed.map((p, i) => ({ ...p, seq: items.length + i + 1 })));
      await load();
      onChanged();
      flash(
        `📥 ${parsed.length}건을 ${replace ? '교체' : '추가'}했습니다.` +
          (warnings.length ? `\n⚠️ ${warnings.length}건 확인 필요: ${warnings.slice(0, 3).join(' / ')}${warnings.length > 3 ? ' …' : ''}` : ''),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : '파일을 읽지 못했습니다.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const canComplete = items.length > 0;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, maxWidth: 1180, width: '100%', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
        {/* 머리말 — 조서 상단과 같은 정보 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid #eee', position: 'sticky', top: 0, background: '#fff', zIndex: 2, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: '#1A2B52' }}>
            📮 {confirmation.companyName}
          </span>
          <span style={{ fontSize: 11.5, color: '#666' }}>
            {confirmation.fiscalYear}년 · 기준일 {confirmation.baseDate?.replace(/-/g, '.')} · 담당 {confirmation.accountantName || '—'}
          </span>
          <span style={{ fontSize: 11.5, color: '#1A2B52', fontWeight: 700 }}>조회처 {items.length}건</span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>

        <div style={{ padding: 14 }}>
          {err && <div className="alert-w" style={{ fontSize: 11.5 }}>{err}</div>}
          {msg && <div className="alert-s" style={{ fontSize: 11.5, whiteSpace: 'pre-wrap' }}>{msg}</div>}

          {/* 양식 도구 */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <button
              className="btn-sm btn-sm-blue"
              style={{ fontSize: 11 }}
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              title="작성한 엑셀 양식을 올려 조회처를 한 번에 채웁니다"
            >
              📥 당기 조회서 양식 업로드
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
              }}
            />
            <button
              className="btn-sm"
              style={{ fontSize: 11 }}
              disabled={busy || items.length === 0}
              onClick={() => void downloadItems(confirmation.companyName, confirmation.fiscalYear, items.map(toInput))}
              title="현재 명세를 엑셀로 내려받아 수정 후 다시 올릴 수 있습니다"
            >
              ⬇ 현재 명세 다운로드
            </button>
            <button
              className="btn-sm"
              style={{ fontSize: 11 }}
              disabled={busy}
              onClick={() => void downloadBlankTemplate(confirmation.companyName)}
              title="거래처에 보내 조회처 목록을 받아오는 빈 양식"
            >
              ⬇ 빈 양식 다운로드
            </button>

            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <span
                className="bdg"
                style={{
                  fontSize: 10,
                  ...(status === '등록완료'
                    ? { background: '#D1FAE5', color: '#065F46' }
                    : { background: '#FEF3C7', color: '#92400E' }),
                }}
              >
                {status}
              </span>
              <button
                className="btn-p"
                style={{ fontSize: 11 }}
                disabled={busy || !canComplete}
                title={canComplete ? undefined : '조회처를 1건 이상 등록해야 완료할 수 있습니다'}
                onClick={() => {
                  const next = status === '등록완료' ? '작성중' : '등록완료';
                  void run(
                    async () => {
                      await updateConfirmation(confirmation.id, { status: next });
                      setStatus(next);
                    },
                    next === '등록완료' ? '✅ 등록완료로 표시했습니다.' : '작성중으로 되돌렸습니다.',
                  );
                }}
              >
                {status === '등록완료' ? '↩ 작성중으로' : '✅ 등록완료'}
              </button>
            </span>
          </div>

          <div className="alert-i" style={{ fontSize: 11, marginBottom: 10 }}>
            <b>전자조회</b>는 주소·우편번호가 필요 없어 입력칸이 잠깁니다. 담당자명은 기본값 <b>{DEFAULT_CONTACT}</b>이며 부서·직책은 비워 두어도 됩니다.
            기관별 신청 방법(예: 홈페이지 신청, 착불 수령)은 <b>비고</b>에 적어 두면 다음 해에 그대로 따라옵니다.
          </div>

          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>불러오는 중…</div>
          ) : (
            <div className="tbl-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 40, textAlign: 'center' }}>No.</th>
                    <th style={{ width: 96 }}>구분</th>
                    <th style={{ width: 150 }}>금융기관명</th>
                    <th style={{ width: 88, textAlign: 'center' }}>조회방식</th>
                    <th>주소</th>
                    <th style={{ width: 74 }}>우편번호</th>
                    <th style={{ width: 108 }}>전화번호</th>
                    <th style={{ width: 90 }}>부서</th>
                    <th style={{ width: 130 }}>담당자명</th>
                    <th style={{ width: 74 }}>직책</th>
                    <th style={{ width: 130 }}>비고</th>
                    <th style={{ width: 74 }}>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && (
                    <tr><td colSpan={12} style={{ textAlign: 'center', color: '#BBB', padding: 20 }}>
                      조회처가 없습니다. 아래에서 한 줄씩 추가하거나 엑셀 양식을 업로드하세요.
                    </td></tr>
                  )}
                  {items.map((it, idx) =>
                    editId === it.id ? (
                      <ItemFormRow
                        key={it.id}
                        seq={idx + 1}
                        value={editDraft}
                        onChange={setEditDraft}
                        busy={busy}
                        onSubmit={() => void run(() => updateItem(it.id, editDraft).then(() => setEditId(null)), '✅ 수정했습니다.')}
                        onCancel={() => setEditId(null)}
                        submitLabel="저장"
                      />
                    ) : (
                      <tr key={it.id}>
                        <td style={{ textAlign: 'center', fontSize: 11.5, color: '#888' }}>{idx + 1}</td>
                        <td style={{ fontSize: 12 }}>{it.kind}</td>
                        <td style={{ fontSize: 12.5 }}><b>{it.institution}</b></td>
                        <td style={{ textAlign: 'center' }}>
                          <span
                            className="bdg"
                            style={{
                              fontSize: 10,
                              ...(it.isElectronic
                                ? { background: '#DBEAFE', color: '#1E40AF' }
                                : { background: '#F3F4F6', color: '#6B7280' }),
                            }}
                          >
                            {it.isElectronic ? '전자조회' : '우편'}
                          </span>
                        </td>
                        <td style={{ fontSize: 11.5 }}>
                          {it.isElectronic ? <span style={{ color: '#93a3b8' }}>—</span> : it.address || <span style={{ color: '#CCC' }}>미입력</span>}
                        </td>
                        <td style={{ fontSize: 11.5 }}>{it.postalCode || <span style={{ color: '#CCC' }}>—</span>}</td>
                        <td style={{ fontSize: 11.5 }}>{it.phone || <span style={{ color: '#CCC' }}>—</span>}</td>
                        <td style={{ fontSize: 11.5 }}>{it.dept || <span style={{ color: '#CCC' }}>—</span>}</td>
                        <td style={{ fontSize: 11.5 }}>{it.contactName || <span style={{ color: '#CCC' }}>—</span>}</td>
                        <td style={{ fontSize: 11.5 }}>{it.contactTitle || <span style={{ color: '#CCC' }}>—</span>}</td>
                        <td style={{ fontSize: 11 }} title={it.note}>
                          {it.note ? (it.note.length > 14 ? `${it.note.slice(0, 14)}…` : it.note) : <span style={{ color: '#CCC' }}>—</span>}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 3 }}>
                            <button className="btn-sm btn-sm-blue" title="수정" disabled={busy} onClick={() => { setEditId(it.id); setEditDraft(toInput(it)); }}>✏️</button>
                            <button
                              className="btn-sm btn-sm-del"
                              title="삭제"
                              disabled={busy}
                              onClick={() => {
                                if (!confirm(`‘${it.institution}’을 삭제할까요?`)) return;
                                void run(async () => {
                                  await deleteItem(it.id);
                                  await renumberItems(confirmation.id); // 번호를 1..N 으로 다시 매김
                                }, '🗑 삭제했습니다.');
                              }}
                            >
                              🗑
                            </button>
                          </div>
                        </td>
                      </tr>
                    ),
                  )}

                  {/* 새 줄 추가 */}
                  <ItemFormRow
                    seq={items.length + 1}
                    value={draft}
                    onChange={setDraft}
                    busy={busy}
                    onSubmit={() =>
                      void run(async () => {
                        if (!draft.institution.trim()) throw new Error('금융기관명을 입력하세요.');
                        await addItems(confirmation.id, [{ ...draft, seq: await nextSeq(confirmation.id) }]);
                      }, '＋ 추가했습니다.')
                    }
                    submitLabel="＋ 추가"
                    isNew
                  />
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 입력/수정 공용 행 */
function ItemFormRow({
  seq, value, onChange, onSubmit, onCancel, submitLabel, busy, isNew,
}: {
  seq: number;
  value: ItemInput;
  onChange: (v: ItemInput) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  submitLabel: string;
  busy: boolean;
  isNew?: boolean;
}) {
  const set = (patch: Partial<ItemInput>) => onChange({ ...value, ...patch });
  const cell: React.CSSProperties = { width: '100%', fontSize: 11.5 };

  return (
    <tr style={{ background: isNew ? '#F7FBF7' : '#EEF6FF' }}>
      <td style={{ textAlign: 'center', fontSize: 11.5, color: '#888' }}>{seq}</td>
      <td>
        <select value={value.kind} onChange={(e) => set({ kind: e.target.value as ItemKind })} style={cell}>
          {ITEM_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </td>
      <td>
        <input
          value={value.institution}
          onChange={(e) => set({ institution: e.target.value })}
          placeholder="예: 국민은행"
          style={cell}
          onKeyDown={(e) => { if (e.key === 'Enter' && !busy) onSubmit(); }}
        />
      </td>
      <td>
        <select
          value={value.isElectronic ? 'e' : 'p'}
          onChange={(e) => set({ isElectronic: e.target.value === 'e' })}
          style={cell}
        >
          <option value="e">전자조회</option>
          <option value="p">주소직접입력</option>
        </select>
      </td>
      <td>
        <input
          value={value.isElectronic ? '' : value.address}
          disabled={value.isElectronic}
          onChange={(e) => set({ address: e.target.value })}
          placeholder={value.isElectronic ? '전자조회 (주소 불필요)' : '주소'}
          style={{ ...cell, background: value.isElectronic ? '#F5F5F5' : undefined }}
        />
      </td>
      <td>
        <input
          value={value.isElectronic ? '' : value.postalCode}
          disabled={value.isElectronic}
          onChange={(e) => set({ postalCode: e.target.value })}
          style={{ ...cell, background: value.isElectronic ? '#F5F5F5' : undefined }}
        />
      </td>
      <td><input value={value.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="선택" style={cell} /></td>
      <td><input value={value.dept} onChange={(e) => set({ dept: e.target.value })} placeholder="선택" style={cell} /></td>
      <td><input value={value.contactName} onChange={(e) => set({ contactName: e.target.value })} style={cell} /></td>
      <td><input value={value.contactTitle} onChange={(e) => set({ contactTitle: e.target.value })} placeholder="선택" style={cell} /></td>
      <td><input value={value.note} onChange={(e) => set({ note: e.target.value })} placeholder="신청방법 등" style={cell} /></td>
      <td>
        <div style={{ display: 'flex', gap: 3 }}>
          <button className={isNew ? 'btn-sm btn-p' : 'btn-sm btn-p'} disabled={busy} onClick={onSubmit} style={{ fontSize: 10.5, whiteSpace: 'nowrap' }}>
            {submitLabel}
          </button>
          {onCancel && <button className="btn-sm" disabled={busy} onClick={onCancel} style={{ fontSize: 10.5 }}>취소</button>}
        </div>
      </td>
    </tr>
  );
}
