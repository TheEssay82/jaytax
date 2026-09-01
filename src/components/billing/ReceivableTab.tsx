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
  type Receipt, type LedgerRead, type UploadState,
} from '../../lib/receiptApi';

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const prevMonth = () => {
  const d = new Date(todayYmd());
  d.setDate(1); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

interface Row {
  placeId: string; code: string; name: string; placeName: string; cpa: string; teams: string[];
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
          placeId: p.id, code: `${e.code}-${String(p.placeNo).padStart(2, '0')}`,
          name: corpDisplayName(e.name, e.corpForm, e.corpFormPosition), placeName: p.placeName,
          cpa: p.cpa || '', teams: p.salesTeams ?? [],
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
  const unmatched = receipts.filter((c) => c.ym <= ym && !c.placeId);
  const up = uploads.find((u) => u.ym === ym && u.team === team);

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
        <select value={ym} onChange={(e) => setYm(e.target.value)} style={{ fontWeight: 700 }}
          title="이 달까지의 누계로 미수금을 계산합니다">
          {monthOpts.map((x) => <option key={x} value={x}>{x} 까지</option>)}
        </select>
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

      {/* ── 원장 올리기 ── */}
      {!preview && (
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && canWrite) void onFile(f); }}
          style={{
            display: 'block', border: '2px dashed #c9b98a', borderRadius: 8, background: '#fdfaf3',
            padding: '14px 16px', textAlign: 'center', cursor: canWrite && !busy ? 'pointer' : 'default', margin: '10px 0',
          }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1A2B52' }}>
            {ym} <b>{team === 'taxteam' ? '기장24팀' : '2본부5팀'}</b> 부서별원장 엑셀을 끌어다 놓으세요
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
      {unmatched.length > 0 && (
        <div className="alert-w" style={{ fontSize: 11.5 }}>
          <b>거래처를 못 찾은 입금 {unmatched.length}건 · {won(unmatched.reduce((s, c) => s + c.amount, 0))}</b>
          {' — '}거래처코드가 우리 거래처등록에 없습니다. 다른 회계사 담당이거나 미등록입니다.
          <div style={{ marginTop: 4, color: '#666' }}>
            {unmatched.slice(0, 8).map((c) => `${c.clientName} ${won(c.amount)}`).join(' · ')}
            {unmatched.length > 8 && ` 외 ${unmatched.length - 8}건`}
          </div>
        </div>
      )}

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
    </div>
  );
}
