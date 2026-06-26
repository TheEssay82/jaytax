// 청구대상 확정 탭 — 원본 rTargets 포팅 (연도별 법인/개인 청구대상 확정)
import { useMemo, useState } from 'react';
import type { BizType, Client } from '../../types';
import { CURRENT_YEAR } from '../../lib/constants';
import { fm, getRevForYear } from '../../lib/format';
import { useClients } from '../../hooks/useClients';
import { useBillingData } from '../../hooks/useBillingData';
import { setTarget } from '../../lib/targetsApi';
import {
  getTargetIds,
  isBilled,
  isNewForYear,
  isManualLossYear,
} from '../../lib/wizardHelpers';

export default function TargetsTab() {
  const { clients, loading: clLoading } = useClients();
  const { records, targets, loading: bdLoading, refresh } = useBillingData();
  const [tYear, setTYear] = useState(CURRENT_YEAR - 1);
  const [busy, setBusy] = useState(false);

  const loading = clLoading || bdLoading;

  const years = useMemo(() => {
    const histYears = records.map((r) => Number(r.fiscalYear));
    const revYears = clients.flatMap((c) => Object.keys(c.revenues || {}).map(Number));
    const base = Array.from({ length: CURRENT_YEAR + 2 - 2020 }, (_, i) => CURRENT_YEAR + 1 - i);
    return [...new Set([...histYears, ...revYears, ...base])].filter((y) => y >= 2020).sort((a, b) => b - a);
  }, [records, clients]);

  const lawClients = clients.filter((c) => c.bizType === '법인');
  const perClients = clients.filter((c) => c.bizType === '개인');
  const selIds = getTargetIds(targets, tYear);
  const selLaw = lawClients.filter((c) => selIds.includes(c.id)).length;
  const selPer = perClients.filter((c) => selIds.includes(c.id)).length;
  const billedCnt = clients.filter((c) => isBilled(records, tYear, c.id)).length;
  const unbilledSel = selIds.length - clients.filter((c) => isBilled(records, tYear, c.id) && selIds.includes(c.id)).length;

  async function toggle(cid: string, val: boolean) {
    try {
      await setTarget(tYear, cid, val);
      await refresh();
    } catch (e) {
      alert('변경 실패: ' + (e instanceof Error ? e.message : e));
    }
  }

  async function bulk(bizType: BizType, val: boolean) {
    setBusy(true);
    try {
      await Promise.all(clients.filter((c) => c.bizType === bizType).map((c) => setTarget(tYear, c.id, val)));
      await refresh();
    } catch (e) {
      alert('일괄 변경 실패: ' + (e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="card">
        <div className="chdr">✅ 청구대상</div>
        <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>불러오는 중…</div>
      </div>
    );
  }

  function ClientRows({ list }: { list: Client[] }) {
    if (!list.length) {
      return <div style={{ padding: 12, textAlign: 'center', color: '#BBB', fontSize: 12 }}>해당 거래처 없음</div>;
    }
    return (
      <>
        {list.map((c) => {
          const sel = selIds.includes(c.id);
          const billed = isBilled(records, tYear, c.id);
          const nf = isNewForYear(records, c.id, tYear);
          const lf = isManualLossYear(clients, c.id, tYear);
          const prevRec = records.find(
            (r) => r.selClientId === c.id && String(r.fiscalYear) === String(tYear - 1),
          );
          const rv = getRevForYear(c, tYear);
          return (
            <div className={`tgt-row${lf ? ' loss-row' : ''}`} key={c.id}>
              <span className={`bdg ${nf ? 'b-new' : lf ? 'b-loss' : 'b-off'}`}>
                {nf ? '신규' : lf ? '상실' : '기존'}
              </span>
              <span className={`bdg ${c.bizType === '법인' ? 'b-law' : 'b-per'}`}>{c.bizType}</span>
              <span>
                <span style={{ fontWeight: 700 }}>{c.companyName}</span>
                <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>{c.manager}</span>
                {rv ? <span style={{ fontSize: 11, color: '#666', marginLeft: 4 }}>| 매출 {fm(rv)}원</span> : null}
              </span>
              <span style={{ fontSize: 11, color: '#999' }}>
                {prevRec ? `${fm(prevRec.grand)}원 (전년)` : '-'}
              </span>
              <span className={`bdg ${billed ? 'b-billed' : 'b-unbilled'}`}>{billed ? '✓청구완료' : '미청구'}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {sel ? (
                  <>
                    <button className="btn-sm btn-sm-navy" disabled style={{ cursor: 'default' }}>
                      ✓ 청구대상 확정
                    </button>
                    <button className="btn-sm btn-sm-del" onClick={() => toggle(c.id, false)}>
                      확정 해제
                    </button>
                  </>
                ) : (
                  <button className="btn-sm btn-sm-grn" onClick={() => toggle(c.id, true)}>
                    확정하기
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </>
    );
  }

  function Section({ title, list, bizType }: { title: string; list: Client[]; bizType: BizType }) {
    const selCnt = list.filter((c) => selIds.includes(c.id)).length;
    return (
      <div className="tgt-section">
        <div className="tgt-hdr">
          <span>
            {title} ({selCnt}/{list.length}개 확정)
          </span>
          <div style={{ display: 'flex', gap: 5 }}>
            <button className="btn-sm" onClick={() => bulk(bizType, true)} disabled={busy}>
              전체 확정
            </button>
            <button className="btn-sm" onClick={() => bulk(bizType, false)} disabled={busy}>
              전체 해제
            </button>
          </div>
        </div>
        <div className="tgt-body">
          <ClientRows list={list} />
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="chdr">
        청구대상 확정
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 7, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#666' }}>귀속연도:</span>
          <select
            style={{ padding: '4px 8px', fontSize: 12 }}
            value={tYear}
            onChange={(e) => setTYear(parseInt(e.target.value))}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 9, marginBottom: 11, flexWrap: 'wrap' }}>
        <div className="stat-card" style={{ flex: 1, minWidth: 90 }}>
          <div className="label">법인 확정</div>
          <div className="value">
            {selLaw}
            <small style={{ fontSize: 11, color: '#666' }}> / {lawClients.length}</small>
          </div>
        </div>
        <div className="stat-card" style={{ flex: 1, minWidth: 90 }}>
          <div className="label">개인 확정</div>
          <div className="value">
            {selPer}
            <small style={{ fontSize: 11, color: '#666' }}> / {perClients.length}</small>
          </div>
        </div>
        <div className="stat-card" style={{ flex: 1, minWidth: 90 }}>
          <div className="label">청구완료</div>
          <div className="value" style={{ color: '#059669' }}>
            {billedCnt}
          </div>
        </div>
        <div className="stat-card" style={{ flex: 1, minWidth: 90 }}>
          <div className="label">미청구(확정중)</div>
          <div className="value" style={{ color: '#DC2626' }}>
            {unbilledSel}
          </div>
        </div>
      </div>

      <Section title="▣ 법인" list={lawClients} bizType="법인" />
      <Section title="▣ 개인" list={perClients} bizType="개인" />
    </div>
  );
}
