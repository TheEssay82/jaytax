// 일반조서 관리 › ② 표준양식 — 한공회 묶음(zip)을 연도·기준별로 등록한다.
//
// zip 을 브라우저에서 풀어 어느 파일에 어느 조서 시트가 있는지 목록(catalog)을 만들고, 파일과 목록을 함께
// 저장한다. 4000(계정별)·JE Test·참고 파일은 목록에서 빼되 왜 뺐는지 보여 준다.
import { useState } from 'react';
import { readBundle } from '../../lib/gwpTemplate';
import { saveTemplate, deleteTemplate, fileUrl, fmtKb, type GwpTemplate } from '../../lib/gwpApi';
import { defaultAuditFy } from '../../lib/dsdNotes';
import { AUDIT_BASES, type AuditBasis } from '../../lib/gwpSetup';
import { confirmDanger } from '../common/DangerConfirm';

export default function GwpTemplatesCard(
  { templates, onChange }: { templates: GwpTemplate[]; onChange: () => void | Promise<void> },
) {
  const [fy, setFy] = useState(defaultAuditFy());
  const [basis, setBasis] = useState<AuditBasis>('K-IFRS');
  const [busy, setBusy] = useState(false);
  const [say, setSay] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function take(f: File | undefined) {
    if (!f) return;
    setBusy(true); setSay(null); setDone(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const { catalog } = readBundle(bytes);
      const papers = catalog.sheets.filter((s) => s.code).length;
      if (!papers) throw new Error('이 zip 에서 조서 시트를 찾지 못했습니다. 한공회 묶음(Section 1000~9000 폴더)인지 보십시오.');
      const t = await saveTemplate(fy, basis, { name: f.name, bytes }, catalog);
      await onChange();
      setDone(`${t.fy} ${t.basis} 묶음을 등록했습니다 — 파일 ${catalog.files.length}개 · 조서 시트 ${papers}장`
        + (catalog.skipped.length ? ` · 뺀 파일 ${catalog.skipped.length}개(4000·JE Test·참고)` : '') + '.');
    } catch (e) {
      setSay(e instanceof Error ? e.message : '등록하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: GwpTemplate) {
    const ok = await confirmDanger({
      level: 'delete', title: '표준양식 묶음을 지웁니다', target: `${t.fy} ${t.basis} — ${t.fileName}`,
      detail: '이 연도·기준으로는 이월본·초도 조립을 만들 수 없게 됩니다. 이미 만든 회사 조서는 그대로입니다.',
    });
    if (!ok) return;
    try { await deleteTemplate(t); await onChange(); setDone('지웠습니다.'); } catch (e) { setSay(e instanceof Error ? e.message : '지우지 못했습니다.'); }
  }

  return (
    <div className="card">
      <div className="chdr">
        ② 표준양식
        <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>한공회 배포 묶음 — 연도·기준마다 한 벌</span>
      </div>
      <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7, marginBottom: 10 }}>
        한공회가 배포한 <b>zip 을 그대로</b> 올리십시오. 브라우저에서 풀어 어느 파일에 어느 조서가 있는지 읽어 둡니다.
        <b> 4000(계정별)·JE Test·참고 파일은 뺍니다.</b> 같은 연도·기준을 다시 올리면 바뀝니다.
      </div>

      <div className="frow"><span className="fl">등록</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="btn-sm" style={{ width: 78 }} type="number" value={fy} onChange={(e) => setFy(Number(e.target.value))} title="양식 연도(배포 연도)" />
          <select className="btn-sm" value={basis} onChange={(e) => setBasis(e.target.value as AuditBasis)}>
            {AUDIT_BASES.map((b) => <option key={b}>{b}</option>)}
          </select>
          <label className="btn-sm btn-sm-navy" style={{ cursor: busy ? 'default' : 'pointer' }}>
            {busy ? '읽는 중…' : 'zip 고르기'}
            <input type="file" accept=".zip" style={{ display: 'none' }} disabled={busy}
              onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
      </div>
      {say && <div style={{ marginTop: 6, fontSize: 'var(--fs-2)', color: 'var(--bad)' }}>{say}</div>}
      {done && <div style={{ marginTop: 6, fontSize: 'var(--fs-2)', color: 'var(--good)' }}>{done}</div>}

      {templates.length === 0 ? (
        <div style={{ marginTop: 10, fontSize: 'var(--fs-2)', color: 'var(--ink-3)' }}>아직 등록한 묶음이 없습니다.</div>
      ) : (
        <div className="tbl-wide" style={{ marginTop: 10 }}>
          <table className="tbl">
            <thead>
              <tr style={{ background: 'var(--surface-2)' }}>
                <th style={{ width: 60 }}>연도</th><th style={{ width: 130 }}>기준</th><th>파일</th>
                <th style={{ width: 70 }}>파일 수</th><th style={{ width: 80 }}>조서 시트</th><th style={{ width: 110 }}>올린 날</th><th style={{ width: 150 }}></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td style={{ textAlign: 'center' }}>{t.fy}</td>
                  <td>{t.basis}</td>
                  <td>
                    {t.fileName} <span style={{ color: 'var(--ink-3)' }}>· {fmtKb(t.fileSize)}</span>
                    {open === t.id && (
                      <div style={{ marginTop: 6, fontSize: 'var(--fs-0)', color: 'var(--ink-3)', lineHeight: 1.6, maxHeight: 220, overflow: 'auto' }}>
                        {t.catalog.files.map((f) => (
                          <div key={f}>{f} <span style={{ color: 'var(--ink-4)' }}>— {t.catalog.sheets.filter((s) => s.file === f && s.code).map((s) => s.code).join(' · ')}</span></div>
                        ))}
                        {t.catalog.skipped.length > 0 && (
                          <div style={{ marginTop: 4, color: 'var(--ink-4)' }}>뺀 파일: {t.catalog.skipped.map((s) => `${s.file.split('/').pop()}(${s.why})`).join(' · ')}</div>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>{t.catalog.files.length}</td>
                  <td style={{ textAlign: 'right' }}>{t.catalog.sheets.filter((s) => s.code).length}</td>
                  <td style={{ color: 'var(--ink-3)' }}>{t.updatedAt.slice(0, 10)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn-sm" onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? '접기' : '내용'}</button>{' '}
                    <button className="btn-sm" onClick={() => void fileUrl(t.storagePath, t.fileName).then((u) => window.open(u, '_blank', 'noopener')).catch((e) => setSay(e instanceof Error ? e.message : '내려받지 못했습니다.'))}>내려받기</button>{' '}
                    <button className="btn-sm btn-sm-del" onClick={() => void remove(t)}>지우기</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
