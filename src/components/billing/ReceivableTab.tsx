// 기장등청구관리 › 수금·미수금
//
//   미수금 = 기초 + 발행 − 입금   (전부 VAT 포함 기준)
//
// 기초는 2026-07-01 잔액, 발행은 발행요청, 입금은 ERP 부서별원장의 외상매출금 대변이다.
// 원장에는 사업자번호가 없어 **거래처코드**로 사업장에 붙인다.
// 화면 위에서 우리 계산과 원장 숫자를 나란히 놓아, 어긋나면 바로 보이게 했다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { listBizEntities, corpDisplayName, type BizEntityFull } from '../../lib/bizRegistryApi';
import { todayYmd } from '../../lib/format';
import { listInvoiceRequests, type InvoiceRequest } from '../../lib/invoiceRequestApi';
import { listReceivableOpenings, OPENING_AS_OF, type ReceivableOpening } from '../../lib/invoiceRequestApi';
import {
  parseLedgerFile, attachPlaces, saveReceipts, listReceipts, clearReceipts, listUploads,
  assignReceipt, excludeReceipts, rematchReceipts,
  type Receipt, type LedgerRead, type UploadState,
} from '../../lib/receiptApi';
import {
  agingReport, notifyOverdue, listArUnmatched, type AgingRow, type AgingSource,
} from '../../lib/agingApi';
import {
  parseArLedger, attachEntities, saveArItems, listArUploads, assignArClient, excludeArClient,
  type ArRead, type ArUpload,
} from '../../lib/arLedgerApi';
import { AgingPanel, AgingDetail } from './AgingPanel';
import { AgingLedgerBox } from './AgingLedgerBox';

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const dash = <span style={{ color: '#CCC' }}>—</span>;

