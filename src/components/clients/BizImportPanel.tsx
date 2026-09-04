// 거래처등록 › 기존자료 일괄이관 패널 (최고관리자 전용, 1회성)
// clients + doc_clients → biz_* 자동이관. 부족 필드는 이후 Excel 라운드트립으로 보강.
import { useState } from 'react';
import { previewLegacyImport, runLegacyImport, type ImportRow, type ImportResult } from '../../lib/bizImportApi';
import { corpDisplayName, type BizEntityFull, type StaffProfile } from '../../lib/bizRegistryApi';
import { exportBizRegistry, parseBizExcelFile, applyBizExcel, type ExcelApplyResult } from '../../lib/bizExcel';
import { applyUnifiedImport, previewUnifiedImport, type UnifiedResult, type UnifiedPreview } from '../../lib/bizUnifiedImport';

export default function BizImportPanel({ entities, staff, onImported }: { entities: BizEntityFull[]; staff: StaffProfile[]; onImported: () => void }) {
  const [excelBusy, setExcelBusy] = useState(false);
  const [excelResult, setExcelResult] = useState<ExcelApplyResult | null>(null);
  async function doExport() { try { await exportBizRegistry(entities); } catch (e) { alert('내보내기 실패: ' + (e instanceof Error ? e.message : e)); } }
  async function onFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    if (!confirm('업로드한 Excel로 거래처를 보강/등록합니다.\n(코드 있는 행=보강, 코드 없는 행=신규 등록) 진행할까요?')) return;
    setExcelBusy(true); setExcelResult(null);
    try {
      const rows = await parseBizExcelFile(file);
      const r = await applyBizExcel(rows, entities, staff);
      setExcelResult(r);
      onImported();
    } catch (e) { alert('업로드 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setExcelBusy(false); }
  }
  // 통합엑셀(3시트) 대량등록 — 드라이런 미리보기 → 실행 2단계
  const [uniBusy, setUniBusy] = useState(false);
  const [uniResult, setUniResult] = useState<UnifiedResult | null>(null);
  const [uniPreview, setUniPreview] = useState<UnifiedPreview | null>(null);
  const [uniFile, setUniFile] = useState<File | null>(null);
  async function onUnifiedFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    setUniBusy(true); setUniResult(null); setUniPreview(null); setUniFile(file);
    try {
      const pv = await previewUnifiedImport(file);
      setUniPreview(pv);
    } catch (e) { alert('미리보기 실패: ' + (e instanceof Error ? e.message : e)); setUniFile(null); }
    finally { setUniBusy(false); }
  }
  async function runUnified() {
    if (!uniFile) return;
    if (!confirm('미리보기 계획대로 프로덕션에 등록합니다. 되돌리기 번거로우니 계획을 확인하셨나요?\n진행할까요?')) return;
    setUniBusy(true); setUniResult(null);
    try {
      const r = await applyUnifiedImport(uniFile);
      setUniResult(r); setUniPreview(null); setUniFile(null);
      onImported();
    } catch (e) { alert('통합 업로드 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setUniBusy(false); }
  }

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function preview() {
    setLoading(true); setResult(null);
    try {
      const r = await previewLegacyImport();
      setRows(r);
      setSel(new Set(r.filter((x) => !x.exists).map((x) => x.key)));
    } catch (e) { alert('미리보기 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setLoading(false); }
  }
  async function run() {
    if (!rows) return;
    const chosen = rows.filter((r) => sel.has(r.key) && !r.exists);
    if (!chosen.length) return alert('이관할 신규 대상이 없습니다.');
    if (!confirm(`${chosen.length}건을 거래처관리로 이관합니다. 진행할까요?\n(부족한 정보는 이관 후 Excel로 보강합니다)`)) return;
    setLoading(true);
    try {
      const res = await runLegacyImport(chosen);
      setResult(res);
      onImported();
      await preview();
    } catch (e) { alert('이관 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setLoading(false); }
  }
  const toggle = (k: string) => setSel((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const newCount = rows?.filter((r) => !r.exists).length ?? 0;
  const existCount = rows?.filter((r) => r.exists).length ?? 0;
  const selCount = rows?.filter((r) => sel.has(r.key) && !r.exists).length ?? 0;

  return (
    <div style={{ border: '1px dashed #c9a54a', borderRadius: 6, background: '#fdfaf1', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <span style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: '#8a6d1f' }}>📥 기존자료 일괄등록</span>
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>최고관리자 · 1회성 (세무조정 clients + 문서발송 doc_clients → 거래처관리)</span>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-2)' }}>{open ? '▾' : '▸'}</span>
      </div>

      {open && (
        <div style={{ padding: '0 10px 10px' }}>
          <div style={{ fontSize: 'var(--fs-1)', color: '#777', marginBottom: 8 }}>
            회사명·사업자번호로 자동 병합하여 <b>귀속주체 + 본사 사업장</b>을 만듭니다. 청구 거래처는 <b>매출</b>, 발송 전용은 <b>일반</b>으로 이관됩니다.
            법인등록번호·과세유형·원천세·홈텍스·개업일 등 <b>부족 정보는 비워두고</b> 이후 Excel로 채웁니다.
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <button className="btn-sm btn-sm-blue" disabled={loading} onClick={preview}>{loading ? '처리 중…' : '🔍 미리보기 불러오기'}</button>
            {rows && (
              <>
                <span style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)' }}>신규 <b>{newCount}</b> · 이미이관 {existCount} · 선택 <b>{selCount}</b></span>
                <button className="btn-p" disabled={loading || selCount === 0} onClick={run} style={{ marginLeft: 'auto' }}>선택 {selCount}건 이관 실행</button>
              </>
            )}
          </div>

          {result && (
            <div style={{ fontSize: 'var(--fs-2)', background: '#eef7ee', border: '1px solid #cbe3cb', borderRadius: 5, padding: '6px 8px', marginBottom: 8, color: '#256b25' }}>
              ✓ 이관 완료 — 생성 {result.created} · 건너뜀(이미있음) {result.skipped}
              {result.failed.length > 0 && <span style={{ color: 'var(--bad)' }}> · 실패 {result.failed.length} ({result.failed.map((f) => f.name).join(', ')})</span>}
            </div>
          )}

          {rows && rows.length > 0 && (
            <div style={{ maxHeight: 340, overflow: 'auto', border: '1px solid var(--rule-2)', borderRadius: 5 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-1)' }}>
                <thead>
                  <tr style={{ background: '#f4efe4', position: 'sticky', top: 0 }}>
                    <th style={thc}></th><th style={thc}>회사명(통일표기)</th><th style={thc}>법인격</th><th style={thc}>구분</th><th style={thc}>성격</th>
                    <th style={thc}>사업자번호</th><th style={thc}>CPA</th><th style={thc}>대표이사</th><th style={thc}>담당직원</th>
                    <th style={thc}>소스</th><th style={thc}>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} style={{ borderTop: '1px solid var(--rule-2)', opacity: r.exists ? 0.5 : 1 }}>
                      <td style={tdc}><input type="checkbox" disabled={r.exists} checked={!r.exists && sel.has(r.key)} onChange={() => toggle(r.key)} /></td>
                      <td style={{ ...tdc, fontWeight: 600 }}>{corpDisplayName(r.name, r.corpForm, r.corpFormPosition)}</td>
                      <td style={tdc}>{r.corpForm || <span style={{ color: 'var(--ink-4)' }}>–</span>}</td>
                      <td style={tdc}>{r.kind}</td>
                      <td style={tdc}>{r.nature}</td>
                      <td style={tdc}>{r.taxId || <span style={{ color: '#c93' }}>–</span>}</td>
                      <td style={tdc}>{r.cpa || <span style={{ color: 'var(--ink-4)' }}>–</span>}</td>
                      <td style={tdc}>{r.repName || <span style={{ color: 'var(--ink-4)' }}>–</span>}</td>
                      <td style={tdc}>{r.staffName || <span style={{ color: 'var(--ink-4)' }}>–</span>}</td>
                      <td style={tdc}>{r.source === 'both' ? '청구+발송' : r.source === 'clients' ? '청구' : '발송'}</td>
                      <td style={tdc}>{r.exists ? <span style={{ color: 'var(--ink-3)' }}>이미이관</span> : <span style={{ color: '#2a8', fontWeight: 700 }}>신규</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows && rows.length === 0 && <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-3)' }}>이관할 기존 거래처가 없습니다.</div>}

          {/* Phase B — Excel 보강 / 대량등록 */}
          <div style={{ borderTop: '1px solid var(--rule-2)', marginTop: 12, paddingTop: 8 }}>
            <div style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: '#8a6d1f', marginBottom: 4 }}>📊 Excel 보강 / 대량등록</div>
            <div style={{ fontSize: 'var(--fs-1)', color: '#777', marginBottom: 6 }}>
              내보내기 → 부족 정보(법인등록번호·과세유형·원천세·홈텍스·개업일 등) 채우기 → 다시 올리기.
              <b> 코드 있는 행 = 보강</b>(빈 칸은 미변경), <b>코드 없는 행 = 신규 등록</b>. 주민번호·홈텍스PW는 입력값만 암호화 저장됩니다.
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn-sm btn-sm-blue" onClick={doExport} disabled={excelBusy || entities.length === 0}>
                📤 보강양식 내보내기 ({entities.length} 거래처)
              </button>
              <label className="btn-p" style={{ cursor: excelBusy ? 'default' : 'pointer', opacity: excelBusy ? 0.6 : 1 }}>
                {excelBusy ? '처리 중…' : '📥 Excel 업로드'}
                <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} disabled={excelBusy} onChange={onFile} />
              </label>
            </div>
            {excelResult && (
              <div style={{ fontSize: 'var(--fs-2)', background: excelResult.failed.length ? '#fbf0ee' : '#eef7ee', border: `1px solid ${excelResult.failed.length ? '#e3cbcb' : '#cbe3cb'}`, borderRadius: 5, padding: '6px 8px', marginTop: 8, color: '#256b25' }}>
                <div>✓ 완료 — 보강 {excelResult.updated} · 신규 {excelResult.created} {excelResult.failed.length > 0 && <span style={{ color: 'var(--bad)' }}>· 실패 {excelResult.failed.length}</span>}</div>
                {excelResult.failed.length > 0 && (
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--bad)' }}>
                    {excelResult.failed.slice(0, 10).map((f, i) => <li key={i}><b>{f.ref}</b>: {f.error}</li>)}
                    {excelResult.failed.length > 10 && <li>… 외 {excelResult.failed.length - 10}건</li>}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* 통합엑셀(3시트) 대량등록 */}
          <div style={{ borderTop: '1px solid var(--rule-2)', marginTop: 12, paddingTop: 8 }}>
            <div style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: '#8a6d1f', marginBottom: 4 }}>🗂️ 통합엑셀 대량등록 (3시트)</div>
            <div style={{ fontSize: 'var(--fs-1)', color: '#777', marginBottom: 6 }}>
              <b>거래처·사업장 / 매출계약 / 거래처담당자</b> 3시트를 한 번에 적재합니다.
              <b> 거래처코드·사업자번호 일치 = 보강</b>, <b>그룹키</b>가 같으면 1거래처 N사업장, 나머지는 신규.
              폐업(상태)·기장 매출계약·담당자까지 함께 반영됩니다.
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <label className="btn-sm btn-sm-blue" style={{ cursor: uniBusy ? 'default' : 'pointer', opacity: uniBusy ? 0.6 : 1 }}>
                {uniBusy ? '처리 중…' : '🔍 파일 선택 → 미리보기(드라이런)'}
                <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} disabled={uniBusy} onChange={onUnifiedFile} />
              </label>
              {uniPreview && (
                <button className="btn-p" disabled={uniBusy} onClick={runUnified}>
                  ✅ 이 계획대로 실행 (되돌리기 어려움)
                </button>
              )}
            </div>
            {uniPreview && (
              <div style={{ fontSize: 'var(--fs-2)', background: uniPreview.warnings.length ? '#fbf7ee' : '#eef4fb', border: `1px solid ${uniPreview.warnings.length ? '#e6d8b8' : '#cbd9e3'}`, borderRadius: 5, padding: '7px 9px', marginTop: 8, color: '#334' }}>
                <div style={{ fontWeight: 700, marginBottom: 3 }}>🔍 미리보기 (쓰기 전 — 아직 저장 안 됨)</div>
                <div>사업장: 보강 <b>{uniPreview.places.amend}</b> · 신규(단독) <b>{uniPreview.places.createStandalone}</b> · 신규(그룹) <b>{uniPreview.places.createGrouped}</b></div>
                <div>새 거래처 생성: <b>{uniPreview.entitiesNew}</b> · 그룹 <b>{uniPreview.groups.length}</b>개</div>
                <div>기장계약: 생성 <b>{uniPreview.contracts.create}</b> · 스킵 {uniPreview.contracts.skip}{uniPreview.contracts.unmatched.length > 0 && <span style={{ color: '#c60' }}> · 미매칭 {uniPreview.contracts.unmatched.length}</span>}</div>
                <div>담당자: 생성 <b>{uniPreview.contacts.create}</b> · 스킵 {uniPreview.contacts.skip} · 미매칭 {uniPreview.contacts.unmatched}</div>
                {uniPreview.warnings.length > 0 && (
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: '#a60' }}>
                    {uniPreview.warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}
                    {uniPreview.warnings.length > 8 && <li>… 외 {uniPreview.warnings.length - 8}건</li>}
                  </ul>
                )}
                {uniPreview.contracts.unmatched.length > 0 && (
                  <div style={{ marginTop: 3, color: '#a60' }}>계약 미매칭(사업자번호 없음): {uniPreview.contracts.unmatched.slice(0, 6).join(', ')}{uniPreview.contracts.unmatched.length > 6 ? ' …' : ''}</div>
                )}
              </div>
            )}
            {uniResult && (
              <div style={{ fontSize: 'var(--fs-2)', background: uniResult.failed.length ? '#fbf0ee' : '#eef7ee', border: `1px solid ${uniResult.failed.length ? '#e3cbcb' : '#cbe3cb'}`, borderRadius: 5, padding: '6px 8px', marginTop: 8, color: '#256b25' }}>
                <div>✓ 완료 — 사업장 보강 {uniResult.places.updated}·신규 {uniResult.places.created} · 거래처 신규 {uniResult.entities.created} · 기장계약 {uniResult.contracts.created}(스킵 {uniResult.contracts.skipped}·미매칭 {uniResult.contracts.unmatched}) · 담당자 {uniResult.contacts.created}(스킵 {uniResult.contacts.skipped}·미매칭 {uniResult.contacts.unmatched})
                  {uniResult.failed.length > 0 && <span style={{ color: 'var(--bad)' }}> · 실패 {uniResult.failed.length}</span>}
                </div>
                {uniResult.failed.length > 0 && (
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--bad)' }}>
                    {uniResult.failed.slice(0, 12).map((f, i) => <li key={i}><b>[{f.sheet}] {f.ref}</b>: {f.error}</li>)}
                    {uniResult.failed.length > 12 && <li>… 외 {uniResult.failed.length - 12}건</li>}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const thc: React.CSSProperties = { padding: '5px 6px', textAlign: 'left', fontWeight: 700, color: 'var(--ink-2)', whiteSpace: 'nowrap' };
const tdc: React.CSSProperties = { padding: '4px 6px', whiteSpace: 'nowrap' };
