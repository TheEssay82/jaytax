// 주석·DSD 관리 · 일반조서 관리가 함께 쓰는 **새 작업 건** 창.
//
// 작업 건(거래처 × 사업연도 × 별도/연결)은 두 화면이 나눠 쓴다 — 주석·DSD 는 주석 목록을, 일반조서는
// 조서 워크북을 여기에 건다. 그래서 만드는 창도 하나다(2026-09-15 일반조서 착수 때 떼어 냄).
import { useEffect, useMemo, useState } from 'react';
import type { BizEntityFull } from '../../lib/bizRegistryApi';
import {
  createEngagement, findEngagement, listNotes,
  type NoteRow, type Basis, type SheetLayout,
} from '../../lib/dsdApi';
import { suggestCode, defaultAuditFy, defaultPeriod, DEFAULT_STATUS } from '../../lib/dsdNotes';
import { readDsd, type DsdInfo } from '../../lib/dsdFile';
import DateParts from '../common/DateParts';

/**
 * 새 작업 건 — **씨앗(무엇으로 주석 목록을 채울까)이 이 창의 핵심**이다.
 *
 * 빈 목록으로 만들면 결국 손으로 40줄을 넣게 된다. 첫 해에는 **작년 감사보고서 DSD** 를 넣는 것이
 * 가장 빠르고(파일에서 주석 목록이 그대로 읽힌다), 두 해째부터는 앞 해 건을 복제한다.
 */
