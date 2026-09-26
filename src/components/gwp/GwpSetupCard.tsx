// 일반조서 당기 세팅 — 대화형(사용자 요구 2026-09-24 「최대한 대화형」).
//
// 화면이 차례로 묻고 사람은 고르거나 고친다:
//   ① 조서 양식 기준 — 감사계약에서 정한 값(일반↔소규모는 해마다 바뀔 수 있다)
//   ② 검토자(파트너) — 기본 조현규
//   ③ 작성자 기본값 — 감사 매출계약의 담당회계사
// 저장하는 순간이 「감사계약 값으로 확인」한 때다. 설계서 docs/일반조서/설계.md 3·5절.
import { useMemo, useState } from 'react';
import type { Engagement } from '../../lib/dsdApi';
import {
  AUDIT_BASES, AUDIT_BASIS_LABEL, basisMismatch, proposeSetup, fsBasisOf,
  type AuditBasis,
} from '../../lib/gwpSetup';
import { saveYear, type GwpYear } from '../../lib/gwpYearApi';

type Step = 'basis' | 'partner' | 'author' | 'confirm';
const ORDER: Step[] = ['basis', 'partner', 'author', 'confirm'];

const bubble = (mine: boolean): React.CSSProperties => ({
  maxWidth: '78%', padding: '8px 12px', borderRadius: 12, lineHeight: 1.65, fontSize: 'var(--fs-2)',
  background: mine ? 'var(--navy)' : 'var(--surface-2)', color: mine ? '#fff' : 'var(--ink)',
  borderBottomRightRadius: mine ? 3 : 12, borderBottomLeftRadius: mine ? 12 : 3,
});
const row = (mine: boolean): React.CSSProperties => ({ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', margin: '6px 0' });

export default function GwpSetupCard({ eng, year, prior, contractCpa, canWrite, onSaved, onCancel }: {
  eng: Engagement;
  /** 이 건의 지금 세팅(고치러 들어왔으면 있다). */
  year: GwpYear | null;
  /** 전기 건의 세팅 — 있으면 「그대로인가요」로 묻는다. */
  prior: { fy: number; year: GwpYear } | null;
  contractCpa: string | null;
  canWrite: boolean;
  onSaved: (y: GwpYear) => void;
  onCancel?: () => void;
}) {
  const proposal = useMemo(() => proposeSetup({
    prior: prior ? { auditBasis: prior.year.auditBasis, partner: prior.year.partner } : null,
    fsBasis: eng.basis, contractCpa,
  }), [prior, eng.basis, contractCpa]);

  const [step, setStep] = useState<Step>('basis');
  const [basis, setBasis] = useState<AuditBasis | null>(year?.auditBasis ?? proposal.auditBasis);
  const [partner, setPartner] = useState(year?.partner ?? proposal.partner);
  const [author, setAuthor] = useState<string>(year?.authorDefault ?? proposal.author ?? '');
  const [editing, setEditing] = useState<'partner' | 'author' | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const at = ORDER.indexOf(step);
  const go = (s: Step) => { setEditing(null); setStep(s); };

  async function save() {
    if (!basis) return;
    setBusy(true); setErr(null);
    try { onSaved(await saveYear(eng.id, { auditBasis: basis, partner, authorDefault: author || null })); }
    catch (e) { setErr(e instanceof Error ? e.message : '저장하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  const priorLabel = prior ? AUDIT_BASIS_LABEL[prior.year.auditBasis] : null;
  const changed = !!(prior && basis && prior.year.auditBasis !== basis);
  const mismatch = !!(basis && basisMismatch(basis, eng.basis));

  // ── 질문 문장 ──
  const qBasis = prior
    ? <>전기 <b>FY{prior.fy}</b> 조서는 <b>「{priorLabel}」</b> 양식이었습니다. 올해 감사계약에서 정한 조서 기준은 무엇인가요?</>
    : eng.basis === 'K-IFRS'
      ? <>재무제표가 <b>K-IFRS</b> 라 조서도 K-IFRS 로 보입니다. 맞나요?</>
      : <>전기 세팅이 없습니다. 올해 감사계약에서 정한 조서 기준은 <b>일반</b>인가요, <b>소규모</b>인가요?
          <span style={{ color: 'var(--ink-3)' }}> (재무제표는 일반기업회계기준 — 조서 기준은 따로 정합니다)</span></>;
  const qPartner = <>검토자(파트너)는 <b>{proposal.partner}</b> 님으로 둘까요?{prior && <span style={{ color: 'var(--ink-3)' }}> 전기와 같습니다.</span>}</>;
  const qAuthor = proposal.author
    ? <>작성자 기본값은 감사계약의 담당회계사 <b>{proposal.author}</b>입니다. 이대로 둘까요? <span style={{ color: 'var(--ink-3)' }}>조서마다 따로 바꿀 수 있습니다.</span></>
    : <>감사계약에서 담당회계사를 찾지 못했습니다{contractCpa ? ` (계약에는 「${contractCpa}」)` : ''}. 작성자 기본값을 적어 주세요.</>;

  const Answer = ({ children, s }: { children: React.ReactNode; s: Step }) => (
    <div style={row(true)}>
      <div style={bubble(true)}>
        {children}
        {canWrite && <button onClick={() => go(s)} style={{ marginLeft: 10, background: 'none', border: 'none', color: '#cfe0ff', cursor: 'pointer', fontSize: 'var(--fs-1)', textDecoration: 'underline' }}>고치기</button>}
      </div>
    </div>
  );
  const Ask = ({ children }: { children: React.ReactNode }) => <div style={row(false)}><div style={bubble(false)}>{children}</div></div>;

  return (
    <div className="card" style={{ border: '1px solid var(--navy)' }}>
      <div className="chdr">
        🗂️ {eng.entityName} · FY{eng.fy} 당기 세팅
        <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>
          {year ? '고치는 중' : '이월·새로 만들기 전에 한 번 정합니다'}
        </span>
        {onCancel && <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onCancel}>닫기</button>}
      </div>

      {/* ① 조서 기준 */}
      <Ask>{qBasis}</Ask>
      {step === 'basis' ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', margin: '4px 0 10px' }}>
          {AUDIT_BASES.map((b) => {
            const isPrior = prior?.year.auditBasis === b;
            const off = fsBasisOf(b) !== eng.basis;
            return (
              <button key={b} disabled={!canWrite} className={basis === b ? 'btn-p' : 'btn-s'}
                title={off ? `재무제표 회계기준(${eng.basis})과 맞지 않습니다` : undefined}
                style={{ opacity: off ? 0.55 : 1 }}
                onClick={() => { setBasis(b); go('partner'); }}>
                {isPrior ? `그대로 「${AUDIT_BASIS_LABEL[b]}」` : AUDIT_BASIS_LABEL[b]}
              </button>
            );
          })}
        </div>
      ) : basis && (
        <Answer s="basis">「{AUDIT_BASIS_LABEL[basis]}」 조서{changed && ` — 전기 「${priorLabel}」에서 바뀝니다`}</Answer>
      )}
      {at > 0 && changed && (
        <Ask>
          <span style={{ color: 'var(--warn)' }}>기준이 바뀐 해입니다.</span> 조서 구성이 달라(없어지는 조서·새로 생기는 조서) 전기 파일을 그대로 옮길 수 없습니다.
          지금은 <b>「양식으로 새로 만들기」</b>로 시작하시고, 기준 전환 이월은 다음 단계에서 붙입니다.
        </Ask>
      )}
      {at > 0 && mismatch && (
        <Ask>
          <span style={{ color: 'var(--bad)' }}>확인해 주세요 —</span> 조서는 「{basis && AUDIT_BASIS_LABEL[basis]}」인데 주석·DSD 의 재무제표 회계기준은 「{eng.basis}」입니다.
          둘 중 하나가 틀렸을 수 있습니다. 재무제표 회계기준은 주석·DSD 관리에서 고칩니다.
        </Ask>
      )}

      {/* ② 검토자 */}
      {at >= 1 && <Ask>{qPartner}</Ask>}
      {step === 'partner' ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', margin: '4px 0 10px' }}>
          {editing === 'partner' ? (
            <>
              <input value={partner} onChange={(e) => setPartner(e.target.value)} placeholder="검토자 이름" autoFocus style={{ width: 140 }}
                onKeyDown={(e) => { if (e.key === 'Enter' && partner.trim()) go('author'); }} />
              <button className="btn-p" disabled={!partner.trim()} onClick={() => go('author')}>이 사람으로</button>
            </>
          ) : (
            <>
              <button className="btn-p" disabled={!canWrite} onClick={() => { setPartner(proposal.partner); go('author'); }}>네, {proposal.partner}</button>
              <button className="btn-s" disabled={!canWrite} onClick={() => setEditing('partner')}>다른 사람</button>
            </>
          )}
        </div>
      ) : at > 1 && <Answer s="partner">검토자 {partner}</Answer>}

      {/* ③ 작성자 */}
      {at >= 2 && <Ask>{qAuthor}</Ask>}
      {step === 'author' ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', margin: '4px 0 10px' }}>
          {editing === 'author' || !proposal.author ? (
            <>
              <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="작성자 이름" autoFocus style={{ width: 140 }}
                onKeyDown={(e) => { if (e.key === 'Enter' && author.trim()) go('confirm'); }} />
              <button className="btn-p" disabled={!author.trim()} onClick={() => go('confirm')}>이 사람으로</button>
            </>
          ) : (
            <>
              <button className="btn-p" disabled={!canWrite} onClick={() => { setAuthor(proposal.author ?? ''); go('confirm'); }}>네, {proposal.author}</button>
              <button className="btn-s" disabled={!canWrite} onClick={() => setEditing('author')}>다른 사람</button>
            </>
          )}
        </div>
      ) : at > 2 && <Answer s="author">작성자 기본값 {author}</Answer>}

      {/* 확인 */}
      {step === 'confirm' && basis && (
        <>
          <Ask>
            이렇게 저장할까요? — 조서 기준 <b>{AUDIT_BASIS_LABEL[basis]}</b> · 검토자 <b>{partner}</b> · 작성자 <b>{author}</b>.
            <span style={{ color: 'var(--ink-3)' }}> 저장하면 감사계약 값으로 확인한 것으로 남고, 이월·새로 만들기가 열립니다.</span>
          </Ask>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', margin: '4px 0 4px' }}>
            <button className="btn-p" disabled={!canWrite || busy} onClick={() => void save()}>{busy ? '저장 중…' : '세팅 저장'}</button>
          </div>
        </>
      )}
      {err && <div style={{ color: 'var(--bad)', fontSize: 'var(--fs-2)', marginTop: 6 }}>{err}</div>}
    </div>
  );
}
