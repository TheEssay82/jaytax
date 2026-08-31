// 기장등청구관리 › 기초 미수금 (2026-07-01 기준 · 사업장 단위)
//
// 단위를 사업장으로 잡은 이유: 세금계산서가 사업자번호(사업장) 단위로 발행되고,
// 기초 시점의 과거 청구에는 계약 연결이 없어 계약별로 쪼갤 근거가 없다.
// 기초 이후 발행분은 발행요청에 계약·회차가 걸리므로 그때부터 계약별로 추적된다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { listBizEntities, corpDisplayName, type BizEntityFull } from '../../lib/bizRegistryApi';
import {
  listReceivableOpenings, saveReceivableOpenings, OPENING_AS_OF, type ReceivableOpening,
} from '../../lib/invoiceRequestApi';
import { exportOpeningTemplate, parseOpeningFile } from '../../lib/receivableExcel';

const won = (n: number) => n.toLocaleString('ko-KR');

interface Row {
  placeId: string; code: string; company: string; placeName: string;
  bizRegNo: string; status: string; amount: number | null; note: string;
}

export default function ReceivableOpeningTab() {
  const { readonly, role } = useAuth();
  const canWrite = !readonly && role !== 'per_head_accountant';
  const [entities, setEntities] = useState<BizEntityFull[]>([]);
  const [openings, setOpenings] = useState<ReceivableOpening[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [edit, setEdit] = useState<Record<string, string>>({});

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setErr(null);
      const [e, o] = await Promise.all([listBizEntities(), listReceivableOpenings()]);
      setEntities(e); setOpenings(o); setEdit({});
    } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo<Row[]>(() => {
    const byPlace = new Map(openings.map((o) => [o.placeId, o]));
    const out: Row[] = [];
    for (const e of entities) {
      const company = corpDisplayName(e.name, e.corpForm, e.corpFormPosition);
      for (const p of e.places) {
        const o = byPlace.get(p.id);
        out.push({
          placeId: p.id, code: e.code, company, placeName: p.placeName,
          bizRegNo: p.bizRegNo || '', status: p.status,
          amount: o ? o.amount : null, note: o?.note ?? '',
        });
      }
    }
    return out.sort((a, b) => a.company.localeCompare(b.company, 'ko'));
  }, [entities, openings]);

  const view = useMemo(() => {
    let list = rows;
    if (onlyEmpty) list = list.filter((r) => r.amount === null);
    if (q.trim()) {
      const k = q.trim().toLowerCase();
      list = list.filter((r) => (r.code + r.company + r.placeName + r.bizRegNo).toLowerCase().includes(k));
    }
    return list;
  }, [rows, q, onlyEmpty]);

  const entered = rows.filter((r) => r.amount !== null);
  const total = entered.reduce((s, r) => s + (r.amount ?? 0), 0);
  const dirty = Object.keys(edit).filter((k) => edit[k] !== '');

  async function saveEdits() {
    const payload = dirty.map((placeId) => ({ placeId, amount: Number(edit[placeId].replace(/[^\d.-]/g, '')) || 0 }));
    if (!payload.length) return;
    setBusy(true);
    try { const n = await saveReceivableOpenings(payload); await load(); flash(`✓ ${n}건 저장`); }
    catch (e) { alert('저장 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }
  async function onFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const parsed = await parseOpeningFile(file);
      if (!parsed.length) { alert('업로드할 금액이 없습니다. (금액 칸이 빈 행은 건너뜁니다)'); return; }
      if (!confirm(`${parsed.length}개 사업장의 기초 미수금을 저장합니다. 진행할까요?`)) return;
      const n = await saveReceivableOpenings(parsed.map((p) => ({ placeId: p.placeId, amount: p.amount, note: p.note })));
      await load(); flash(`✓ ${n}건 저장`);
    } catch (e) { alert('업로드 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="card">불러오는 중…</div>;

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        💰 기초 미수금 <span style={{ fontSize: 11, fontWeight: 400, color: '#888' }}>{OPENING_AS_OF} 기준 · 사업장 단위</span>
        <span style={{ fontSize: 11, fontWeight: 400, color: '#888' }}>
          입력 {entered.length}/{rows.length} · 합계 {won(total)}
        </span>
        {msg && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#2a7' }}>{msg}</span>}
      </div>
      {err && <div className="alert-w">{err}</div>}

      <div className="alert-i" style={{ fontSize: 11 }}>
        {OPENING_AS_OF} 시점에 아직 못 받은 금액(부가세 포함)을 <b>사업장별로</b> 적습니다. 세금계산서가 사업자번호 단위로
        나가기 때문에 사업장이 기준입니다. <b>0원도 저장하면 '확인함'</b>으로 남아, 아직 안 본 사업장과 구분됩니다.
        이 시점 이후 발행분은 발행요청에 계약·회차가 붙으므로 그때부터는 계약별로 추적됩니다.
      </div>

      <div className="sbar">
        <input placeholder="🔍 거래처코드·거래처·사업장·사업자번호" value={q} onChange={(e) => setQ(e.target.value)} />
        <label style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} /> 미입력만
        </label>
        {canWrite && (
          <>
            <button className="btn-sm btn-sm-blue" disabled={busy} onClick={() => void exportOpeningTemplate(entities, openings)}>
              📤 양식 내보내기
            </button>
            <label className="btn-sm btn-sm-blue" style={{ cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
              📥 Excel 업로드
              <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} disabled={busy} onChange={onFile} />
            </label>
            <button className="btn-p" disabled={busy || !dirty.length} onClick={() => void saveEdits()}>
              화면 입력 {dirty.length}건 저장
            </button>
          </>
        )}
      </div>

      <div className="tbl-scroll">
        <table className="tbl" style={{ fontSize: 11.5 }}>
          <thead>
            <tr>
              <th>거래처코드</th><th>거래처</th><th>사업장</th><th>사업자번호</th><th>상태</th>
              <th className="r">기초 미수금</th><th>비고</th>
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: '#BBB' }}>해당 사업장 없음</td></tr>
            )}
            {view.map((r) => (
              <tr key={r.placeId} style={{ opacity: r.status === '정상' ? 1 : 0.6 }}>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.code}</td>
                <td style={{ fontWeight: 700, color: '#1A2B52' }}>{r.company}</td>
                <td>{r.placeName}</td>
                <td style={{ fontSize: 11 }}>{r.bizRegNo || <span style={{ color: '#CCC' }}>—</span>}</td>
                <td>{r.status}</td>
                <td className="r">
                  {canWrite ? (
                    <input
                      value={edit[r.placeId] ?? (r.amount === null ? '' : String(r.amount))}
                      onChange={(e) => setEdit((p) => ({ ...p, [r.placeId]: e.target.value }))}
                      placeholder={r.amount === null ? '미입력' : ''}
                      style={{ width: 110, textAlign: 'right', fontSize: 11.5 }}
                    />
                  ) : r.amount === null ? <span style={{ color: '#CCC' }}>미입력</span> : won(r.amount)}
                </td>
                <td style={{ fontSize: 11, color: '#666' }}>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
