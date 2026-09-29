// 우체국 「우편 업로드 양식」 내려받기 — 고른 발송요청을 양식 8열로 보여 주고(고칠 수 있음) .xls 로 내려받는다.
// 사용자 2026-09-29: 「우체국업무시 첨부양식으로 발송정보를 내려받을 수 있게 … G,H열은 공란 … 담을 발송요청정보를 선택할 수 있게」.
// 우편번호가 없으면 여기서 넣고, 넣은 번호는 거래처담당자에 저장해 다음부터 저절로 채운다.
import { useEffect, useState } from 'react';
import type { SendRequest } from '../../lib/docSendApi';
import { toPostRow, postUploadXls, type PostRow } from '../../lib/postUpload';
import { contactZips, saveContactZip } from '../../lib/postUploadApi';
import { download } from '../dsd/dsdUi';
import { todayYmd } from '../../lib/format';

const ZIP = /^\d{5}$/;

export default function PostUploadModal({ reqs, onClose }: { reqs: SendRequest[]; onClose: () => void }) {
  const [rows, setRows] = useState<(PostRow & { on: boolean; zipWas: string })[]>([]);
  const [saveZip, setSaveZip] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    void contactZips(reqs.map((r) => r.contactId ?? '')).then((zips) => {
      if (off) return;
      setRows(reqs.map((r) => { const p = toPostRow(r, r.contactId ? zips.get(r.contactId) : undefined); return { ...p, on: true, zipWas: p.zip }; }));
    }).catch((e) => setErr(e instanceof Error ? e.message : '담당자 정보를 읽지 못했습니다.'));
    return () => { off = true; };
  }, [reqs]);

  const set = (i: number, p: Partial<PostRow & { on: boolean }>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const picked = rows.filter((r) => r.on);
  const noZip = picked.filter((r) => !ZIP.test(r.zip.trim())).length;

  async function go() {
    setBusy(true); setErr(null);
    try {
      const bytes = await postUploadXls(picked.map((r) => ({ ...r, zip: r.zip.trim() })));
      download(bytes, `우편업로드_${todayYmd().replace(/-/g, '')}_${picked.length}건.xls`, 'application/vnd.ms-excel');
      // 새로 넣은 우편번호 → 거래처담당자(다음부터 저절로).
      if (saveZip) {
        const todo = new Map<string, string>();
        for (const r of picked) if (r.bizContactId && ZIP.test(r.zip.trim()) && r.zip.trim() !== r.zipWas) todo.set(r.bizContactId, r.zip.trim());
        for (const [id, z] of todo) await saveContactZip(id, z);
      }
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : '내려받지 못했습니다.'); } finally { setBusy(false); }
  }

  const inp = (v: string, on: (s: string) => void, w: number, bad = false) => (
    <input className="btn-sm" value={v} onChange={(e) => on(e.target.value)} style={{ width: w, borderColor: bad ? 'var(--bad)' : undefined }} />
  );
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="card" style={{ maxWidth: 1180, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
        <div className="chdr">📮 우편 업로드 양식
          <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>우체국 접수용 — 담을 건을 고르고 고칠 곳을 고친 뒤 내려받으세요</span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>
        {err && <div style={{ color: 'var(--bad)', fontSize: 'var(--fs-2)', marginBottom: 6 }}>{err}</div>}
        <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginBottom: 6, lineHeight: 1.6 }}>
          주소는 도로명·건물번호(주소)와 층·호·건물명(상세주소)으로, 전화는 010 이면 휴대전화·그 밖은 일반전화로 나눴습니다. 등기번호·중량 열은 비워서 내려받습니다.
        </div>
        <div style={{ overflow: 'auto', flex: 1 }}>
          <table className="tbl" style={{ fontSize: 'var(--fs-1)' }}>
            <thead><tr style={{ background: 'var(--surface-2)' }}>
              <th style={{ width: 30 }}><input type="checkbox" checked={rows.length > 0 && rows.every((r) => r.on)} onChange={(e) => setRows(rows.map((r) => ({ ...r, on: e.target.checked })))} /></th>
              <th>받는 분</th><th>우편번호</th><th>주소(시도+시군구+도로명+건물번호)</th><th>상세주소</th><th>일반전화</th><th>휴대전화</th>
              <th style={{ color: 'var(--ink-4)' }}>등기번호·중량</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} style={{ opacity: r.on ? 1 : 0.45 }}>
                  <td><input type="checkbox" checked={r.on} onChange={(e) => set(i, { on: e.target.checked })} /></td>
                  <td>{inp(r.name, (s) => set(i, { name: s }), 190)}</td>
                  <td>{inp(r.zip, (s) => set(i, { zip: s.replace(/[^\d]/g, '').slice(0, 5) }), 64, r.on && !ZIP.test(r.zip.trim()))}</td>
                  <td>{inp(r.addr, (s) => set(i, { addr: s }), 260)}</td>
                  <td>{inp(r.detail, (s) => set(i, { detail: s }), 200)}</td>
                  <td>{inp(r.tel, (s) => set(i, { tel: s }), 110)}</td>
                  <td>{inp(r.mobile, (s) => set(i, { mobile: s }), 110)}</td>
                  <td style={{ color: 'var(--ink-4)' }}>(공란)</td>
                </tr>
              ))}
              {!rows.length && !err && <tr><td colSpan={8} style={{ color: 'var(--ink-3)' }}>읽는 중…</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap', fontSize: 'var(--fs-2)' }}>
          {noZip > 0 && <span style={{ color: 'var(--warn)' }}>우편번호가 없는 건 {noZip}건 — 빨간 칸에 넣으세요(없어도 내려받을 수는 있습니다).</span>}
          <label style={{ color: 'var(--ink-2)' }}><input type="checkbox" checked={saveZip} onChange={(e) => setSaveZip(e.target.checked)} /> 넣은 우편번호를 거래처담당자에 저장</label>
          <button className="btn-p" style={{ marginLeft: 'auto' }} disabled={busy || !picked.length} onClick={() => void go()}>
            {busy ? '만드는 중…' : `📥 양식 내려받기 (${picked.length}건, .xls)`}
          </button>
        </div>
      </div>
    </div>
  );
}
