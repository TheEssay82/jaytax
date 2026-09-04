// 기장등청구관리 › ERP 발행내역 대사 — 엑셀 '대조용' 시트를 대신한다.
//
// 담당자가 매달 하던 「ERP에서 엑셀 내려받기 → 시트에 붙여넣기 → 눈으로 대조」를
// 「끌어다 놓기 → 화면이 분류 → 묶음마다 버튼 하나」로 바꾼 화면이다.
// 설계 원칙 셋: ① 되돌릴 수 있게 ② 먼저 보여주고 나중에 저장 ③ 판단은 사람이.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEscape } from '../../lib/useEscape';
import Loading from '../common/Loading';
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
  // 대사는 팀별로 한다 — 한 달에 두 팀 파일이 따로 올라온다.
  const [team, setTeam] = useState('taxteam');
  const [entities, setEntities] = useState<BizEntityFull[]>([]);
  const [slips, setSlips] = useState<ErpSlip[]>([]);
  const [reqs, setReqs] = useState<InvoiceRequest[]>([]);
  const [state, setState] = useState<ReconcileState | null>(null);
  const [preview, setPreview] = useState<{ rows: ErpSlip[]; skipped: number; fileName: string; depts: string[]; fileTeam: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({ diff: true, erpOnly: true, ourOnly: true, corr: true });
  const [issuedDate, setIssuedDate] = useState(todayYmd);
  const [help, setHelp] = useState(false);
  // 감사팀 부서에는 다른 회계사 담당 거래처가 함께 잡힌다. 기본은 우리 거래처만 본다.
  const [oursOnly, setOursOnly] = useState(true);

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 3500); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setErr(null);
      const ents = entities.length ? entities : await listBizEntities();
      if (!entities.length) setEntities(ents);
      const [s, r, st] = await Promise.all([
        listSlips(ym, team), listInvoiceRequests(ym, team), getReconcileState(ym, team),
      ]);
      setSlips(s); setReqs(r); setState(st); setPreview(null);
    } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, [ym, team, entities]);
  useEffect(() => { void load(); }, [load]);

  const all: MatchResult = useMemo(() => matchSlips(slips, reqs, entities), [slips, reqs, entities]);
  /**
   * 우리 거래처관리에 없는 곳을 접어 둔다.
   * ERP 부서에는 다른 회계사(김영식·정훈석 등) 담당 거래처가 함께 들어 있어,
   * 그대로 두면 매달 처리할 수 없는 줄이 목록을 덮는다.
   */
  const hiddenOther = all.erpOnly.filter((r) => !r.known).length;
  const m: MatchResult = useMemo(() => (oursOnly ? {
    ...all,
    erpOnly: all.erpOnly.filter((r) => r.known),
  } : all), [all, oursOnly]);
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
      const { rows, skipped, depts, team: fileTeam } = await parseErpSlipFile(file, ym);
      if (!rows.length) throw new Error('매출 전표를 하나도 찾지 못했습니다. 기간과 파일을 확인해 주세요.');
      setPreview({ rows, skipped, fileName: file.name, depts, fileTeam });
    } catch (e) { alert('파일을 읽지 못했습니다.\n\n' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

  if (loading) return <Loading title="📥 ERP 발행내역 대사" rows={7} />;

  const step = !state?.uploadedAt ? 1 : todo > 0 ? 3 : state.doneAt ? 4 : 3;
  const Step = ({ n, label }: { n: number; label: string }) => (
    <span style={{
      padding: '1px 8px', borderRadius: 9, fontSize: 'var(--fs-1)', fontWeight: 700,
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
        <select value={team} onChange={(e) => setTeam(e.target.value)} style={{ fontWeight: 700 }}
          title="한 달에 두 팀 파일이 따로 올라옵니다. 팀마다 따로 대사합니다.">
          <option value="taxteam">taxteam (기장24팀)</option>
          <option value="감사team">감사팀 (2본부5팀)</option>
        </select>
        <span style={{ display: 'flex', gap: 4 }}>
          <Step n={1} label="① 파일" /><Step n={2} label="② 확인" /><Step n={3} label="③ 처리" /><Step n={4} label="④ 마감" />
        </span>
        <label style={{ fontSize: 'var(--fs-1)', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
          title="ERP 부서에는 다른 회계사 담당 거래처가 함께 들어 있습니다. 우리 거래처관리에 등록된 곳만 봅니다.">
          <input type="checkbox" checked={oursOnly} onChange={(e) => setOursOnly(e.target.checked)} /> 우리 거래처만
        </label>
        <button className="btn-sm btn-sm-blue" onClick={() => setHelp(true)}>❓ 차이가 날 때 보는 안내</button>
        {msg && <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-2)', color: 'var(--good)' }}>{msg}</span>}
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
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>
            ERP 거래전표 엑셀을 여기에 끌어다 놓으세요
          </div>
          <div style={{ fontSize: 'var(--fs-1)', color: '#777', lineHeight: 1.7 }}>
            인덕 ERP ▸ 회계관리 ▸ <b>거래전표 리스트</b> ▸ 기간 {ym}-01 ~ {ym} 말일 ▸
            부서 <b>{team === 'taxteam' ? '기장24팀' : '2본부5팀'}</b> ▸ <b>검색</b> ▸ <b>엑셀</b><br />
            내려받은 파일을 그대로 올리시면 됩니다. 매입 전표는 자동으로 걸러냅니다.<br />
            <span style={{ color: 'var(--ink-3)' }}>파일을 고르기만 하고 아직 저장하지 않습니다 — 내용을 먼저 보여드립니다.</span>
          </div>
          <input type="file" accept=".xls,.xlsx" style={{ display: 'none' }} disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />
        </label>
      )}

      {/* ── ② 읽은 내용 확인 ── */}
      {preview && (
        <div style={{ border: '1px solid #c9b98a', borderRadius: 8, background: '#fdfaf3', padding: 12, margin: '10px 0' }}>
          <div style={{ fontSize: 'var(--fs-3)', fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>
            읽었습니다 — 매출 {preview.rows.length}건 · 공급가액 {won(preview.rows.reduce((s, r) => s + r.supplyAmount, 0))}
          </div>
          <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', marginBottom: 8 }}>
            {preview.fileName}{preview.skipped > 0 && ` · 매입 ${preview.skipped}건은 뺐습니다`}
            {preview.depts.length > 0 && ` · 부서 ${preview.depts.join(', ')}`}
            {preview.rows.some((r) => r.supplyAmount < 0) && ` · (−)수정전표 ${preview.rows.filter((r) => r.supplyAmount < 0).length}건 포함`}
            <br />이 내용이 맞으면 저장하세요. 아니면 취소하고 다른 파일을 올리면 됩니다.
          </div>
          {preview.fileTeam && preview.fileTeam !== team && (
            <div className="alert-w" style={{ fontSize: 'var(--fs-1)', marginBottom: 8 }}>
              이 파일은 <b>{preview.fileTeam === 'taxteam' ? 'taxteam (기장24팀)' : '감사팀 (2본부5팀)'}</b> 자료로 보입니다.
              지금 고른 팀과 다릅니다 — 위에서 팀을 바꾸고 다시 올리시거나, 파일을 확인해 주세요.
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn-p" disabled={busy || (!!preview.fileTeam && preview.fileTeam !== team)}
              onClick={() => void run(async () => { await saveSlips(ym, team, preview.rows, preview.fileName); }, '✓ 저장했습니다. 아래에서 대사 결과를 확인하세요')}>
              저장하고 대사하기
            </button>
            <button className="btn-sm" disabled={busy} onClick={() => setPreview(null)}>취소</button>
          </div>
        </div>
      )}

      {/* ── 요약 ── */}
      {state?.uploadedAt && (
        <div style={{ border: '1px solid var(--rule)', background: '#fdfaf3', borderRadius: 6, padding: '8px 10px', margin: '10px 0', fontSize: 'var(--fs-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <b style={{ color: 'var(--navy)' }}>ERP {won(erpTotal)}</b>
            <span style={{ color: 'var(--ink-3)' }}>↔</span>
            <b style={{ color: 'var(--navy)' }}>우리 요청 {won(ourTotal)}</b>
            <span style={{ color: erpTotal === ourTotal ? '#2a7' : '#c33', fontWeight: 700 }}>
              {erpTotal === ourTotal ? '차이 없음' : `차이 ${won(ourTotal - erpTotal)}`}
            </span>
            <span style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)' }}>
              · {state.fileName} · {state.uploadedAt.slice(0, 10)}{state.uploadedBy && ` ${state.uploadedBy}`}
            </span>
            {canWrite && !state.doneAt && (
              <button className="btn-sm" disabled={busy}
                onClick={() => { if (confirm('올린 파일과 대사 내용을 지웁니다. 발행완료로 바꾼 건은 그대로 남습니다. 진행할까요?')) void run(() => clearSlips(ym, team), '지웠습니다'); }}>
                파일 지우고 다시 올리기
              </button>
            )}
            {state.doneAt ? (
              <span style={{ marginLeft: 'auto', padding: '1px 8px', borderRadius: 9, fontSize: 'var(--fs-1)', fontWeight: 700, background: 'var(--navy)', color: '#fff' }}>
                대사완료 {state.doneAt.slice(0, 10)}{state.doneBy && ` · ${state.doneBy}`}
                {canFinish && <button className="btn-sm" style={{ marginLeft: 6 }} disabled={busy} onClick={() => void run(() => setReconcileDone(ym, team, false), '해제했습니다')}>해제</button>}
              </span>
            ) : canFinish && (
              <button className="btn-p" style={{ marginLeft: 'auto' }} disabled={busy}
                onClick={() => {
                  if (todo > 0 && !confirm(`아직 처리하지 않은 건이 ${todo}건 있습니다.\n그래도 대사를 마감할까요?`)) return;
                  void run(() => setReconcileDone(ym, team, true), '✓ 대사 완료');
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
                <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)' }}>발행일</span>
                <input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} style={{ fontSize: 'var(--fs-2)' }} />
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
            hint={oursOnly && hiddenOther > 0
              ? `우리 발행요청에 없는 발행입니다. 미등록 거래처 ${hiddenOther}곳은 감춰져 있습니다 — 위 「우리 거래처만」을 끄면 보입니다.`
              : '우리 발행요청에 없는 발행입니다. 건별매출(결산료 등)이거나 새로 수임한 곳입니다.'}>
            <Table rows={m.erpOnly} kind="erpOnly" busy={busy} canWrite={canWrite}
              onImport={(row) => void run(() => importErpOnly(row, ym, issuedDate, team), '✓ 발행요청으로 들여왔습니다 — 매출계약을 등록해 주세요')} />
          </Bucket>

          <Bucket title={`❗ 우리에만 있음 ${m.ourOnly.length}곳`} tone="#a15" openKey="ourOnly" open={open} setOpen={setOpen}
            hint="요청했는데 ERP에 발행이 없습니다. 발행 누락이거나, 파일 기간이 짧아 빠졌을 수 있습니다.">
            <Table rows={m.ourOnly} kind="ourOnly" />
          </Bucket>

          {m.corrections.length > 0 && (
            <Bucket title={`➖ (−)수정전표 ${m.corrections.length}건`} tone="#a15" openKey="corr" open={open} setOpen={setOpen}
              hint="잘못 발행한 것을 되돌린 마이너스 전표입니다. 기록해 두면 미수금이 맞습니다.">
              <div className="tbl-scroll" data-fixed-h style={{ maxHeight: 240 }}>
                <table className="tbl" style={{ fontSize: 'var(--fs-1)' }}>
                  <thead><tr><th>전표번호</th><th>거래처</th><th>내역</th><th className="r">공급가액</th><th>처리</th></tr></thead>
                  <tbody>
                    {m.corrections.map((c) => (
                      <tr key={c.slipNo}>
                        <td style={{ fontFamily: 'monospace', fontSize: 'var(--fs-0)' }}>{c.slipNo}</td>
                        <td style={{ fontWeight: 700, color: 'var(--navy)' }}>{c.clientName}</td>
                        <td>{c.description}</td>
                        <td className="r" style={{ color: 'var(--bad)', fontWeight: 700 }}>{won(c.supplyAmount)}</td>
                        <td>
                          {c.requestId ? <span style={{ color: 'var(--good)', fontSize: 'var(--fs-1)' }}>✓ 기록됨</span>
                            : canWrite && (
                              <button className="btn-sm btn-sm-blue" disabled={busy}
                                onClick={() => void run(() => importCorrection(c, entities, team), '✓ 수정발행으로 기록했습니다')}>
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
      {help && <HelpModal onClose={() => setHelp(false)} />}
    </div>
  );
}

// ── 차이가 날 때 보는 안내 ────────────────────────────────
// 실제로 2026-07·08 을 대사하며 나온 사례만 담았다. 지어낸 예시가 아니다.
const CASES: { tag: string; title: string; why: string; fix: string; ex: string }[] = [
  {
    tag: '❓ ERP에만',
    title: '담당자가 ERP에 직접 발행한 건별매출',
    why: '결산료·증빙발행수수료·월결산수수료처럼 그때그때 생기는 건은 담당자가 ERP에서 바로 발행합니다. 우리 발행요청에는 없습니다.',
    fix: '[발행요청으로 추가]를 누르면 금액·적요가 채워진 채로 발행완료로 들어옵니다. 계약이 없으면 비고에 「매출계약 미연결」이 남습니다 — 매출계약등록에서 계약을 만들어 두면 다음 달부터 자동으로 잡힙니다. 직접 하셔도 되고 담당 회계사·직원에게 알려주셔도 됩니다.',
    ex: '2026-07 파트리지시스템즈 「2026년 2분기 결산료」 500,000 — 분기 계약을 등록해 지금은 자동으로 잡힙니다.',
  },
  {
    tag: '❓ ERP에만',
    title: '새로 수임했는데 거래처·계약이 아직 없는 곳',
    why: '이번 달에 처음 발행된 거래처입니다. 거래처관리에 없으면 붙일 자리가 없습니다.',
    fix: '「미등록 거래처」 배지가 뜨면 먼저 거래처관리 › 거래처등록에서 등록하고, 이 화면으로 돌아와 [발행요청으로 추가]를 누릅니다. 이어서 매출계약도 등록해 주세요.',
    ex: '2026-07 ㈜연건아트레지던스 — 법인세무조정 300,000 + 부가세 신고대리 500,000 이 발행됐는데 거래처가 없었습니다.',
  },
  {
    tag: '➖ (−)수정전표',
    title: '잘못 발행해 마이너스로 되돌린 것',
    why: '오청구를 정정하려고 (−)금액으로 다시 발행한 전표입니다. 그냥 두면 미수금이 그만큼 부풀어 남습니다.',
    fix: '[수정발행으로 기록]을 누릅니다. 음수 그대로 기록되어 미수금이 맞아떨어집니다. 원인이 된 계약이 아직 살아 있으면 매출계약등록에서 종료일을 넣어 주세요 — 안 그러면 다음 달에 또 청구됩니다.',
    ex: '2026-07 파인즈플래닝 −200,000 × 4건 — 2026-04부터 청구하지 않기로 했는데 7월분까지 나가 4개월치를 되돌린 건입니다.',
  },
  {
    tag: '❗ 우리에만',
    title: '요청했는데 ERP에 발행이 없음 — 진짜 누락',
    why: '발행요청은 있는데 ERP에서 실제로 발행되지 않았습니다.',
    fix: 'ERP에서 발행한 뒤 파일을 다시 받아 올리면 ✅일치로 넘어갑니다. 발행할 필요가 없어진 건이면 발행요청 화면에서 [취소]하세요.',
    ex: '—',
  },
  {
    tag: '❗ 우리에만',
    title: '파일 기간이 짧아 빠진 것 (자주 생깁니다)',
    why: 'ERP에서 엑셀을 뽑을 때 기간을 그달 말일까지 잡지 않으면 뒤쪽 전표가 통째로 빠집니다.',
    fix: '기간을 그달 1일 ~ 말일로 다시 잡아 내려받고, [파일 지우고 다시 올리기] 후 새로 올립니다.',
    ex: '2026-08 팬텀 1,100,000(전표 26-0818-0003)이 24일 기준 자료에는 없어 「발행 누락」으로 잘못 볼 뻔했습니다. 8월 전표는 4·10·18·25·31일에 걸쳐 있습니다.',
  },
  {
    tag: '❗ 우리에만',
    title: '해지했는데 계약을 안 닫아 계속 청구된 것',
    why: '거래가 끝났는데 매출계약에 종료일이 없으면 매달 청구예정으로 계속 나옵니다.',
    fix: '매출계약등록에서 그 계약의 종료일을 마지막 청구월 말일로 넣고, 이 달 요청은 [취소]합니다.',
    ex: '2026-08 ㈜제이엠스토리 150,000 — 마지막 청구가 7월인데 계약이 열려 있어 8월에도 잡혔습니다.',
  },
  {
    tag: '⚠️ 금액 다름',
    title: '그 달에 다른 항목이 함께 나간 경우',
    why: '기장료 외에 결산료·자문료가 같은 거래처에 함께 발행되면 ERP 쪽 금액이 더 큽니다.',
    fix: 'ERP 내역을 보고 무엇이 더해졌는지 확인하세요. 계속 생기는 항목이면 매출계약을 하나 더 만드는 편이 낫습니다. 이번 달만이면 [ERP 금액으로 맞춤]을 눌러도 됩니다.',
    ex: '2026-07 파트리지시스템즈 — 우리 400,000(기장) ↔ ERP 900,000(기장 400,000 + 결산료 500,000).',
  },
  {
    tag: '⚠️ 금액 다름',
    title: '계약금액이 바뀌었는데 반영이 안 된 경우',
    why: '거래처와 금액을 조정했는데 매출계약을 고치지 않으면 우리 요청만 옛 금액입니다.',
    fix: 'ERP가 맞으면 [ERP 금액으로 맞춤]을 누르고, 매출계약등록에서 계약금액도 함께 고쳐 주세요. 안 고치면 다음 달에 또 어긋납니다.',
    ex: '—',
  },
  {
    tag: '⚠️ 금액 다름',
    title: '사업장이 여럿인데 계약이 본점에만 걸린 경우',
    why: 'ERP는 사업장(사업자번호)마다 따로 발행하는데 계약이 본점 하나뿐이면 금액이 안 맞습니다.',
    fix: '매출계약등록에서 그 사업장 계약을 따로 만들어 주세요.',
    ex: '이티머니 짐티피 연희5호점 200,000 · 위고하드 싶싶싶 200,000 · 원창에코 평택지점 100,000 — 셋 다 본점 계약만 있었습니다.',
  },
  {
    tag: '기준',
    title: '엑셀·ERP와 숫자가 9% 어긋나 보일 때',
    why: '한쪽은 공급가액, 다른 쪽은 부가세 포함 금액을 보고 있는 것입니다.',
    fix: '이 화면은 전부 **공급가액(부가세 별도)** 기준입니다. ERP 거래전표의 「공급가액」 열, 엑셀의 금액과 같은 기준입니다. 발행요청 화면에는 공급가액과 합계(VAT포함)를 둘 다 적어 두었습니다.',
    ex: '18,150,000(공급가액) ↔ 20,405,000(VAT포함) — 같은 금액입니다.',
  },
  {
    tag: '사업자번호',
    title: '거래처는 있는데 「미등록 거래처」로 뜰 때',
    why: '사업자번호가 우리 거래처등록과 한 자리라도 다르면 다른 거래처로 봅니다.',
    fix: '사업자등록증으로 확인해 거래처등록에서 번호를 고쳐 주세요. 고치면 바로 맞춰집니다.',
    ex: '짐티피 연희5호점 — 우리 171-82-02156 ↔ ERP 171-85-02156. ERP가 맞아 우리 쪽을 고쳤습니다.',
  },
  {
    tag: '팀',
    title: '감사팀 발행이 섞여 보일 때',
    why: 'ERP 파일을 뽑을 때 부서를 기장24팀으로 좁히지 않으면 감사팀 전표까지 들어옵니다.',
    fix: 'ERP 거래전표 화면에서 부서를 기장24팀으로 고르고 다시 내려받으세요. 감사팀 건은 「발행요청 · 감사팀」에서 따로 관리합니다.',
    ex: '2026-08 ㈜오톰 회계감사 중도금 10,000,000 이 taxteam 목록에 섞여 들어온 적이 있습니다.',
  },
];

function HelpModal({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const tone = (t: string) => (t.startsWith('❓') ? '#1E3A8A' : t.startsWith('➖') ? '#991B1B'
    : t.startsWith('❗') ? '#92400E' : t.startsWith('⚠️') ? '#92400E' : '#065F46');
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 60,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflow: 'auto',
    }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 860, width: '100%' }}>
        <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          ❓ 차이가 날 때 — 경우별 해결 방법
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>
        <div className="alert-i" style={{ fontSize: 'var(--fs-1)' }}>
          아래는 <b>실제로 2026-07·08 을 대사하며 나온 사례</b>만 모은 것입니다. 차이가 나는 것은 잘못이 아니라
          대부분 <b>계약이 덜 채워졌거나 파일 조건이 어긋난 것</b>입니다. 순서대로 확인하시면 스스로 정리하실 수 있습니다.
        </div>
        {CASES.map((c, i) => (
          <div key={i} style={{ border: '1px solid var(--rule-2)', borderRadius: 6, padding: '8px 10px', marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 'var(--fs-0)', fontWeight: 700, color: '#fff', background: tone(c.tag),
                padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap',
              }}>{c.tag}</span>
              <b style={{ fontSize: 'var(--fs-2)', color: 'var(--navy)' }}>{c.title}</b>
            </div>
            <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', marginTop: 4, lineHeight: 1.65 }}>
              <div><b style={{ color: 'var(--ink-3)' }}>왜 </b>{c.why}</div>
              <div style={{ marginTop: 2 }}><b style={{ color: 'var(--good)' }}>어떻게 </b>{c.fix}</div>
              {c.ex !== '—' && <div style={{ marginTop: 2, color: 'var(--ink-3)' }}><b>실제 사례 </b>{c.ex}</div>}
            </div>
          </div>
        ))}
        <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', marginTop: 12, lineHeight: 1.7 }}>
          <b>그래도 모르겠으면</b> — 이 화면은 아무것도 지우지 않습니다. 처리하지 않고 두었다가 담당 회계사에게
          물어보셔도 되고, 미처리 건이 남은 채로 마감해도 기록에 남습니다. 잘못 눌렀으면 발행요청 화면에서
          되돌리기·취소가 모두 됩니다.
        </div>
      </div>
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
    <div style={{ border: '1px solid var(--rule-2)', borderRadius: 6, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#faf7f0', flexWrap: 'wrap' }}>
        <button className="btn-sm" onClick={() => setOpen((p) => ({ ...p, [openKey]: !p[openKey] }))} style={{ minWidth: 26 }}>
          {isOpen ? '▾' : '▸'}
        </button>
        <b style={{ fontSize: 'var(--fs-2)', color: tone }}>{title}</b>
        {hint && <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>{hint}</span>}
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
  if (!rows.length) return <div style={{ color: 'var(--ink-4)', fontSize: 'var(--fs-2)', padding: 8 }}>없습니다.</div>;
  return (
    <div className="tbl-scroll" data-fixed-h style={{ maxHeight: 320 }}>
      <table className="tbl" style={{ fontSize: 'var(--fs-1)' }}>
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
              <td style={{ fontWeight: 700, color: 'var(--navy)' }}>
                {r.ourName || r.clientName}
                {!r.known && (
                  <span title="우리 거래처관리에 없는 사업자번호입니다"
                    style={{ marginLeft: 4, fontSize: 'var(--fs-0)', fontWeight: 700, color: 'var(--warn)', background: '#FEF3C7', border: '1px solid #FCD34D', padding: '0 4px', borderRadius: 3 }}>
                    미등록 거래처
                  </span>
                )}
                {r.ourName && r.clientName && r.ourName !== r.clientName && (
                  <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}>ERP 표기: {r.clientName}</div>
                )}
              </td>
              <td style={{ fontSize: 'var(--fs-1)' }}>{r.bizNo.replace(/^(\d{3})(\d{2})(\d{5})$/, '$1-$2-$3')}</td>
              <td className="r">{r.slips.length ? won(r.erpAmount) : <span style={{ color: 'var(--ink-4)' }}>—</span>}</td>
              <td className="r">{r.requests.length ? won(r.ourAmount) : <span style={{ color: 'var(--ink-4)' }}>—</span>}</td>
              {kind === 'diff' && <td className="r" style={{ color: 'var(--bad)', fontWeight: 700 }}>{won(r.ourAmount - r.erpAmount)}</td>}
              <td style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)' }}>
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
                    : <span style={{ fontSize: 'var(--fs-1)', color: '#a15' }}>거래처등록 먼저</span>)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
