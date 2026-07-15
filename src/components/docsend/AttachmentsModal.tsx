// 발송요청 첨부파일 모달 (조회·다운로드 + 미접수 시 추가·삭제) — 발송요청/발송요청처리 공용
import { useState } from 'react';
import {
  signedAttachmentUrl,
  uploadSendFile,
  addAttachmentRecords,
  deleteAttachment,
  ATTACH_ACCEPT,
  type SendRequest,
  type SendAttachment,
} from '../../lib/docSendApi';

export const fmtSize = (b: number): string => {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
};

export default function AttachmentsModal({
  req,
  attachments,
  shared,
  canWrite,
  onClose,
  onChanged,
}: {
  req: SendRequest;
  attachments: SendAttachment[];
  shared: boolean;
  canWrite: boolean;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  // 첨부 추가·삭제는 처리 전(미접수) 건만. 다운로드는 상태 무관 가능.
  const editable = canWrite && req.status === '미접수' && !!req.batchId;

  async function download(a: SendAttachment) {
    try {
      const url = await signedAttachmentUrl(a.storagePath, a.fileName);
      const el = document.createElement('a');
      el.href = url;
      el.target = '_blank';
      el.rel = 'noopener';
      el.click();
    } catch (e) {
      alert('다운로드 실패: ' + (e instanceof Error ? e.message : e));
    }
  }
  async function addFiles(fileList: FileList | null) {
    if (!fileList || !req.batchId) return;
    setBusy(true);
    try {
      const metas = [];
      for (const f of Array.from(fileList)) metas.push(await uploadSendFile(req.batchId, f));
      await addAttachmentRecords(req.batchId, metas);
      await onChanged();
    } catch (e) {
      alert('첨부 실패: ' + (e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(a: SendAttachment) {
    if (!confirm(`"${a.fileName}"을(를) 삭제하시겠습니까?`)) return;
    setBusy(true);
    try {
      await deleteAttachment(a);
      await onChanged();
    } catch (e) {
      alert('삭제 실패: ' + (e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, maxWidth: 640, width: '100%', maxHeight: '80vh', overflow: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #eee', position: 'sticky', top: 0, background: '#fff' }}>
          <span style={{ fontWeight: 700, color: '#1A2B52' }}>📎 첨부파일 — {req.companyName} · {req.sendKind}</span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>
        <div style={{ padding: 12 }}>
          {attachments.length === 0 ? (
            <div style={{ padding: 12, color: '#888', fontSize: 12.5 }}>
              첨부파일이 없습니다.{editable && ' 아래에서 추가할 수 있습니다.'}
            </div>
          ) : (
            <table className="tbl">
              <thead><tr><th>파일명</th><th style={{ width: 80 }}>크기</th><th style={{ width: editable ? 160 : 100 }}>관리</th></tr></thead>
              <tbody>
                {attachments.map((a) => (
                  <tr key={a.id}>
                    <td style={{ fontSize: 12 }}>📄 {a.fileName}</td>
                    <td style={{ fontSize: 11, color: '#666', whiteSpace: 'nowrap' }}>{fmtSize(a.sizeBytes)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn-sm btn-sm-blue" onClick={() => download(a)}>⬇ 다운로드</button>
                        {editable && <button className="btn-sm btn-sm-del" onClick={() => remove(a)} disabled={busy}>🗑</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {editable && (
            <label className="btn-sm btn-sm-blue" style={{ cursor: 'pointer', display: 'inline-block', marginTop: 10 }}>
              {busy ? '처리 중…' : '📎 파일 추가'}
              <input type="file" multiple accept={ATTACH_ACCEPT} style={{ display: 'none' }} disabled={busy}
                onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
            </label>
          )}
          {canWrite && req.status !== '미접수' && (
            <div style={{ marginTop: 10, fontSize: 11, color: '#8a5a00' }}>※ 처리 시작된 요청의 첨부는 변경할 수 없습니다(다운로드만 가능).</div>
          )}
          {shared && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#888' }}>※ 이 첨부는 같은 요청(문서)의 모든 수신자에게 공유됩니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}
