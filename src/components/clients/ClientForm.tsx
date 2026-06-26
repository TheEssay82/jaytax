// 거래처 추가/수정 폼 — 원본 HTML editForm + doSaveClient 포팅
import { useState } from 'react';
import type { BizType, Client } from '../../types';
import { REV_YEARS } from '../../lib/constants';

/** 폼에서 만들어 부모로 넘기는 데이터 */
export interface ClientFormData {
  bizType: BizType;
  manager: string;
  companyName: string;
  tradeName: string;
  taxId: string;
  repName: string;
  bankAccount: string;
  isModel: boolean;
  /** 입력한 연도분만 머지된 매출액 (기존 값 보존은 부모/호출부에서 처리) */
  revenues: Record<string, number>;
}

interface Props {
  /** 수정 대상 (없으면 신규 추가) */
  initial?: Client;
  isAdd: boolean;
  onSubmit: (data: ClientFormData, mgrYear: number, modelYear: number) => void | Promise<void>;
  onCancel: () => void;
}

export default function ClientForm({ initial, isAdd, onSubmit, onCancel }: Props) {
  const [bizType, setBizType] = useState<BizType>(initial?.bizType ?? '법인');
  const [manager, setManager] = useState(initial?.manager ?? '');
  const [companyName, setCompanyName] = useState(initial?.companyName ?? '');
  const [tradeName, setTradeName] = useState(initial?.tradeName ?? '');
  const [taxId, setTaxId] = useState(initial?.taxId ?? '');
  const [repName, setRepName] = useState(initial?.repName ?? '');
  const [bankAccount, setBankAccount] = useState(initial?.bankAccount ?? '');
  const [isModel, setIsModel] = useState(initial?.isModel ?? false);
  const [revInputs, setRevInputs] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    REV_YEARS.forEach((y) => {
      const v = initial?.revenues?.[String(y)];
      o[String(y)] = v ? String(v) : '';
    });
    return o;
  });
  const [mgrYear, setMgrYear] = useState(String(REV_YEARS[0]));
  const [modelYear, setModelYear] = useState(String(REV_YEARS[0]));
  const [saving, setSaving] = useState(false);

  const managersEntries = Object.entries(initial?.managers || {}).sort((a, b) => Number(b[0]) - Number(a[0]));
  const modelEntries = Object.entries(initial?.modelYears || {}).sort((a, b) => Number(b[0]) - Number(a[0]));

  async function handleSave() {
    if (!companyName.trim()) {
      alert('회사명은 필수입니다.');
      return;
    }
    const revenues: Record<string, number> = {};
    REV_YEARS.forEach((y) => {
      const v = parseFloat(revInputs[String(y)]);
      if (v > 0) revenues[String(y)] = v;
    });
    const data: ClientFormData = {
      bizType,
      manager: manager.trim(),
      companyName: companyName.trim(),
      tradeName: tradeName.trim(),
      taxId: taxId.trim(),
      repName: repName.trim(),
      bankAccount: bankAccount.trim(),
      isModel,
      revenues,
    };
    setSaving(true);
    try {
      await onSubmit(data, Number(mgrYear), Number(modelYear));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ borderColor: '#1A2B52', marginTop: 8 }}>
      <div className="chdr">
        {isAdd ? '새 거래처 추가' : '거래처 수정'}: {companyName || '신규'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
        <div className="frow">
          <span className="fl">
            구분<span className="req">*</span>
          </span>
          <div className="pills">
            <span className={`pill${bizType === '법인' ? ' on' : ''}`} onClick={() => setBizType('법인')}>
              법인
            </span>
            <span className={`pill${bizType === '개인' ? ' on' : ''}`} onClick={() => setBizType('개인')}>
              개인
            </span>
          </div>
        </div>
        <div className="frow">
          <span className="fl">
            담당자<span className="req">*</span>
          </span>
          <input value={manager} onChange={(e) => setManager(e.target.value)} placeholder="담당자" />
        </div>
        <div className="frow">
          <span className="fl">
            회사명<span className="req">*</span>
          </span>
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="회사명" />
        </div>
        <div className="frow">
          <span className="fl">상호명</span>
          <input value={tradeName} onChange={(e) => setTradeName(e.target.value)} placeholder="상호명" />
        </div>
        <div className="frow">
          <span className="fl">사업자번호</span>
          <input value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="000-00-00000" />
        </div>
        <div className="frow">
          <span className="fl">대표자명</span>
          <input value={repName} onChange={(e) => setRepName(e.target.value)} placeholder="대표자명" />
        </div>
        <div className="frow">
          <span className="fl">가상계좌</span>
          <input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} placeholder="가상계좌번호" />
        </div>
        <div className="frow">
          <span className="fl">성실신고</span>
          <div className="pills">
            <span className={`pill${isModel ? ' on' : ''}`} onClick={() => setIsModel(true)}>
              O 해당
            </span>
            <span className={`pill${!isModel ? ' on' : ''}`} onClick={() => setIsModel(false)}>
              X 미해당
            </span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #EDE9E2' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 7 }}>📊 귀속연도별 매출액</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 7 }}>
          {REV_YEARS.map((y) => (
            <div key={y} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#1A2B52', whiteSpace: 'nowrap' }}>{y}년</label>
              <input
                type="number"
                value={revInputs[String(y)]}
                onChange={(e) => setRevInputs((p) => ({ ...p, [String(y)]: e.target.value }))}
                placeholder="N/A"
                style={{ flex: 1 }}
              />
            </div>
          ))}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: '#888' }}>
          ※ 여기 없는 연도는 [매출액 일괄입력]을 이용하거나 청구서 저장 시 자동 반영됩니다.
        </div>
      </div>

      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #EDE9E2' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 7 }}>
          📅 귀속연도별 담당자 / 성실신고
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label style={{ fontSize: 11, color: '#666' }}>담당자 귀속연도</label>
            <select
              value={mgrYear}
              onChange={(e) => setMgrYear(e.target.value)}
              style={{ width: '100%', padding: '4px 7px', fontSize: 12, marginTop: 3 }}
            >
              {REV_YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#666' }}>성실신고 귀속연도</label>
            <select
              value={modelYear}
              onChange={(e) => setModelYear(e.target.value)}
              style={{ width: '100%', padding: '4px 7px', fontSize: 12, marginTop: 3 }}
            >
              {REV_YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
          </div>
        </div>
        {managersEntries.length > 0 && (
          <div style={{ marginTop: 5, fontSize: 11, color: '#888' }}>
            기존 담당자: {managersEntries.map(([y, m]) => `${y}년:${m}`).join(', ')}
          </div>
        )}
        {modelEntries.length > 0 && (
          <div style={{ marginTop: 3, fontSize: 11, color: '#888' }}>
            기존 성실: {modelEntries.map(([y, v]) => `${y}년:${v ? 'O' : 'X'}`).join(', ')}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 7, marginTop: 10 }}>
        <button className="btn-p" onClick={handleSave} disabled={saving}>
          {saving ? '저장 중…' : '저장'}
        </button>
        <button className="btn-s" onClick={onCancel} disabled={saving}>
          취소
        </button>
      </div>
    </div>
  );
}
