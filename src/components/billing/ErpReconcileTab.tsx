// 기장등청구관리 › ERP 발행내역 대사 — 엑셀 '대조용' 시트를 대신한다.
//
// 담당자가 매달 하던 「ERP에서 엑셀 내려받기 → 시트에 붙여넣기 → 눈으로 대조」를
// 「끌어다 놓기 → 화면이 분류 → 묶음마다 버튼 하나」로 바꾼 화면이다.
// 설계 원칙 셋: ① 되돌릴 수 있게 ② 먼저 보여주고 나중에 저장 ③ 판단은 사람이.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { listBizEntities, type BizEntityFull } from '../../lib/bizRegistryApi';
import { todayYmd } from '../../lib/format';
import { listInvoiceRequests, type InvoiceRequest } from '../../lib/invoiceRequestApi';
import { FINAL_APPROVER } from '../../lib/invoiceMonthApi';
import {
  parseErpSlipFile, saveSlips, listSlips, clearSlips, getReconcileState, setReconcileDone,
  matchSlips, markMatchedIssued, alignToErp, importErpOnly, importCorrection,
  type ErpSlip, type MatchRow, type MatchResult, type ReconcileState,
} from '../../lib/erpReconcileApi';

const won = (n: number) => n.toLocaleString('ko-KR');
const prevMonth = () => {
  const d = new Date(todayYmd());
  d.setDate(1); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function ErpReconcileTab() {
  const { readonly, role, profileName } = useAuth();
  const canWrite = !readonly && role !== 'per_head_accountant';
  const canFinish = canWrite && (profileName === FINAL_APPROVER || role === 'team_lead' || role === 'superuser');

  const [ym, setYm] = useState(prevMonth);
  const [entities, setEntities] = useState<BizEntityFull[]>([]);
  const [slips, setSlips] = useState<ErpSlip[]>([]);
  const [reqs, setReqs] = useState<InvoiceRequest[]>([]);
  const [state, setState] = useState<ReconcileState | null>(null);
  const [preview, setPreview] = useState<{ rows: ErpSlip[]; skipped: number; fileName: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({ diff: true, erpOnly: true, ourOnly: true, corr: true });
  const [issuedDate, setIssuedDate] = useState(todayYmd);

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 3500); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setErr(null);
      const ents = entities.length ? entities : await listBizEntities();
      if (!entities.length) setEntities(ents);
      const [s, r, st] = await Promise.all([listSlips(ym), listInvoiceRequests(ym), getReconcileState(ym)]);
      setSlips(s); setReqs(r); setState(st); setPreview(null);
    } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, [ym, entities]);
  useEffect(() => { void load(); }, [load]);

  const m: MatchResult = useMemo(() => matchSlips(slips, reqs, entities), [slips, reqs, entities]);
  const erpTotal = slips.filter((s) => s.supplyAmount >= 0).reduce((s, x) => s + x.supplyAmount, 0);
  const ourTotal = reqs.filter((r) => r.status !== '취소' && r.status !== '수정발행').reduce((s, r) => s + r.supplyAmount, 0);
  const todo = m.amountDiff.length + m.erpOnly.length + m.ourOnly.length
    + m.corrections.filter((c) => !c.requestId).length;
  const pending = m.matched.reduce((n, r) => n + r.requests.filter((q) => q.status === '요청').length, 0);

  const monthOpts = useMemo(() => {
    const [y, mm] = todayYmd().slice(0, 7).split('-').map(Number);
    return Array.from({ length: 15 }, (_, i) => {
      const d = new Date(Date.UTC(y, mm - 1 - i + 1, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    });
  }, []);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try { await fn(); await load(); flash(ok); }
    catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  async function onFile(file: File) {
    setBusy(true);
    try {
      setErr(null);
      const { rows, skipped } = await parseErpSlipFile(file, ym);
      if (!rows.length) throw new Error('매출 전표를 하나도 찾지 못했습니다. 기간과 파일을 확인해 주세요.');
      setPreview({ rows, skipped, fileName: file.name });
    } catch (e) { alert('파일을 읽지 못했습니다.\n\n' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="card">불러오는 중…</div>;

  const step = !state?.uploadedAt ? 1 : todo > 0 ? 3 : state.doneAt ? 4 : 3;
  const Step = ({ n, label }: { n: number; label: string }) => (
    <span style={{
      padding: '1px 8px', borderRadius: 9, fontSize: 11, fontWeight: 700,
      background: step === n ? '#1A2B52' : step > n ? '#D1FAE5' : '#F3F4F6',
      color: step === n ? '#fff' : step > n ? '#065F46' : '#9CA3AF',
    }}>{step > n ? '✓ ' : ''}{label}</span>
  );

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        📥 ERP 발행내역 대사
        <select value={ym} onChange={(e) => setYm(e.target.value)} style={{ fontWeight: 700 }}>
          {monthOpts.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <span style={{ display: 'flex', gap: 4 }}>
          <Step n={1} label="① 파일" /><Step n={2} label="② 확인" /><Step n={3} label="③ 처리" /><Step n={4} label="④ 마감" />
        </span>
        {msg && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#2a7' }}>{msg}</span>}
      </div>
      {err && <div className="alert-w">{err}</div>}

      {/* ── ① 파일 ── */}
      {!state?.uploadedAt && !preview && (
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void onFile(f); }}
          style={{
            display: 'block', border: '2px dashed #c9b98a', borderRadius: 8, background: '#fdfaf3',
            padding: '22px 16px', textAlign: 'center', cursor: busy ? 'default' : 'pointer', margin: '10px 0',
          }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1A2B52', marginBottom: 6 }}>
            ERP 거래전표 엑셀을 여기에 끌어다 놓으세요
          </div>
          <div style={{ fontSize: 11.5, color: '#777', lineHeight: 1.7 }}>
            인덕 ERP ▸ 회계관리 ▸ <b>거래전표 리스트</b> ▸ 기간 {ym}-01 ~ {ym} 말일 ▸ <b>검색</b> ▸ <b>엑셀</b><br />
            내려받은 파일을 그대로 올리시면 됩니다. 매입 전표는 자동으로 걸러냅니다.<br />
            <span style={{ color: '#999' }}>파일을 고르기만 하고 아직 저장하지 않습니다 — 내용을 먼저 보여드립니다.</span>
          </div>
          <input type="file" accept=".xls,.xlsx" style={{ display: 'none' }} disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />
        </label>
      )}

      {/* ── ② 읽은 내용 확인 ── */}
      {preview && (
        <div style={{ border: '1px solid #c9b98a', borderRadius: 8, background: '#fdfaf3', padding: 12, margin: '10px 0' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1A2B52', marginBottom: 6 }}>
            읽었습니다 — 매출 {preview.rows.length}건 · 공급가액 {won(preview.rows.reduce((s, r) => s + r.supplyAmount, 0))}
          </div>
          <div style={{ fontSize: 11.5, color: '#666', marginBottom: 8 }}>
            {preview.fileName}{preview.skipped > 0 && ` · 매입 ${preview.skipped}건은 뺐습니다`}
            {preview.rows.some((r) => r.supplyAmount < 0) && ` · (−)수정전표 ${preview.rows.filter((r) => r.supplyAmount < 0).length}건 포함`}
            <br />이 내용이 맞으면 저장하세요. 아니면 취소하고 다른 파일을 올리면 됩니다.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn-p" disabled={busy}
              onClick={() => void run(async () => { await saveSlips(ym, preview.rows, preview.fileName); }, '✓ 저장했습니다. 아래에서 대사 결과를 확인하세요')}>
              저장하고 대사하기
            </button>
            <button className="btn-sm" disabled={busy} onClick={() => setPreview(null)}>취소</button>
          </div>
        </div>
      )}

      {/* ── 요약 ── */}
      {state?.uploadedAt && (
        <div style={{ border: '1px solid #e2d9c6', background: '#fdfaf3', borderRadius: 6, padding: '8px 10px', margin: '10px 0', fontSize: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <b style={{ color: '#1A2B52' }}>ERP {won(erpTotal)}</b>
            <span style={{ color: '#999' }}>↔</span>
            <b style={{ color: '#1A2B52' }}>우리 요청 {won(ourTotal)}</b>
            <span style={{ color: erpTotal === ourTotal ? '#2a7' : '#c33', fontWeight: 700 }}>
              {erpTotal === ourTotal ? '차이 없음' : `차이 ${won(ourTotal - erpTotal)}`}
            </span>
            <span style={{ color: '#888', fontSize: 11 }}>
              · {state.fileName} · {state.uploadedAt.slice(0, 10)}{state.uploadedBy && ` ${state.uploadedBy}`}
            </span>
            {canWrite && !state.doneAt && (
              <button className="btn-sm" disabled={busy}
                onClick={() => { if (confirm('올린 파일과 대사 내용을 지웁니다. 발행완료로 바꾼 건은 그대로 남습니다. 진행할까요?')) void run(() => clearSlips(ym), '지웠습니다'); }}>
                파일 지우고 다시 올리기
              </button>
            )}
            {state.doneAt ? (
              <span style={{ marginLeft: 'auto', padding: '1px 8px', borderRadius: 9, fontSize: 11, fontWeight: 700, background: '#1A2B52', color: '#fff' }}>
                대사완료 {state.doneAt.slice(0, 10)}{state.doneBy && ` · ${state.doneBy}`}
                {canFinish && <button className="btn-sm" style={{ marginLeft: 6 }} disabled={busy} onClick={() => void run(() => setReconcileDone(ym, false), '해제했습니다')}>해제</button>}
              </span>
            ) : canFinish && (
              <button className="btn-p" style={{ marginLeft: 'auto' }} disabled={busy}
                onClick={() => {
                  if (todo > 0 && !confirm(`아직 처리하지 않은 건이 ${todo}건 있습니다.\n그래도 대사를 마감할까요?`)) return;
                  void run(() => setReconcileDone(ym, true), '✓ 대사 완료');
                }}>
                🔒 이번 달 대사 완료{todo > 0 ? ` (미처리 ${todo})` : ''}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── ③ 처리 ── */}
      {state?.uploadedAt && (
        <>
          <Bucket title={`✅ 일치 ${m.matched.length}곳`} tone="#2a7" openKey="matched" open={open} setOpen={setOpen}
            right={canWrite && pending > 0 && (
              <>
                <span style={{ fontSize: 11.5, color: '#666' }}>발행일</span>
                <input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} style={{ fontSize: 12 }} />
                <button className="btn-p" disabled={busy}
                  onClick={() => void run(async () => { await markMatchedIssued(m.matched, issuedDate); }, '✓ 발행완료로 바꿨습니다')}>
                  모두 발행완료 ({pending}건)
                </button>
              </>
            )}>
            <Table rows={m.matched} kind="matched" />
          </Bucket>

          <Bucket title={`⚠️ 금액 다름 ${m.amountDiff.length}곳`} tone="#a15" openKey="diff" open={open} setOpen={setOpen}>
            <Table rows={m.amountDiff} kind="diff" busy={busy} canWrite={canWrite}
              onAlign={(row) => void run(() => alignToErp(row), '✓ ERP 금액으로 맞췄습니다')} />
          </Bucket>

          <Bucket title={`❓ ERP에만 있음 ${m.erpOnly.length}곳`} tone="#a15" openKey="erpOnly" open={open} setOpen={setOpen}
            hint="우리 발행요청에 없는 발행입니다. 건별매출(결산료 등)이거나 새로 수임한 곳입니다.">
            <Table rows={m.erpOnly} kind="erpOnly" busy={busy} canWrite={canWrite}
              onImport={(row) => void run(() => importErpOnly(row, ym, issuedDate), '✓ 발행요청으로 들여왔습니다 — 매출계약을 등록해 주세요')} />
          </Bucket>

          <Bucket title={`❗ 우리에만 있음 ${m.ourOnly.length}곳`} tone="#a15" openKey="ourOnly" open={open} setOpen={setOpen}
            hint="요청했는데 ERP에 발행이 없습니다. 발행 누락이거나, 파일 기간이 짧아 빠졌을 수 있습니다.">
            <Table rows={m.ourOnly} kind="ourOnly" />
          </Bucket>

          {m.corrections.length > 0 && (
            <Bucket title={`➖ (−)수정전표 ${m.corrections.length}건`} tone="#a15" openKey="corr" open={open} setOpen={setOpen}
              hint="잘못 발행한 것을 되돌린 마이너스 전표입니다. 기록해 두면 미수금이 맞습니다.">
              <div className="tbl-scroll" style={{ maxHeight: 240 }}>
                <table className="tbl" style={{ fontSize: 11.5 }}>
                  <thead><tr><th>전표번호</th><th>거래처</th><th>내역</th><th className="r">공급가액</th><th>처리</th></tr></thead>
                  <tbody>
                    {m.corrections.map((c) => (
                      <tr key={c.slipNo}>
                        <td style={{ fontFamily: 'monospace', fontSize: 10.5 }}>{c.slipNo}</td>
                        <td style={{ fontWeight: 700, color: '#1A2B52' }}>{c.clientName}</td>
                        <td>{c.description}</td>
                        <td className="r" style={{ color: '#c33', fontWeight: 700 }}>{won(c.supplyAmount)}</td>
                        <td>
                          {c.requestId ? <span style={{ color: '#2a7', fontSize: 11 }}>✓ 기록됨</span>
                            : canWrite && (
                              <button className="btn-sm btn-sm-blue" disabled={busy}
                                onClick={() => void run(() => importCorrection(c, entities), '✓ 수정발행으로 기록했습니다')}>
                                수정발행으로 기록
                              </button>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Bucket>
          )}
        </>
      )}
    </div>
  );
}

// ── 묶음 상자 ─────────────────────────────────────────────
function Bucket({ title, tone, openKey, open, setOpen, hint, right, children }: {
  title: string; tone: string; openKey: string;
  open: Record<string, boolean>; setOpen: (f: (p: Record<string, boolean>) => Record<string, boolean>) => void;
  hint?: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  const isOpen = !!open[openKey];
  return (
    <div style={{ border: '1px solid #eee', borderRadius: 6, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#faf7f0', flexWrap: 'wrap' }}>
        <button className="btn-sm" onClick={() => setOpen((p) => ({ ...p, [openKey]: !p[openKey] }))} style={{ minWidth: 26 }}>
          {isOpen ? '▾' : '▸'}
        </button>
        <b style={{ fontSize: 12.5, color: tone }}>{title}</b>
        {hint && <span style={{ fontSize: 11, color: '#888' }}>{hint}</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>{right}</span>
      </div>
      {isOpen && <div style={{ padding: 8 }}>{children}</div>}
    </div>
  );
}

// ── 묶음별 표 ─────────────────────────────────────────────
function Table({ rows, kind, busy, canWrite, onAlign, onImport }: {
  rows: MatchRow[]; kind: 'matched' | 'diff' | 'erpOnly' | 'ourOnly';
  busy?: boolean; canWrite?: boolean;
  onAlign?: (r: MatchRow) => void; onImport?: (r: MatchRow) => void;
}) {
  if (!rows.length) return <div style={{ color: '#BBB', fontSize: 12, padding: 8 }}>없습니다.</div>;
  return (
    <div className="tbl-scroll" style={{ maxHeight: 320 }}>
      <table className="tbl" style={{ fontSize: 11.5 }}>
        <thead>
          <tr>
            <th>거래처</th><th>사업자번호</th>
            <th className="r">ERP</th><th className="r">우리 요청</th>
            {kind === 'diff' && <th className="r">차이</th>}
            <th>{kind === 'erpOnly' ? 'ERP 내역' : '비고'}</th>
            {(kind === 'diff' || kind === 'erpOnly') && <th>처리</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.bizNo}>
              <td style={{ fontWeight: 700, color: '#1A2B52' }}>
                {r.ourName || r.clientName}
                {!r.known && (
                  <span title="우리 거래처관리에 없는 사업자번호입니다"
                    style={{ marginLeft: 4, fontSize: 10, fontWeight: 700, color: '#92400E', background: '#FEF3C7', border: '1px solid #FCD34D', padding: '0 4px', borderRadius: 3 }}>
                    미등록 거래처
                  </span>
                )}
                {r.ourName && r.clientName && r.ourName !== r.clientName && (
                  <div style={{ fontSize: 10.5, color: '#999' }}>ERP 표기: {r.clientName}</div>
                )}
              </td>
              <td style={{ fontSize: 11 }}>{r.bizNo.replace(/^(\d{3})(\d{2})(\d{5})$/, '$1-$2-$3')}</td>
              <td className="r">{r.slips.length ? won(r.erpAmount) : <span style={{ color: '#CCC' }}>—</span>}</td>
              <td className="r">{r.requests.length ? won(r.ourAmount) : <span style={{ color: '#CCC' }}>—</span>}</td>
              {kind === 'diff' && <td className="r" style={{ color: '#c33', fontWeight: 700 }}>{won(r.ourAmount - r.erpAmount)}</td>}
              <td style={{ fontSize: 11, color: '#666' }}>
                {kind === 'erpOnly' ? r.slips.map((s) => `${s.description} ${won(s.supplyAmount)}`).join(' / ')
                  : kind === 'ourOnly' ? r.requests.map((q) => q.contractCode).filter(Boolean).join(', ')
                    : r.slips.map((s) => s.description).filter(Boolean).join(' / ')}
              </td>
              {kind === 'diff' && (
                <td>
                  {canWrite && (
                    <button className="btn-sm btn-sm-blue" disabled={busy} onClick={() => onAlign?.(r)}
                      title="ERP 가 실제 발행이라고 판단될 때 우리 요청 금액을 그쪽에 맞춥니다">
                      ERP 금액으로 맞춤
                    </button>
                  )}
                </td>
              )}
              {kind === 'erpOnly' && (
                <td>
                  {canWrite && (r.known
                    ? <button className="btn-sm btn-sm-blue" disabled={busy} onClick={() => onImport?.(r)}>발행요청으로 추가</button>
                    : <span style={{ fontSize: 11, color: '#a15' }}>거래처등록 먼저</span>)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
