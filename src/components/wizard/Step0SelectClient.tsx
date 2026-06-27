// Step 0: 거래처 선택 — 원본 rStep0 + pickClient 포팅
import { useState } from 'react';
import type { Client } from '../../types';
import { useWizard } from '../../context/WizardContext';
import { fm, getRevForYear } from '../../lib/format';
import { loadDraft, hasDraft } from '../../lib/draft';
import {
  getWizardYears,
  getTargetIds,
  isNewForYear,
  clientYearStatus,
  getManagerForYear,
  isModelForYear,
  autoPayDatePatch,
} from '../../lib/wizardHelpers';
import type { WizardStepProps } from './stepProps';

type BilledFilter = 'unbilled' | 'all' | 'billed';

export default function Step0SelectClient({ clients, records, targets, profiles }: WizardStepProps) {
  const { S, setS, replaceS, setStep } = useWizard();
  const [srch, setSrch] = useState('');
  const [bz, setBz] = useState('');
  const [mg, setMg] = useState('');
  const [billedFilter, setBilledFilter] = useState<BilledFilter>('unbilled');

  const yrOpts = getWizardYears(clients, records);
  const targetIds = getTargetIds(targets, S.fiscalYear);
  const hasTargets = targetIds.length > 0;
  const managers = [...new Set(clients.map((c) => c.manager).filter(Boolean))].sort();

  let filtered = clients;
  if (srch) filtered = filtered.filter((c) => (c.companyName + c.manager + c.taxId).includes(srch));
  if (bz) filtered = filtered.filter((c) => c.bizType === bz);
  if (mg) filtered = filtered.filter((c) => c.manager === mg);

  // 거래처별 해당연도 상태 (billed/lost/pre/unbilled)
  const statusOf = (c: Client) => clientYearStatus(records, c, S.fiscalYear);

  let shown = filtered;
  if (billedFilter === 'unbilled') shown = shown.filter((c) => statusOf(c) === 'unbilled');
  else if (billedFilter === 'billed') shown = shown.filter((c) => statusOf(c) === 'billed');
  // 청구대상 확정분은 숨기지 않고 위로 우선 정렬
  if (hasTargets) {
    shown = [...shown].sort((a, b) => (targetIds.includes(b.id) ? 1 : 0) - (targetIds.includes(a.id) ? 1 : 0));
  }

  // 카운트는 전체(검색/구분 필터 후) 기준
  const unbilledCnt = filtered.filter((c) => statusOf(c) === 'unbilled').length;
  const billedCnt = filtered.filter((c) => statusOf(c) === 'billed').length;

  // 거래처 선택 (원본 pickClient)
  function pickClient(c: Client) {
    const yr = S.fiscalYear;
    const mgrName = getManagerForYear(c, yr);
    const mgrId = profiles.find((p) => p.name === mgrName)?.id ?? null;
    const draft = loadDraft(c.id, yr);
    if (draft) {
      // 임시저장 복원 + 기본정보는 DB 최신값으로 보정
      replaceS({
        ...(draft as typeof S),
        selClientId: c.id,
        fiscalYear: yr,
        companyName: c.companyName,
        tradeName: c.tradeName,
        taxId: c.taxId,
        repName: c.repName,
        manager: mgrName,
        managerId: mgrId,
        bankAccount: c.bankAccount,
      });
      setStep(draft._step || 2);
      return;
    }
    const rv = getRevForYear(c, yr);
    const base = {
      ...S,
      selClientId: c.id,
      bizType: c.bizType,
      companyName: c.companyName,
      tradeName: c.tradeName,
      taxId: c.taxId,
      repName: c.repName,
      manager: mgrName,
      managerId: mgrId,
      bankAccount: c.bankAccount,
      isModel: isModelForYear(c, yr),
      revenue: rv ? String(rv) : '',
    };
    replaceS({ ...base, ...autoPayDatePatch(base) });
    setStep(2);
  }

  function directInput() {
    setS({ selClientId: null, ...autoPayDatePatch({ ...S, selClientId: null }) });
    setStep(2);
  }

  return (
    <>
      <div className="card">
        <div className="chdr">귀속연도 선택</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {yrOpts.map((y) => (
            <span
              key={y}
              className={`yr-pill${S.fiscalYear === y ? ' on' : ''}`}
              onClick={() => setS({ fiscalYear: y })}
            >
              {y}년
            </span>
          ))}
          <span style={{ fontSize: 11, color: '#888', marginLeft: 4 }}>← 먼저 귀속연도를 선택하세요</span>
        </div>
      </div>

      <div className="card">
        <div className="chdr">
          거래처 선택
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#1A2B52', fontWeight: 700 }}>
            {S.fiscalYear}년 귀속
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 5,
            alignItems: 'center',
            marginBottom: 9,
            padding: '7px 10px',
            background: '#F5F1EB',
            borderRadius: 7,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: '#555', marginRight: 4 }}>청구 현황:</span>
          {(
            [
              ['unbilled', '📋 미청구만'],
              ['all', '전체'],
              ['billed', '✓ 청구완료'],
            ] as [BilledFilter, string][]
          ).map(([v, lbl]) => (
            <span
              key={v}
              className={`pill${billedFilter === v ? ' on' : ''}`}
              style={{ fontSize: 11 }}
              onClick={() => setBilledFilter(v)}
            >
              {lbl}
            </span>
          ))}
          <span style={{ fontSize: 11, color: '#888', marginLeft: 'auto' }}>
            미청구: {unbilledCnt}개 · 완료: {billedCnt}개
          </span>
        </div>

        {clients.length === 0 && (
          <div className="alert-w">
            등록된 거래처 없음. 거래처 관리 탭에서 추가하거나 아래 "직접 입력"으로 진행하세요.
          </div>
        )}
        {hasTargets && (
          <div className="alert-i">
            {S.fiscalYear}년 청구대상 확정 {targetIds.length}개 — 목록 상단 우선 표시 (전체 거래처도 함께 표시)
          </div>
        )}

        <div className="sbar">
          <input placeholder="🔍 거래처명·담당자 검색" value={srch} onChange={(e) => setSrch(e.target.value)} />
          <select value={bz} onChange={(e) => setBz(e.target.value)}>
            <option value="">전체 구분</option>
            <option value="법인">법인</option>
            <option value="개인">개인</option>
          </select>
          <select value={mg} onChange={(e) => setMg(e.target.value)}>
            <option value="">전체 담당자</option>
            {managers.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {shown.map((c) => {
            const status = statusOf(c);
            const nf = isNewForYear(records, c, S.fiscalYear);
            const rv = getRevForYear(c, S.fiscalYear);
            const statusBadge =
              status === 'billed'
                ? { cls: 'b-billed', txt: '✓청구완료' }
                : status === 'lost'
                  ? { cls: 'b-loss', txt: '상실(거래종료)' }
                  : status === 'pre'
                    ? { cls: 'b-off', txt: '거래전' }
                    : { cls: 'b-unbilled', txt: '미청구' };
            return (
              <div
                key={c.id}
                className={`cl-row${S.selClientId === c.id ? ' selected' : ''}`}
                onClick={() => pickClient(c)}
              >
                <span className={`bdg ${c.bizType === '법인' ? 'b-law' : 'b-per'}`}>{c.bizType}</span>
                <div>
                  <div className="cl-name">{c.companyName}</div>
                  <div className="cl-sub">
                    {c.manager} | {c.taxId} {rv ? `| 매출: ${fm(rv)}원` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                  {nf && status !== 'pre' && <span className="bdg b-new">신규</span>}
                  {hasDraft(c.id, S.fiscalYear) && <span className="bdg-draft">✏️ 작성중</span>}
                </div>
                <span className={`bdg ${statusBadge.cls}`}>{statusBadge.txt}</span>
              </div>
            );
          })}
          {!shown.length && <div style={{ textAlign: 'center', padding: 24, color: '#BBB' }}>검색 결과 없음</div>}
        </div>

        <div
          style={{
            marginTop: 9,
            paddingTop: 9,
            borderTop: '1px solid #EDE9E2',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button className="btn-s" onClick={directInput} style={{ fontSize: 12 }}>
            직접 입력 (DB 없이) →
          </button>
        </div>
      </div>
    </>
  );
}