/** 올린 원장을 한 줄로 요약 — '어디까지 올렸나'가 한눈에 보이게. */
function uploadSummary(us: UploadState[]): string {
  if (!us.length) return '아직 없음';
  const by = (t: string) => us.filter((u) => u.team === t).map((u) => u.ym).sort();
  const part = (t: string, label: string) => {
    const l = by(t);
    return l.length ? `${label} ${l[0]}${l.length > 1 ? `~${l[l.length - 1]}` : ''} (${l.length}개월)` : '';
  };
  return [part('taxteam', '기장24팀'), part('감사team', '2본부5팀')].filter(Boolean).join(' · ');
}
/** 'YYYY-MM' 을 n 달 옮긴다. */
const shiftYm = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const prevMonth = () => {
  const d = new Date(todayYmd());
  d.setDate(1); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

interface Row {
  placeId: string; entityId: string; code: string; name: string; placeName: string;
  cpa: string; staff: string; teams: string[];
  opening: number; issued: number; paid: number; balance: number;
}

export default function ReceivableTab() {
  const { readonly, role } = useAuth();
  const canWrite = !readonly && role !== 'per_head_accountant';

  const [ym, setYm] = useState(prevMonth);
  const [team, setTeam] = useState('taxteam');
  const [entities, setEntities] = useState<BizEntityFull[]>([]);
  const [openings, setOpenings] = useState<ReceivableOpening[]>([]);
  const [reqs, setReqs] = useState<InvoiceRequest[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [preview, setPreview] = useState<(LedgerRead & { fileName: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [showUploads, setShowUploads] = useState(false);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [tab, setTab] = useState<'balance' | 'aging'>('balance');
  const [aging, setAging] = useState<AgingRow[]>([]);
  const [agingBusy, setAgingBusy] = useState(false);
  const [detail, setDetail] = useState<AgingRow | null>(null);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [agingSource, setAgingSource] = useState<AgingSource>('추정(FIFO)');
  const [arUploads, setArUploads] = useState<ArUpload[]>([]);
  const [arPreview, setArPreview] = useState<(ArRead & { fileName: string }) | null>(null);
  const [arUnmatched, setArUnmatched] = useState<Awaited<ReturnType<typeof listArUnmatched>>>([]);

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 3500); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setErr(null);
      const ents = entities.length ? entities : await listBizEntities();
      if (!entities.length) setEntities(ents);
      const [o, r, rc, up] = await Promise.all([
        listReceivableOpenings(), listInvoiceRequests(), listReceipts(), listUploads(),
      ]);
      setOpenings(o); setReqs(r); setReceipts(rc); setUploads(up); setPreview(null);
      setArUploads(await listArUploads());
      setArPreview(null);
    } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, [entities]);
  useEffect(() => { void load(); }, [load]);

  /** 거래처별 누계 — 기초는 한 번, 발행·입금은 기준월까지 모두 더한다. */
  const rows = useMemo<Row[]>(() => {
    const byPlace = new Map<string, Row>();
    for (const e of entities) {
      for (const p of e.places) {
        byPlace.set(p.id, {
          placeId: p.id, entityId: e.id, code: `${e.code}-${String(p.placeNo).padStart(2, '0')}`,
          name: corpDisplayName(e.name, e.corpForm, e.corpFormPosition), placeName: p.placeName,
          cpa: p.cpa || '', staff: (p.staff ?? []).map((x) => x.staffName).join(','),
          teams: p.salesTeams ?? [],
          opening: 0, issued: 0, paid: 0, balance: 0,
        });
      }
    }
    for (const o of openings) { const r = byPlace.get(o.placeId); if (r) r.opening += o.amountGross; }
    for (const q0 of reqs) {
      if (q0.ym > ym) continue;
      if (q0.status !== '발행완료' && q0.status !== '수정발행') continue;   // 요청만 된 건 아직 채권이 아니다
      const r = q0.placeId ? byPlace.get(q0.placeId) : null;
      if (r) r.issued += q0.total;
    }
    for (const c of receipts) {
      if (c.ym > ym) continue;
      const r = c.placeId ? byPlace.get(c.placeId) : null;
      if (r) r.paid += c.amount;
    }
    const out: Row[] = [];
    for (const r of byPlace.values()) {
      r.balance = r.opening + r.issued - r.paid;
      if (r.opening || r.issued || r.paid) out.push(r);
    }
    return out.sort((a, b) => b.balance - a.balance);
  }, [entities, openings, reqs, receipts, ym]);

  const view = useMemo(() => {
    let l = rows;
    if (onlyOpen) l = l.filter((r) => Math.round(r.balance) !== 0);
    if (q.trim()) {
      const k = q.trim().toLowerCase();
      l = l.filter((r) => (r.code + r.name + r.placeName + r.cpa).toLowerCase().includes(k));
    }
    return l;
  }, [rows, q, onlyOpen]);

  const sum = (f: (r: Row) => number) => view.reduce((s, r) => s + f(r), 0);

  /** 나이 분석의 기준일 = 고른 달의 말일. 오늘이 그 달 안이면 오늘로 본다. */
  const asOf = useMemo(() => {
    const [y, m] = ym.split('-').map(Number);
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const today = todayYmd();
    return today < end ? today : end;
  }, [ym]);

  const placeInfos = useMemo(() => rows.map((r) => ({
    placeId: r.placeId, code: r.code, company: r.name, place: r.placeName,
    entityId: r.entityId,
    cpa: r.cpa, staff: r.staff, team: (r.teams ?? []).join(','),
  })), [rows]);

  useEffect(() => {
    if (tab !== 'aging') return;
    let alive = true;
    setAgingBusy(true);
    void agingReport(asOf, placeInfos, team || undefined)
      .then((a) => { if (alive) { setAging(a.rows); setAgingSource(a.source); } })
      .catch(() => { if (alive) setAging([]); })
      .finally(() => { if (alive) setAgingBusy(false); });
    void listArUnmatched(asOf.slice(0, 7), team || undefined)
      .then((u) => { if (alive) setArUnmatched(u); })
      .catch(() => { if (alive) setArUnmatched([]); });
    return () => { alive = false; };
  }, [tab, asOf, placeInfos, team, arUploads]);

  /** 미수금대장 읽기 — 저장은 확인 뒤에. */
  async function onArFile(file: File) {
    setBusy(true);
    try {
      const read = await parseArLedger(file, ym, team);
      if (!read.rows.length) throw new Error('미수금대장에서 줄을 하나도 찾지 못했습니다.');
      setArPreview({ ...read, fileName: file.name });
    } catch (e) { alert('파일을 읽지 못했습니다.\n\n' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

  const agingView = useMemo(() => {
    let l = aging;
    if (overdueOnly) l = l.filter((r) => r.overdue > 0);
    if (q.trim()) {
      const k = q.trim().toLowerCase();
      l = l.filter((r) => (r.code + r.company + r.place + r.cpa + r.staff).toLowerCase().includes(k));
    }
    return l;
  }, [aging, overdueOnly, q]);
  const overdueRows = aging.filter((r) => r.overdue > 0);
  const freshOverdue = overdueRows.filter((r) => !r.notified);
  const unmatched = receipts.filter((c) => c.ym <= ym && !c.placeId && !c.excluded);
  const excluded = receipts.filter((c) => c.ym <= ym && !c.placeId && c.excluded);
  /** 사업장 고르기 후보 — 코드·상호·사업장명으로 찾는다. */
  const placeOpts = useMemo(() => entities.flatMap((e) => e.places.map((pl) => ({
    id: pl.id, entityId: e.id,
    label: `${e.code}-${String(pl.placeNo).padStart(2, '0')} ${corpDisplayName(e.name, e.corpForm, e.corpFormPosition)} · ${pl.placeName}`,
    hasCode: !!pl.erpClientCode,
  }))), [entities]);
  const up = uploads.find((u) => u.ym === ym && u.team === team);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try { await fn(); await load(); flash(ok); }
    catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  async function onFile(file: File) {
    setBusy(true);
    try {
      const read = await parseLedgerFile(file, ym, team);
      if (!read.rows.length) throw new Error('입금(대변) 줄을 하나도 찾지 못했습니다. 기간과 부서를 확인해 주세요.');
      setPreview({ ...read, fileName: file.name });
    } catch (e) { alert('파일을 읽지 못했습니다.\n\n' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="card">불러오는 중…</div>;

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        💰 수금·미수금
        <input type="month" value={ym} onChange={(e) => { if (e.target.value) setYm(e.target.value); }}
          style={{ fontWeight: 700 }} title="이 달까지의 누계로 미수금을 계산합니다 — 아무 달이나 지정할 수 있습니다" />
        <span style={{ fontSize: 11.5, color: '#666' }}>까지 누계</span>
        <span style={{ display: 'inline-flex', gap: 3 }}>
          <button className="btn-sm" onClick={() => setYm(shiftYm(ym, -1))} title="한 달 앞으로">◀</button>
          <button className="btn-sm" onClick={() => setYm(prevMonth())} title="지난달로">지난달</button>
          <button className="btn-sm" onClick={() => setYm(shiftYm(ym, 1))} title="한 달 뒤로">▶</button>
        </span>
        <select value={team} onChange={(e) => setTeam(e.target.value)} style={{ fontWeight: 700 }}>
          <option value="taxteam">taxteam (기장24팀)</option>
          <option value="감사team">감사팀 (2본부5팀)</option>
        </select>
        {msg && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#2a7' }}>{msg}</span>}
      </div>
      {err && <div className="alert-w">{err}</div>}

      <div className="alert-i" style={{ fontSize: 11 }}>
        <b>미수금 = 기초 + 발행 − 입금</b> (모두 부가세 포함). 기초는 {OPENING_AS_OF} 잔액,
        발행은 <b>발행완료</b>된 건, 입금은 ERP 부서별원장의 <b>외상매출금 대변</b>입니다.
        <br />ERP는 입금을 청구건에 연결하지 않으므로(입금 전표에 거래#가 없습니다) <b>사업장 단위</b>로만 잡습니다.
      </div>

      {/* ── 어디까지 올렸나 ── */}
      <div style={{ marginTop: 10 }}>
        <button className="btn-sm" onClick={() => setShowUploads((v) => !v)}>
          {showUploads ? '▾' : '▸'} 올린 원장 ({uploads.length}) — {uploadSummary(uploads)}
        </button>
        {showUploads && (
          <div style={{ marginTop: 6, border: '1px solid #eee', borderRadius: 6, overflow: 'auto', maxHeight: 240 }}>
            <table className="tbl" style={{ fontSize: 11.5 }}>
              <thead>
                <tr><th>월</th><th>팀</th><th>파일</th><th className="r">입금건수</th><th className="r">입금액</th>
                  <th className="r">이월</th><th className="r">차변(발행)</th><th>올린 때</th><th>올린 사람</th><th></th></tr>
              </thead>
              <tbody>
                {uploads.length === 0 && (
                  <tr><td colSpan={10} style={{ textAlign: 'center', padding: 14, color: '#BBB' }}>
                    아직 올린 원장이 없습니다.
                  </td></tr>
                )}
                {[...uploads].sort((a, b) => (b.ym + b.team).localeCompare(a.ym + a.team)).map((u) => (
                  <tr key={u.ym + u.team} style={{ background: u.ym === ym && u.team === team ? '#fdfaf3' : undefined }}>
                    <td style={{ fontWeight: 700 }}>{u.ym}</td>
                    <td>{u.team === 'taxteam' ? '기장24팀' : '2본부5팀'}</td>
                    <td style={{ fontSize: 11, color: '#666' }}>{u.fileName}</td>
                    <td className="r">{u.rowCount}</td>
                    <td className="r" style={{ fontWeight: 700 }}>{won(u.amountTotal)}</td>
                    <td className="r" style={{ color: '#888' }}>{won(u.opening)}</td>
                    <td className="r" style={{ color: '#888' }}>{won(u.debitTotal)}</td>
                    <td style={{ fontSize: 11, color: '#888' }}>{u.uploadedAt.slice(0, 16).replace('T', ' ')}</td>
                    <td style={{ fontSize: 11 }}>{u.uploadedBy}</td>
                    <td>
                      <button className="btn-sm" onClick={() => { setYm(u.ym); setTeam(u.team); }}>보기</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 원장 올리기 ── */}
      {!preview && (
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && canWrite) void onFile(f); }}
          style={{
            display: 'block', border: '2px dashed #c9b98a', borderRadius: 8, background: '#fdfaf3',
            padding: '14px 16px', textAlign: 'center', cursor: canWrite && !busy ? 'pointer' : 'default', margin: '10px 0',
          }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: up ? '#92400E' : '#1A2B52' }}>
            {up
              ? `${ym} ${team === 'taxteam' ? '기장24팀' : '2본부5팀'} 원장은 이미 올렸습니다 — 다시 올리면 덮어씁니다`
              : `${ym} ${team === 'taxteam' ? '기장24팀' : '2본부5팀'} 부서별원장 엑셀을 끌어다 놓으세요`}
          </div>
          <div style={{ fontSize: 11.5, color: '#777', lineHeight: 1.7, marginTop: 4 }}>
            인덕 ERP ▸ 부서별원장 ▸ 기간 {ym}-01 ~ 말일 ▸ 조회 ▸ 엑셀 — <b>외상매출금</b> 시트를 읽습니다.
            {up && <><br /><span style={{ color: '#2a7' }}>
              이미 올림: {up.fileName} · 입금 {up.rowCount}건 {won(up.amountTotal)} · {up.uploadedAt.slice(0, 10)}{up.uploadedBy && ` ${up.uploadedBy}`}
            </span></>}
          </div>
          <input type="file" accept=".xls,.xlsx" style={{ display: 'none' }} disabled={busy || !canWrite}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />
        </label>
      )}

      {preview && (
        <div style={{ border: '1px solid #c9b98a', borderRadius: 8, background: '#fdfaf3', padding: 12, margin: '10px 0' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1A2B52', marginBottom: 4 }}>
            읽었습니다 — 입금 {preview.rows.length}건 {won(preview.creditTotal)}
          </div>
          {up && (
            <div className="alert-w" style={{ fontSize: 11.5 }}>
              ⚠️ <b>{ym} {team === 'taxteam' ? '기장24팀' : '2본부5팀'} 원장은 이미 올려져 있습니다</b>
              {' '}({up.fileName} · 입금 {up.rowCount}건 {won(up.amountTotal)} · {up.uploadedAt.slice(0, 10)}{up.uploadedBy && ` ${up.uploadedBy}`}).
              <br />저장하면 <b>그 달 입금을 지우고 이 파일로 바꿉니다</b> — 같은 파일이면 결과는 같고, 다른 파일이면 이전 것은 사라집니다.
              {up.rowCount === preview.rows.length && Math.round(up.amountTotal) === Math.round(preview.creditTotal)
                && <><br /><b>건수·금액이 이미 올린 것과 같습니다 — 같은 파일로 보입니다.</b></>}
            </div>
          )}
          {preview.rows.some((r) => r.paidDate && r.paidDate.slice(0, 7) !== ym) && (
            <div className="alert-w" style={{ fontSize: 11.5 }}>
              ⚠️ 전표일이 <b>{ym}</b> 이 아닌 줄이 섞여 있습니다
              ({[...new Set(preview.rows.map((r) => r.paidDate?.slice(0, 7)).filter(Boolean))].join(', ')}) —
              위에서 고른 달과 원장 조회기간이 같은지 확인해 주세요.
            </div>
          )}
          <div style={{ fontSize: 11.5, color: '#666', marginBottom: 8, lineHeight: 1.7 }}>
            {preview.fileName} · 시트 {preview.sheet}<br />
            원장 이월 {won(preview.opening)} + 차변(발행) {won(preview.debitTotal)} − 대변(입금) {won(preview.creditTotal)}
            {' = '}<b>기말 {won(preview.closing)}</b>
            <br />거래처코드로 우리 사업장에 붙입니다. 못 붙은 건은 아래에 따로 보여드립니다.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn-p" disabled={busy} onClick={() => void run(async () => {
              const withPlace = attachPlaces(preview.rows, entities);
              await saveReceipts(ym, team, withPlace, preview.fileName, {
                opening: preview.opening, debitTotal: preview.debitTotal, creditTotal: preview.creditTotal,
              });
            }, '✓ 입금을 반영했습니다')}>저장하고 반영하기</button>
            <button className="btn-sm" disabled={busy} onClick={() => setPreview(null)}>취소</button>
          </div>
        </div>
      )}

      {/* ── 검산 ── */}
      {up && (
        <div style={{ border: '1px solid #e2d9c6', background: '#fdfaf3', borderRadius: 6, padding: '8px 10px', marginBottom: 10, fontSize: 12 }}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <span><b>원장</b> 이월 {won(up.opening)} + 차변 {won(up.debitTotal)} − 대변 {won(up.amountTotal)}
              {' = '}<b>{won(up.opening + up.debitTotal - up.amountTotal)}</b></span>
            <span style={{ color: '#999' }}>|</span>
            <span><b>우리</b> 기초 {won(sum((r) => r.opening))} + 발행 {won(sum((r) => r.issued))} − 입금 {won(sum((r) => r.paid))}
              {' = '}<b>{won(sum((r) => r.balance))}</b></span>
            {canWrite && (
              <button className="btn-sm" style={{ marginLeft: 'auto' }} disabled={busy}
                onClick={() => { if (confirm(`${ym} ${team} 입금 기록을 지웁니다. 진행할까요?`)) void run(() => clearReceipts(ym, team), '지웠습니다'); }}>
                이 달 입금 지우기
              </button>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 3 }}>
            원장은 <b>그 부서 전체</b>(우리 담당이 아닌 거래처 포함)이고, 우리 쪽은 <b>거래처관리에 등록된 곳</b>만입니다 —
            두 숫자가 다른 것이 정상입니다. 우리 거래처만 놓고 보려면 아래 표를 보세요.
          </div>
        </div>
      )}

      {/* ── 못 붙은 입금 ── */}
      {unmatched.length === 0 && excluded.length > 0 && (
        <div style={{ fontSize: 11, color: '#999', marginBottom: 6 }}>
          ✓ 거래처를 못 찾은 입금은 없습니다. (우리와 무관하다고 접어 둔 {excluded.length}건 {won(excluded.reduce((s, c) => s + c.amount, 0))} 별도)
          <button className="btn-sm" style={{ marginLeft: 6 }} onClick={() => setShowUnmatched(true)}>접어 둔 건 보기</button>
        </div>
      )}
      {unmatched.length > 0 && (
        <div className="alert-w" style={{ fontSize: 11.5 }}>
          <b>거래처를 못 찾은 입금 {unmatched.length}건 · {won(unmatched.reduce((s, c) => s + c.amount, 0))}</b>
          {' — '}원장의 거래처코드가 우리 거래처등록에 없습니다. 다른 회계사 담당이거나 미등록입니다.
          {excluded.length > 0 && <span style={{ color: '#888' }}>{' '}(제외 처리 {excluded.length}건 {won(excluded.reduce((s, c) => s + c.amount, 0))} 별도)</span>}
          <span style={{ display: 'inline-flex', gap: 6, marginLeft: 8 }}>
            <button className="btn-sm" onClick={() => setShowUnmatched(true)}>상세 보기 · 연결하기</button>
            {canWrite && (
              <button className="btn-sm" disabled={busy}
                onClick={() => void run(async () => {
                  const n = await rematchReceipts(entities);
                  if (!n) throw new Error('거래처코드로 새로 붙일 건이 없습니다. 상세에서 손으로 연결해 주세요.');
                }, '✓ 거래처코드로 다시 붙였습니다')}
                title="거래처등록에 ERP 거래처코드를 채워 넣은 뒤 누르면, 코드가 맞는 건이 저절로 붙습니다">
                거래처코드로 다시 붙이기
              </button>
            )}
          </span>
        </div>
      )}
      {showUnmatched && (
        <UnmatchedModal
          rows={[...unmatched, ...excluded]} placeOpts={placeOpts} canWrite={canWrite} busy={busy}
          onClose={() => setShowUnmatched(false)}
          onAssign={(id, opt, code, saveCode) =>
            run(() => assignReceipt(id, opt.id, opt.entityId, code, saveCode), '✓ 거래처를 연결했습니다')}
          onExclude={(ids, on) => run(() => excludeReceipts(ids, on), on ? '✓ 제외했습니다' : '✓ 되돌렸습니다')} />
      )}

      <div style={{ display: 'flex', gap: 4, margin: '12px 0 8px' }}>
        <button className={tab === 'balance' ? 'btn-p' : 'btn-sm'} onClick={() => setTab('balance')}>
          거래처별 잔액
        </button>
        <button className={tab === 'aging' ? 'btn-p' : 'btn-sm'} onClick={() => setTab('aging')}>
          🕰️ 미수금 나이(aging){overdueRows.length > 0 ? ` · 6개월↑ ${overdueRows.length}곳` : ''}
        </button>
      </div>

      {tab === 'aging' && (
        <AgingLedgerBox
          ym={ym} team={team} uploads={arUploads} preview={arPreview} busy={busy} canWrite={canWrite}
          unmatched={arUnmatched}
          placeOpts={placeOpts}
          onFile={onArFile} onCancel={() => setArPreview(null)}
          onSave={() => void run(async () => {
            if (!arPreview) return;
            const rowsWith = attachEntities(arPreview.rows, entities);
            await saveArItems(ym, team, rowsWith, arPreview.fileName, arPreview);
            setArPreview(null);
          }, '✓ 미수금대장을 반영했습니다')}
          onAssign={(name, opt) => run(() => assignArClient(name, opt.entityId, opt.id).then(() => undefined), '✓ 연결했습니다')}
          onExclude={(name, on) => run(() => excludeArClient(name, on).then(() => undefined), on ? '✓ 제외했습니다' : '✓ 되돌렸습니다')} />
      )}
      {tab === 'aging' && (
        <AgingPanel
          rows={agingView} asOf={asOf} busy={agingBusy || busy} source={agingSource}
          q={q} setQ={setQ} overdueOnly={overdueOnly} setOverdueOnly={setOverdueOnly}
          canWrite={canWrite} freshOverdue={freshOverdue.length}
          onDetail={setDetail}
          onNotify={() => void run(async () => {
            const { sent, people, places } = await notifyOverdue(freshOverdue, asOf);
            if (!sent) throw new Error('보낼 대상을 찾지 못했습니다. 담당 회계사·담당직원이 지정되어 있는지 확인해 주세요.');
            flash(`✓ ${people.join('·')} 에게 ${places}곳 알림을 보냈습니다`);
          }, '')} />
      )}
      {detail && <AgingDetail row={detail} asOf={asOf} onClose={() => setDetail(null)} />}

      {tab === 'balance' && (<>
      <div className="sbar">
        <input placeholder="🔍 거래처·사업장·코드·담당CPA" value={q} onChange={(e) => setQ(e.target.value)} />
        <label style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> 잔액 있는 곳만
        </label>
        <span style={{ fontSize: 12, color: '#555' }}>
          {view.length}곳 · 기초 {won(sum((r) => r.opening))} · 발행 {won(sum((r) => r.issued))}
          {' · '}입금 {won(sum((r) => r.paid))} · <b style={{ color: '#1A2B52' }}>미수 {won(sum((r) => r.balance))}</b>
        </span>
      </div>

      <div className="tbl-scroll" style={{ maxHeight: '58vh' }}>
        <table className="tbl" style={{ fontSize: 11.5 }}>
          <thead>
            <tr>
              <th>코드</th><th>거래처</th><th>사업장</th><th>담당CPA</th>
              <th className="r">기초</th><th className="r">발행</th><th className="r">입금</th><th className="r">미수금</th>
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 20, color: '#BBB' }}>
                해당하는 거래처가 없습니다.
              </td></tr>
            )}
            {view.map((r) => (
              <tr key={r.placeId}>
                <td style={{ fontFamily: 'monospace', fontSize: 10.5 }}>{r.code}</td>
                <td style={{ fontWeight: 700, color: '#1A2B52' }}>{r.name}</td>
                <td>{r.placeName}</td>
                <td style={{ fontSize: 11 }}>{r.cpa}</td>
                <td className="r" style={{ color: '#888' }}>{r.opening ? won(r.opening) : ''}</td>
                <td className="r">{r.issued ? won(r.issued) : ''}</td>
                <td className="r" style={{ color: '#2a7' }}>{r.paid ? won(r.paid) : ''}</td>
                <td className="r" style={{ fontWeight: 700, color: r.balance < 0 ? '#c33' : '#1A2B52' }}>{won(r.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: '#f5efdd', fontWeight: 700 }}>
              <td colSpan={4}>합계 {view.length}곳</td>
              <td className="r">{won(sum((r) => r.opening))}</td>
              <td className="r">{won(sum((r) => r.issued))}</td>
              <td className="r">{won(sum((r) => r.paid))}</td>
              <td className="r">{won(sum((r) => r.balance))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      </>)}
    </div>
  );
}

interface PlaceOpt { id: string; entityId: string; label: string; hasCode: boolean }

/**
 * 거래처를 못 찾은 입금 상세.
 *
 * 원장은 그 부서 전체가 나오므로, 여기 남는 건은 두 가지다 —
 *   ① 우리 거래처인데 ERP 거래처코드를 아직 안 채워 둔 것 → **연결**한다(코드도 함께 저장하면 다음 달부턴 저절로).
 *   ② 애초에 우리와 무관한 것 → **제외**로 접는다. 매달 같은 건이 쌓여 진짜 볼 것을 가리지 않게.
 */
function UnmatchedModal({ rows, placeOpts, canWrite, busy, onClose, onAssign, onExclude }: {
  rows: Receipt[];
  placeOpts: PlaceOpt[];
  canWrite: boolean;
  busy: boolean;
  onClose: () => void;
  onAssign: (id: string, opt: PlaceOpt, code: string, saveCode: boolean) => Promise<void>;
  onExclude: (ids: string[], on: boolean) => Promise<void>;
}) {
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [showExcluded, setShowExcluded] = useState(false);
  const [saveCode, setSaveCode] = useState(true);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [kw, setKw] = useState('');

  const view = rows
    .filter((r) => (showExcluded ? r.excluded : !r.excluded))
    .filter((r) => !kw.trim() || (r.clientName + r.clientCode + r.summary).toLowerCase().includes(kw.trim().toLowerCase()))
    .sort((a, b) => (b.paidDate ?? '').localeCompare(a.paidDate ?? ''));
  const toggle = (id: string) => setPick((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const total = view.reduce((s, r) => s + r.amount, 0);

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1040, width: '100%' }}>
        <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          🔎 거래처를 못 찾은 입금
          <span style={{ fontSize: 11, fontWeight: 400, color: '#888' }}>{view.length}건 · {won(total)}</span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>

        <div className="alert-i" style={{ fontSize: 11 }}>
          부서별원장은 <b>그 부서 전체</b>가 나옵니다. 여기 남는 건은 둘 중 하나입니다.
          <br />· <b>우리 거래처인데 ERP 거래처코드가 비어 있는 것</b> — 사업장을 골라 <b>연결</b>하세요.
          <b>거래처코드도 함께 저장</b>을 켜 두면 다음 달부터는 저절로 붙습니다.
          <br />· <b>우리와 무관한 것</b>(다른 회계사 담당 등) — <b>제외</b>로 접어 두면 다음부터 이 목록에 뜨지 않습니다.
          지우지는 않으므로 원장 합계 검산에는 그대로 남습니다.
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
          <input placeholder="🔍 거래처·코드·적요" value={kw} onChange={(e) => setKw(e.target.value)} style={{ flex: '0 1 240px' }} />
          <label style={{ fontSize: 11.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={showExcluded} onChange={(e) => { setShowExcluded(e.target.checked); setPick(new Set()); }} />
            {' '}제외한 것 보기
          </label>
          <label style={{ fontSize: 11.5, cursor: 'pointer' }} title="연결할 때 그 사업장에 ERP 거래처코드를 적어 둡니다">
            <input type="checkbox" checked={saveCode} onChange={(e) => setSaveCode(e.target.checked)} />
            {' '}거래처코드도 함께 저장
          </label>
          <span style={{ fontSize: 12, color: '#555' }}>선택 <b>{pick.size}</b>건</span>
          {canWrite && (
            showExcluded ? (
              <button className="btn-sm" disabled={busy || !pick.size}
                onClick={() => void onExclude([...pick], false).then(() => setPick(new Set()))}>
                제외 되돌리기
              </button>
            ) : (
              <button className="btn-sm btn-sm-del" disabled={busy || !pick.size}
                onClick={() => {
                  if (!confirm(`${pick.size}건을 '우리와 무관'으로 접어 둡니다.\n지우지 않으며, 제외한 것 보기로 언제든 되돌릴 수 있습니다.`)) return;
                  void onExclude([...pick], true).then(() => setPick(new Set()));
                }}>
                선택한 건 제외 처리
              </button>
            )
          )}
        </div>

        <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
          <table className="tbl" style={{ fontSize: 11.5 }}>
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>입금일</th><th>전표번호</th><th>코드</th><th>거래처(원장)</th><th>적요</th>
                <th className="r">금액</th><th style={{ minWidth: 300 }}>우리 사업장에 연결</th>
              </tr>
            </thead>
            <tbody>
              {view.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 18, color: '#BBB' }}>
                  {showExcluded ? '제외한 건이 없습니다.' : '못 찾은 입금이 없습니다.'}
                </td></tr>
              )}
              {view.map((r) => (
                <tr key={r.id}>
                  <td><input type="checkbox" checked={pick.has(r.id!)} onChange={() => toggle(r.id!)} /></td>
                  <td>{r.paidDate ?? dash}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 10.5 }}>{r.slipNo}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 10.5, fontWeight: 700 }}>{r.clientCode || dash}</td>
                  <td style={{ fontWeight: 700, color: '#1A2B52' }}>{r.clientName}</td>
                  <td style={{ fontSize: 11, color: '#666' }}>{r.summary}</td>
                  <td className="r" style={{ fontWeight: 700 }}>{won(r.amount)}</td>
                  <td>
                    {canWrite && !showExcluded ? (
                      <span style={{ display: 'flex', gap: 4 }}>
                        <input list="recv-places" value={choice[r.id!] ?? ''} placeholder="코드·상호로 찾기"
                          onChange={(e) => setChoice((p) => ({ ...p, [r.id!]: e.target.value }))}
                          style={{ flex: 1, fontSize: 11 }} />
                        <button className="btn-p" disabled={busy || !placeOpts.some((o) => o.label === (choice[r.id!] ?? ''))}
                          onClick={() => {
                            const o = placeOpts.find((x) => x.label === choice[r.id!]);
                            if (o) void onAssign(r.id!, o, r.clientCode, saveCode);
                          }}>연결</button>
                      </span>
                    ) : showExcluded ? <span style={{ color: '#999' }}>제외됨</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="recv-places">
            {placeOpts.map((o) => <option key={o.id} value={o.label} />)}
          </datalist>
        </div>
      </div>
    </div>
  );
}
