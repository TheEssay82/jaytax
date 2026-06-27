// Step 5: 청구서 + 저장 + 인쇄 — 원본 rStep5 + saveRec + printInv 포팅
import { useState } from 'react';
import { useWizard } from '../../context/WizardContext';
import { useConfig } from '../../context/ConfigContext';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/roles';
import { calcS, won, pct, dt } from '../../lib/calc';
import { updateClient } from '../../lib/clientsApi';
import { createBillingRecord } from '../../lib/billingApi';
import { clearDraft } from '../../lib/draft';
import type { BillingRecord } from '../../types';
import type { WizardStepProps } from './stepProps';

export default function Step5Invoice({ clients, refreshClients, refreshBilling }: WizardStepProps) {
  const { S, savedMsg, setSavedMsg, resetNew } = useWizard();
  const { config } = useConfig();
  const { role } = useAuth();
  const canFinalize = can(role, 'finalizeInvoice');
  const [saving, setSaving] = useState(false);
  const c = calcS(S, config);
  const yr = S.fiscalYear;
  const taxType = S.bizType === '법인' ? '법인세' : '종합소득세';
  const payStr = S.payMonth ? `${S.payMonth}월 ${S.payDay}일` : S.payDay ? `${S.payDay}일` : '';

  async function saveRec() {
    setSaving(true);
    try {
      // 귀속연도별 담당자 거래처 DB 반영
      if (S.selClientId && S.manager && S.fiscalYear) {
        const cl = clients.find((x) => x.id === S.selClientId);
        if (cl) {
          const mgrs = { ...(cl.managers || {}), [S.fiscalYear]: S.manager };
          await updateClient(S.selClientId, { managers: mgrs });
        }
      }
      const rec: BillingRecord = {
        ...S,
        ...c,
        id: '',
        savedAt: new Date().toISOString(),
        cfgVersionId: config.cfgVersionId || 'v0',
        cfgVersionLabel: config.cfgVersionLabel || '기본',
      };
      await createBillingRecord(rec);
      // 당기 매출액 거래처 DB 자동 갱신
      if (S.selClientId && c.rev > 0) {
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
          <div className="alert-ok no-print">✓ 기록 저장 완료!</div>
        </>
      ) : canFinalize ? (
        <button className="btn-green no-print" onClick={saveRec} disabled={saving}>
          {saving ? '저장 중…' : `💾 청구 확정 및 기록 저장 (${S.fiscalYear}년 귀속)`}
        </button>
      ) : (
        <div className="alert-w no-print">
          🔒 기장팀원은 청구서를 <strong>최종 저장(확정)</strong>할 수 없습니다. 기장팀장 이상이 확정합니다.
          (작성·인쇄는 가능)
        </div>
      )}

      <div className="inv" id="inv-body">
        <div className="inv-title">청 구 서</div>
        <div className="inv-addr">
          인덕회계법인 | 서울시 영등포구 국회대로70길19 대하빌딩 6층 609호(07238) | 02-782-9960
        </div>
        <div style={{ marginBottom: 11 }}>
          <div className="imrow">
            <span className="iml">회사명</span>
            <span>: {S.companyName || '(미입력)'}</span>
          </div>
          <div className="imrow">
            <span className="iml">발송일</span>
            <span>: {dt(S.issuedDate)}</span>
          </div>
          <div className="imrow">
            <span className="iml">수신</span>
            <span>: {S.repName || '(미입력)'} 대표님</span>
          </div>
          <div className="imrow">
            <span className="iml">제목</span>
            <span>: {yr}년 귀속 결산 및 세무조정</span>
          </div>
        </div>
        <div className="inv-body">
          &nbsp;&nbsp;1. {S.bizType === '법인' ? '귀사' : '귀하'}의 사업이 무한히 번성하시기를 기원드립니다.
          <br />
          &nbsp;&nbsp;2. 지난 <strong>{yr}년</strong> 귀속 <strong>{taxType}</strong> 신고를 무사히 종료할 수
          있도록 협조해 주신 점 깊이 감사드립니다. 아래의 산출근거와 같이 결산 및 조정수수료를 청구하오니 궁금하신
          부분 언제든지 문의주시기 바라며,{payStr ? <strong> {payStr}</strong> : ''}까지 송금하여 주실 것을
          부탁드립니다.
        </div>
        <strong style={{ fontSize: 12 }}>▣ 결산 및 조정수수료 산출 근거</strong>
        <table className="itbl">
          <tbody>
            <tr className="ihdr">
              <td colSpan={5}>구 분</td>
              <td>
                {yr}년 귀속
                <br />
                결산 및 신고조정수수료
              </td>
              <td>비 고</td>
            </tr>
            <tr>
              <td colSpan={5}>매 출 액 (수 입 금 액)</td>
              <td className="ir">{won(c.rev)}</td>
              <td className="ic">(사업장이 여러 곳인 경우 가장 큰 사업장 기준)</td>
            </tr>
            <tr>
              <td rowSpan={14} className="ic-v" style={{ width: 20 }}>
                산 출 내 역
              </td>
              <td colSpan={2}>① 기본보수</td>
              <td colSpan={2}></td>
              <td className="ir">{won(c.baseFee)}</td>
              <td className="ic"></td>
            </tr>
            <tr>
              <td colSpan={2}>② 규모가산 (매출액)</td>
              <td colSpan={2}></td>
              <td className="ir">{won(c.scale)}</td>
              <td className="ic"></td>
            </tr>
            <tr className="itotA">
              <td colSpan={2}>A) 기본업무보수</td>
              <td colSpan={2}></td>
              <td className="ir">{won(c.A)}</td>
              <td className="ic"></td>
            </tr>
            <tr>
              <td colSpan={2}>③ 성실신고수수료</td>
              <td colSpan={2}></td>
              <td className="ir">{won(c.modelFee)}</td>
              <td className="ic">{c.modelFee ? '' : '해당사항없음'}</td>
            </tr>
            <tr>
              <td colSpan={2}>④ 기장 및 결산업무</td>
              <td className="ic">{pct(c.r4)}</td>
              <td></td>
              <td className="ir">{won(c.f4)}</td>
              <td className="ic">기본기장업무 외의 결산업무가 추가되는 경우</td>
            </tr>
            <tr>
              <td colSpan={2}>⑤ 원가계산 업무</td>
              <td className="ic">{pct(c.r5)}</td>
              <td></td>
              <td className="ir">{won(c.f5)}</td>
              <td className="ic">제조원가 및 용역원가 별도작성시 가산</td>
            </tr>
            <tr>
              <td colSpan={2}>⑥ 세무검토 및 기타 자문업무</td>
              <td className="ic">{pct(c.r6)}</td>
              <td></td>
              <td className="ir">{won(c.f6)}</td>
              <td className="ic">세무조정검토 및 기타 자문업무 수행시 가산</td>
            </tr>
            <tr className="itotB">
              <td colSpan={2}>B) 추가업무보수</td>
              <td colSpan={2}></td>
              <td className="ir">{won(c.Btot)}</td>
              <td className="ic"></td>
            </tr>
            <tr>
              <td colSpan={2}>⑦ 증빙서류 발급 등의 업무</td>
              <td colSpan={2}>{S.otherContent || ''}</td>
              <td className="ir">{won(c.f7)}</td>
              <td className="ic">증빙서 발급 및 기타 제반사정 가감</td>
            </tr>
            <tr className="itotC">
              <td colSpan={2}>C) 보수총계 (A+B+⑦)</td>
              <td colSpan={2}></td>
              <td className="ir">{won(c.C)}</td>
              <td className="ic">천원이하 단위 절사</td>
            </tr>
            <tr>
              <td colSpan={2}>⑧ 할인금액</td>
              <td colSpan={2}></td>
              <td className="ir">{c.disc ? '- ' + won(c.disc) : '0원'}</td>
              <td className="ic">{S.discContent || ''}</td>
            </tr>
            <tr>
              <td colSpan={2}>⑨ 협의조정금액</td>
              <td colSpan={2}></td>
              <td className="ir">{c.penFee ? '- ' + won(c.penFee) : '0원'}</td>
              <td className="ic">{S.penaltyContent || ''}</td>
            </tr>
            <tr className="itotD">
              <td colSpan={2}>D) 총 보수 합계 (C-⑧-⑨)</td>
              <td colSpan={2}></td>
              <td className="ir">{won(c.D)}</td>
              <td className="ic"></td>
            </tr>
            <tr>
              <td colSpan={2}>⑩ 부가가치세 (VAT)</td>
              <td className="ic">10%</td>
              <td></td>
              <td className="ir">{won(c.VAT)}</td>
              <td className="ic"></td>
            </tr>
            <tr className="igrand">
              <td colSpan={5}>청 구 금 액</td>
              <td className="ir">{won(c.grand)}</td>
              <td className="ic">(VAT 포함)</td>
            </tr>
          </tbody>
        </table>
        <div className="inv-sign">인덕회계법인 &nbsp; 정우철 · 송현주 회계사 드림</div>
        <div className="inv-bank">
          <p>■ 입금계좌 : 신한은행 [ {S.bankAccount || ' '.repeat(16)} ] &nbsp;&nbsp; 예금주: 인덕회계법인</p>
          <p style={{ marginTop: 3, fontSize: 10, color: '#666' }}>
            ■ {S.bizType === '법인' ? '법인세 및 지방소득세' : '종합소득세 및 지방소득세'}는 납부서에 명기된
            날짜까지 가까운 은행 또는 우체국에 납부하시기 바랍니다.
          </p>
        </div>
      </div>
    </>
  );
}