export default function NewEngagementModal({ entities, auditIds, onClose, onDone, onError, purpose = 'dsd' }: {
  /** 어느 화면에서 여는가. 일반조서('gwp')는 주석 항목(단위·시트 구성·주석 목록)을 묻지 않는다 — 사용자 2026-09-26
   *  「첨부화면은 주석양식화면이잖아?」. 작업 건 표를 두 화면이 함께 쓰기 때문에 생긴 혼동이다. */
  purpose?: 'dsd' | 'gwp';
  entities: BizEntityFull[];
  auditIds: Set<string>;
  onClose: () => void;
  onDone: (id: string) => void | Promise<void>;
  onError: (m: string) => void;
}) {
  const [q, setQ] = useState('');
  const [auditOnly, setAuditOnly] = useState(true);
  const [entityId, setEntityId] = useState('');
  const [fy, setFy] = useState(defaultAuditFy());
  // 대상기간은 사업연도에서 따라오되 **손으로 고칠 수 있어야 한다** — 12월 결산이 아닌 회사도 있고,
  // 첫 사업연도는 기간이 짧다. 사업연도를 바꾸면 다시 그 해의 1/1~12/31 로 맞춘다.
  const [period, setPeriod] = useState(defaultPeriod(defaultAuditFy()));
  const [scope, setScope] = useState<'별도' | '연결'>('별도');
  const [basis, setBasis] = useState<Basis>('K-IFRS');
  const [moneyUnit, setMoneyUnit] = useState<'천원' | '원'>('천원');
  // 시트 구성 — 만들 때 정한다(사용자 결정 2026-09-14). 앞 해 건이 있으면 그것을 따른다.
  const [sheetLayout, setSheetLayout] = useState<SheetLayout>('sheets');
  const gwp = purpose === 'gwp';
  const [seed, setSeed] = useState<'previous' | 'file' | 'empty'>(gwp ? 'empty' : 'file');
  const [prevFound, setPrevFound] = useState<number | null>(null);
  const [dsd, setDsd] = useState<DsdInfo | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  // **이 창 안에서 말한다.** 부모 쪽 오류 카드는 이 창 뒤에 가려 보이지 않는다 —
  // 그래서 「만들기를 눌러도 아무 반응이 없다」로 보였다(2026-09-12).
  const [say, setSay] = useState<string | null>(null);
  function tell(m: string) { setSay(m); onError(m); }

  // 감사계약(회계감사)이 있는 거래처만 — 이 시스템이 다루는 대상이다.
  const hits = useMemo(() => {
    const t = q.trim();
    let base = auditOnly ? entities.filter((e) => auditIds.has(e.id)) : entities;
    if (t) base = base.filter((e) => e.name.includes(t) || (e.code ?? '').includes(t));
    return base.slice(0, 60);
  }, [entities, auditIds, auditOnly, q]);

  useEffect(() => { setPeriod(defaultPeriod(fy)); }, [fy]);

  // 앞 해 건이 있으면 복제를 기본으로 — 그게 대응표가 쌓이는 길이다.
  useEffect(() => {
    let alive = true;
    if (!entityId) { setPrevFound(null); return; }
    void findEngagement(entityId, fy - 1, scope).then(async (prev) => {
      if (!alive) return;
      if (!prev) { setPrevFound(null); return; }
      setPrevFound((await listNotes(prev.id)).length);
      if (!gwp) setSeed('previous');   // 일반조서에서 만들 때는 주석 목록을 건드리지 않는다
      setBasis(prev.basis);
      setMoneyUnit(prev.moneyUnit);
      setSheetLayout(prev.sheetLayout);
    });
    return () => { alive = false; };
  }, [entityId, fy, scope, gwp]);

  async function takeFile(f: File | undefined) {
    if (!f) return;
    setReading(true);
    try {
      const info = await readDsd(f);
      setDsd(info);
      setSeed('file');
      if (!info.notes.length) tell('이 파일에서 주석을 찾지 못했습니다. 다른 씨앗을 고르거나 나중에 채우세요.');
    } catch (e) {
      setDsd(null);
      tell(e instanceof Error ? e.message : '파일을 읽지 못했습니다.');
    } finally {
      setReading(false);
    }
  }

  /** 파일에서 읽은 주석을 목록 줄로. */
  function rowsFromFile(): NoteRow[] {
    const used = new Set<string>();
    return (dsd?.notes ?? []).map((n, i) => {
      let code = suggestCode(n.title, basis);
      while (used.has(code)) code += '_2';
      used.add(code);
      return {
        code, no: n.no, title: n.title, sheet: `N${String(n.no).padStart(2, '0')}`,
        enabled: true, source: '감사인' as const, assignee: null,
        status: DEFAULT_STATUS, memo: null, sortOrder: (i + 1) * 10,
      };
    });
  }

  async function submit() {
    setSay(null);
    if (!entityId) return tell('먼저 거래처를 고르세요 — 아래 목록에서 한 줄을 누르면 됩니다.');
    if (seed === 'file' && !dsd) return tell('작년 감사보고서(.dsd) 파일을 고르거나, 다른 씨앗을 고르세요.');
    setBusy(true);
    try {
      const id = await createEngagement({
        entityId, fy, scope, termNo: null,
        periodFrom: period.from, periodTo: period.to,
        basis, moneyUnit, seed, sheetLayout,
        seedRows: seed === 'file' ? rowsFromFile() : undefined,
      });
      await onDone(id);
    } catch (e) {
      const m = e instanceof Error ? e.message : '만들지 못했습니다.';
      tell(m.includes('duplicate') ? `같은 거래처의 FY${fy} ${scope} 건이 이미 있습니다.` : m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 400,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div className="card" style={{ maxWidth: 580, width: '100%', maxHeight: '88vh', overflowY: 'auto', marginBottom: 0 }}>
        <div className="chdr">새 작업 건{gwp && <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>일반조서 — 거래처·사업연도·재무제표 회계기준만 정합니다</span>}</div>

        <div className="frow"><span className="fl">거래처<span className="req">*</span></span>
          <div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input className="btn-sm" style={{ flex: 1, textAlign: 'left' }} placeholder="이름이나 코드로 찾기"
                value={q} onChange={(e) => setQ(e.target.value)} />
              <label style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', whiteSpace: 'nowrap' }}
                title="회계감사 계약이 있는 거래처만 봅니다">
                <input type="checkbox" checked={auditOnly} onChange={(e) => setAuditOnly(e.target.checked)} />{' '}
                감사계약만 ({auditIds.size})
              </label>
            </div>
            <select className="btn-sm" style={{ width: '100%', marginTop: 4 }} size={6}
              value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              {hits.map((e) => (
                <option key={e.id} value={e.id}>{e.code ? `${e.code} · ` : ''}{e.name}</option>
              ))}
            </select>
            {hits.length === 0 && (
              <div style={{ fontSize: 'var(--fs-1)', color: 'var(--warn)', marginTop: 3 }}>
                조건에 맞는 거래처가 없습니다. 「감사계약만」을 꺼 보세요.
              </div>
            )}
            <div style={{ fontSize: 'var(--fs-1)', marginTop: 3, color: entityId ? 'var(--good)' : 'var(--warn)' }}>
              {entityId
                ? `고른 거래처 · ${entities.find((x) => x.id === entityId)?.name ?? ''}`
                : '아직 고르지 않았습니다 — 위 목록에서 한 줄을 누르세요.'}
            </div>
          </div>
        </div>

        <div className="frow"><span className="fl">사업연도<span className="req">*</span></span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="btn-sm" style={{ width: 78 }} type="number" value={fy}
              onChange={(e) => setFy(Number(e.target.value))} />
            <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>결산일이 속한 해</span>
            <select className="btn-sm" value={scope} onChange={(e) => setScope(e.target.value as '별도' | '연결')}>
              <option>별도</option><option>연결</option>
            </select>
          </div>
        </div>

        <div className="frow"><span className="fl">대상기간<span className="req">*</span></span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <DateParts value={period.from} onChange={(val) => setPeriod((p) => ({ ...p, from: val }))} />
            <span style={{ color: 'var(--ink-3)' }}>~</span>
            <DateParts value={period.to} onChange={(val) => setPeriod((p) => ({ ...p, to: val }))} />
            <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
              12월 결산이 아니거나 첫 사업연도면 고치세요
            </span>
          </div>
        </div>

        <div className="frow"><span className="fl">{gwp ? '재무제표 회계기준' : '회계기준 · 단위'}</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <select className="btn-sm" value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
              <option>K-IFRS</option><option>일반기업회계기준</option>
            </select>
            {gwp ? (
              <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', alignSelf: 'center' }}>
                조서 기준(일반·소규모)은 만든 뒤 당기 세팅에서 정합니다
              </span>
            ) : (<>
            <select className="btn-sm" value={moneyUnit} onChange={(e) => setMoneyUnit(e.target.value as '천원' | '원')}>
              <option>천원</option><option>원</option>
            </select>
            <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', alignSelf: 'center' }}>
              원화 금액만 환산합니다
            </span>
            </>)}
          </div>
        </div>

        {!gwp && (<>
        <div className="frow" style={{ alignItems: 'start' }}><span className="fl">시트 구성</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 'var(--fs-2)' }}>
              <input type="radio" checked={sheetLayout === 'sheets'} onChange={() => setSheetLayout('sheets')} />{' '}
              <b>주석별 시트</b>
              <span style={{ color: 'var(--ink-3)' }}> — 주석마다 시트 한 장(N01, N02 …)</span>
            </label>
            <label style={{ fontSize: 'var(--fs-2)' }}>
              <input type="radio" checked={sheetLayout === 'long'} onChange={() => setSheetLayout('long')} />{' '}
              <b>한 시트 종단형</b>
              <span style={{ color: 'var(--ink-3)' }}> — 주석을 시트 한 장에 세로로 내립니다</span>
            </label>
            <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)' }}>
              ② ③ ④ 가 함께 읽습니다. ② 로 엑셀을 만든 뒤에는 바꾸지 마십시오.
            </div>
          </div>
        </div>

        <div className="frow" style={{ alignItems: 'start' }}><span className="fl">주석 목록</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label style={{ fontSize: 'var(--fs-2)' }}>
              <input type="radio" checked={seed === 'file'} onChange={() => setSeed('file')} />{' '}
              <b>작년 감사보고서(.dsd)에서 읽기</b>
              <span style={{ color: 'var(--ink-3)' }}> — 첫 해에 가장 빠릅니다</span>
              <div style={{ marginTop: 4, marginLeft: 18 }}>
                <input type="file" accept=".dsd" style={{ fontSize: 'var(--fs-1)' }}
                  onChange={(e) => void takeFile(e.target.files?.[0])} />
                {reading && <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}> 읽는 중…</span>}
                {dsd && (
                  <div style={{ fontSize: 'var(--fs-1)', color: 'var(--good)', marginTop: 3 }}>
                    {dsd.docName || 'DSD'} · 주석 <b>{dsd.notes.length}개</b>
                    {dsd.period ? ` · 이 파일은 ${dsd.period.from.slice(0, 4)}년 보고서입니다` : ''}
                    <span style={{ color: 'var(--ink-3)' }}> — 틀로만 씁니다. 대상기간은 위에서 정한 값이 들어갑니다</span>
                  </div>
                )}
                <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)', marginTop: 2 }}>
                  파일은 브라우저 안에서만 열리고 서버로 올라가지 않습니다.
                </div>
              </div>
            </label>
            <label style={{ fontSize: 'var(--fs-2)' }}>
              <input type="radio" checked={seed === 'previous'} disabled={prevFound === null}
                onChange={() => setSeed('previous')} />{' '}
              앞 해(FY{fy - 1}) 것 복제
              <span style={{ color: 'var(--ink-3)' }}>
                {prevFound === null
                  ? ` — 앱에 FY${fy - 1} 작업 건이 아직 없습니다(두 해째부터 쓸 수 있습니다)`
                  : ` — 주석 ${prevFound}개. 코드·시트·담당이 그대로 옵니다`}
              </span>
            </label>
            <label style={{ fontSize: 'var(--fs-2)' }}>
              <input type="radio" checked={seed === 'empty'} onChange={() => setSeed('empty')} />{' '}
              비워 두기
            </label>
          </div>
        </div>
        </>)}

        {say && (
          <div style={{
            marginTop: 10, padding: '8px 11px', borderRadius: 'var(--r-sm)',
            background: 'var(--bad-bg)', color: 'var(--bad)', fontSize: 'var(--fs-2)',
          }}>{say}</div>
        )}

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn-s" onClick={onClose}>그만두기</button>
          <button className="btn-p" disabled={busy} onClick={() => void submit()}>
            {busy ? '만드는 중…' : '만들기'}
          </button>
        </div>
      </div>
    </div>
  );
}
