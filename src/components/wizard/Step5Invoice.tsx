// Step 5: 청구서 + 저장 + 인쇄 — 원본 rStep5 + saveRec + printInv 포팅
//  청구서 본문은 InvoiceDocument(청구기록 PDF와 공용)로 분리. 저장은 saveInvoice 권한자(팀장+)만.
import { useState } from 'react';
import { useWizard } from '../../context/WizardContext';
import { useConfig } from '../../context/ConfigContext';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/roles';
import { calcS } from '../../lib/calc';
import { updateClient } from '../../lib/clientsApi';
import { createBillingRecord, updateBillingRecord } from '../../lib/billingApi';
import { clearDraft } from '../../lib/draft';
import type { BillingRecord } from '../../types';
import type { WizardStepProps } from './stepProps';
import InvoiceDocument from './InvoiceDocument';

export default function Step5Invoice({ clients, refreshClients, refreshBilling }: WizardStepProps) {
  const { S, savedMsg, setSavedMsg, resetNew, editId, clearEdit } = useWizard();
  const { config } = useConfig();
  const { role, readonly } = useAuth();
  const isFinalizer = can(role, 'finalizeInvoice'); // 확정 권한(팀장+)
  const canSave = can(role, 'saveInvoice'); // 청구서 저장 권한(팀장+). 팀원은 저장 불가(조회·PDF만)
  const canSyncClient = can(role, 'manageClients'); // 거래처 자동갱신 권한
  const [saving, setSaving] = useState(false);
  const c = calcS(S, config);

  async function saveRec() {
    if (!canSave) return; // 방어: 저장 권한 없으면 무시(버튼도 비활성)
    setSaving(true);
    try {
      // 귀속연도별 담당자 거래처 DB 반영 (거래처 관리 권한자만 — 팀원은 건너뜀)
      if (canSyncClient && S.selClientId && S.manager && S.fiscalYear) {
        const cl = clients.find((x) => x.id === S.selClientId);
        if (cl) {
          const mgrs = { ...(cl.managers || {}), [S.fiscalYear]: S.manager };
          await updateClient(S.selClientId, { managers: mgrs });
        }
      }
      const rec: BillingRecord = {
        ...S,
        ...c,
        id: editId ?? '',
        savedAt: new Date().toISOString(),
        cfgVersionId: config.cfgVersionId || 'v0',
        cfgVersionLabel: config.cfgVersionLabel || '기본',
        status: isFinalizer ? 'final' : 'draft',
      };
      if (editId) {
        await updateBillingRecord(editId, rec); // 수정: 기존 건 덮어쓰기
        clearEdit();
      } else {
        await createBillingRecord(rec); // 신규 저장
      }
      // 당기 매출액 거래처 DB 자동 갱신 (거래처 관리 권한자만)
      if (canSyncClient && S.selClientId && c.rev > 0) {
        const cl = clients.find((x) => x.id === S.selClientId);
        if (cl) {
          const revs = { ...(cl.revenues || {}), [S.fiscalYear]: c.rev };
          await updateClient(S.selClientId, { revenues: revs });
        }
      }
      if (S.selClientId) clearDraft(S.selClientId, S.fiscalYear);
      await Promise.all([refreshBilling(), refreshClients()]);
      setSavedMsg(true);
    } catch (e) {
      alert('저장 실패: ' + (e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  function newInvoice() {
    if (S.selClientId) clearDraft(S.selClientId, S.fiscalYear);
    resetNew();
  }

  return (
    <>
      <div className="no-print" style={{ display: 'flex', gap: 7, marginBottom: 9, justifyContent: 'flex-end' }}>
        <button className="btn-gold" onClick={() => window.print()}>
          🖨 인쇄/PDF
        </button>
      </div>

      {savedMsg ? (
        <>
          <button className="btn-new no-print" onClick={newInvoice}>
            ＋ 새로 작성 (다른 거래처 청구서)
          </button>
          <div className="alert-ok no-print">
            {editId
              ? '✓ 수정 저장 완료!'
              : isFinalizer
                ? '✓ 청구 확정·저장 완료!'
                : '✓ 임시저장 완료! (기장팀장 확정 대기)'}
          </div>
        </>
      ) : (
        <button className="btn-green no-print" onClick={saveRec} disabled={saving || readonly || !canSave}
          title={readonly ? '읽기 전용 계정 — 저장할 수 없습니다' : !canSave ? '청구서 저장 권한이 없습니다 (조회·PDF만 가능)' : undefined}>
          {readonly
            ? '🔒 저장 불가 (읽기전용 계정)'
            : !canSave
            ? '🔒 저장 불가 (조회·PDF만)'
            : saving
            ? '저장 중…'
            : editId
              ? `✏️ 수정 저장 (${S.fiscalYear}년 귀속${isFinalizer ? '' : ' · 작성중'})`
              : isFinalizer
                ? `💾 청구 확정 및 기록 저장 (${S.fiscalYear}년 귀속)`
                : `💾 임시저장 (작성중 — 기장팀장 확정 필요)`}
        </button>
      )}

      {/* 확정권한이 없으면 이 청구서는 '작성중'으로 저장된다(45행 status 결정과 같은 기준).
          인쇄·PDF 에도 그 사실이 찍혀야 확정 전 청구서가 확정본처럼 대외로 나가지 않는다. */}
      <InvoiceDocument S={S} config={config} draft={!isFinalizer} />
    </>
  );
}
