// 상담진행 — 질문 → consult Edge(회계기준 RAG + 세법 조문 자동근거 + Claude 회신) → 검토·편집 → 상담기록 저장.
//  분야(회계/세무/공통)로 근거 조회 범위를 정하고, '형식을 갖춘 질문'을 켜면 규격 필드로 입력한다.
//  최종 판단·서명은 담당 회계사·세무사가 한다(근거 밖은 [확인 불가]).
import { useState } from 'react';
import {
  runConsult,
  createConsultation,
  modelLabel,
  CONSULT_MODELS,
  DEFAULT_CONSULT_MODEL,
  type Citation,
  type LawRef,
} from '../../lib/consultApi';
import LawRefPicker from './LawRefPicker';
import { TagEditor } from './TagsField';

type Domain = '공통' | '회계' | '세무';
type Target = '공통' | '법인' | '개인';

export default function ConsultTab() {
  const [question, setQuestion] = useState('');
  const [title, setTitle] = useState('');
  const [domain, setDomain] = useState<Domain>('공통');
  const [standardNo, setStandardNo] = useState(''); // 회계 분야에서만 사용
  const [matchCount, setMatchCount] = useState(6);
  const [selModel, setSelModel] = useState<string>(DEFAULT_CONSULT_MODEL);
  const [includePrec, setIncludePrec] = useState(true); // 판례 자동참조 (세무·공통 기본 ON)
  const [includeTaxLaw, setIncludeTaxLaw] = useState(true); // 세법 조문 자동근거 (기본 ON)
  const [lawRefs, setLawRefs] = useState<LawRef[]>([]);
  const [showLaw, setShowLaw] = useState(false);

  // 형식을 갖춘 질문 (규격 필드)
  const [structured, setStructured] = useState(false);
  const [target, setTarget] = useState<Target>('공통');
  const [assumptions, setAssumptions] = useState('');
  const [selfReview, setSelfReview] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 생성 결과 (편집 가능)
  const [answer, setAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [submittedQuestion, setSubmittedQuestion] = useState('');

  // 저장 상태
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copyOk, setCopyOk] = useState(false);

  // 분야가 회계가 아니면 근거기준서 한정은 의미 없음 → 전체로 되돌림
  function changeDomain(d: Domain) {
    setDomain(d);
    if (d !== '회계') setStandardNo('');
    // 회계 전용이면 판례 자동참조는 기본 끔(세무·공통은 켬)
    setIncludePrec(d !== '회계');
  }

  // 규격 필드 → 하나의 질문 문자열로 결합(형식 모드일 때).
  function buildQuestion(): string {
    if (!structured) return question.trim();
    const parts: string[] = [`[분야] ${domain}`, `[대상] ${target}`];
    if (assumptions.trim()) parts.push(`[가정]\n${assumptions.trim()}`);
    parts.push(`[질문]\n${question.trim()}`);
    if (selfReview.trim()) parts.push(`[자체 검토 내용]\n${selfReview.trim()}`);
    return parts.join('\n\n');
  }

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    const q = buildQuestion();
    if (!question.trim() || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await runConsult(q, { standardNo, matchCount, lawRefs, model: selModel, includePrecedents: includePrec, includeTaxLaw, domain });
      setAnswer(res.answer_md);
      setCitations(res.citations);
      setTags(res.tags);
      setModel(res.model);
      setSubmittedQuestion(q);
      if (!title.trim()) setTitle(deriveTitle(res.answer_md, question));
    } catch (err) {
      setError(err instanceof Error ? err.message : '회신 초안 작성 중 오류가 발생했습니다.');
      setAnswer(null);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (answer === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      await createConsultation({
        title: title.trim() || '(제목 없음)',
        question: submittedQuestion || question.trim(),
        answerMd: answer,
        citations,
        tags,
        llmModel: model || null,
        status: 'draft',
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function copyAnswer() {
    if (answer === null) return;
    try {
      await navigator.clipboard.writeText(answer);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 1500);
    } catch {
      /* 클립보드 권한 없음 — 무시 */
    }
  }

  function reset() {
    setQuestion('');
    setTitle('');
    setAnswer(null);
    setCitations([]);
    setTags([]);
    setModel('');
    setSubmittedQuestion('');
    setError(null);
    setSaved(false);
    setLawRefs([]);
    setShowLaw(false);
    setIncludeTaxLaw(true);
    setIncludePrec(true);
    setStructured(false);
    setDomain('공통');
    setStandardNo('');
    setTarget('공통');
    setAssumptions('');
    setSelfReview('');
  }

  return (
    <div className="card">
      <div className="chdr">🧑‍💼 상담진행</div>

      <form onSubmit={generate}>
        {/* 형식 모드 토글 */}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 12.5, color: '#4b5563', cursor: 'pointer' }}>
          <input type="checkbox" checked={structured} onChange={(e) => setStructured(e.target.checked)} />
          🧩 형식을 갖춘 질문 <span style={{ color: '#9aa0ad' }}>(대상·가정·자체검토를 규격 필드로 입력)</span>
        </label>

        {structured && (
          <div className="frow" style={{ gridTemplateColumns: '1fr' }}>
            <label className="fl">가정 (선택 — 사실관계 전제)</label>
            <textarea
              value={assumptions}
              onChange={(e) => setAssumptions(e.target.value)}
              placeholder="예: 개인사업자(부동산임대업), 간이과세 아님. 2025년 귀속. 세금계산서 수취 완료 가정."
              rows={2}
              style={{ resize: 'vertical', lineHeight: 1.6 }}
            />
          </div>
        )}

        <div className="frow" style={{ gridTemplateColumns: '1fr' }}>
          <label className="fl">질문 · 사실관계</label>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="예: 고객사가 2년 라이선스를 선결제로 받았습니다. 기간에 걸쳐 인식해야 하나요, 한 시점에 인식해야 하나요? 관련 가정과 함께 회신이 필요합니다."
            rows={5}
            style={{ resize: 'vertical', lineHeight: 1.6 }}
            autoFocus
          />
        </div>

        {structured && (
          <div className="frow" style={{ gridTemplateColumns: '1fr' }}>
            <label className="fl">자체 검토 내용 (선택 — 담당자가 이미 검토한 의견/쟁점)</label>
            <textarea
              value={selfReview}
              onChange={(e) => setSelfReview(e.target.value)}
              placeholder="예: 소득세법 제27조 통상성 요건이 쟁점으로 보임. 조심례 유무가 궁금."
              rows={2}
              style={{ resize: 'vertical', lineHeight: 1.6 }}
            />
          </div>
        )}

        {/* 컨트롤 행 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
          <div style={{ flex: '2 1 200px' }}>
            <label className="fl">제목 (선택 — 비우면 자동)</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="쟁점 한 줄" />
          </div>
          <div style={{ flex: '0 1 120px' }}>
            <label className="fl">분야</label>
            <select value={domain} onChange={(e) => changeDomain(e.target.value as Domain)}>
              <option value="공통">회계·세무 공통</option>
              <option value="회계">회계</option>
              <option value="세무">세무</option>
            </select>
          </div>
          {structured && (
            <div style={{ flex: '0 1 110px' }}>
              <label className="fl">대상</label>
              <select value={target} onChange={(e) => setTarget(e.target.value as Target)}>
                <option value="공통">공통</option>
                <option value="법인">법인</option>
                <option value="개인">개인</option>
              </select>
            </div>
          )}
          {domain === '회계' && (
            <div style={{ flex: '0 1 190px' }}>
              <label className="fl">근거 기준서</label>
              <select value={standardNo} onChange={(e) => setStandardNo(e.target.value)}>
                <option value="">전체 기준서 (원문 61종)</option>
                <option value="1115">K-IFRS 제1115호 (수익)</option>
                <option value="1116">K-IFRS 제1116호 (리스)</option>
                <option value="1109">K-IFRS 제1109호 (금융상품)</option>
              </select>
            </div>
          )}
          <div style={{ flex: '0 1 90px' }}>
            <label className="fl">근거 수</label>
            <select value={matchCount} onChange={(e) => setMatchCount(Number(e.target.value))}>
              {[4, 6, 8, 10].map((n) => (
                <option key={n} value={n}>{n}개</option>
              ))}
            </select>
          </div>
          <div style={{ flex: '1 1 180px' }}>
            <label className="fl">작성 모델</label>
            <select value={selModel} onChange={(e) => setSelModel(e.target.value)}>
              {CONSULT_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
          <button className="btn-p" type="submit" disabled={busy || !question.trim()} style={{ flex: '0 0 auto' }}>
            {busy ? '작성 중…' : '✍️ 회신 초안 작성'}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {domain !== '회계' && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#4b5563', cursor: 'pointer' }}>
              <input type="checkbox" checked={includeTaxLaw} onChange={(e) => setIncludeTaxLaw(e.target.checked)} />
              ⚖️ 세법 조문 자동근거 <span style={{ color: '#9aa0ad' }}>(질문에서 관련 세법을 찾아 법제처 조문 원문·시행일을 근거에 자동 추가)</span>
            </label>
          )}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#4b5563', cursor: 'pointer' }}>
            <input type="checkbox" checked={includePrec} onChange={(e) => setIncludePrec(e.target.checked)} />
            🏛️ 관련 판례 자동 참조 <span style={{ color: '#9aa0ad' }}>(세무 쟁점 시 — 법제처 판례 전문을 근거에 추가, 다소 느려짐)</span>
          </label>
        </div>
      </form>

      {/* 세법 조문 직접 첨부 (선택) — 자동근거 외 특정 조문 추가 */}
      <div style={{ marginTop: 12 }}>
        <button type="button" className="btn-sm" onClick={() => setShowLaw((v) => !v)} aria-expanded={showLaw}>
          {showLaw ? '▾' : '▸'} ⚖️ 세법 조문 직접 첨부 (선택 · 자동근거 외 특정 조문 추가){lawRefs.length > 0 && ` · ${lawRefs.length}건`}
        </button>
        {showLaw && (
          <div style={{ marginTop: 8 }}>
            <LawRefPicker value={lawRefs} onChange={setLawRefs} />
          </div>
        )}
      </div>

      {error && <div className="alert-w" style={{ marginTop: 14 }}>{error}</div>}

      {answer === null && !error && (
        <div className="alert-i" style={{ marginTop: 14, lineHeight: 1.7 }}>
          질문을 입력하면 분야에 따라 <b>회계기준(원문·요지)</b>과 <b>세법 조문(법제처 원문)</b>을 근거로 검색해 이메일 회신 초안을 작성합니다.
          초안은 검토·편집 후 <b>상담기록</b>에 저장할 수 있습니다.
          근거에 없는 내용은 본문에 <b>[확인 불가]</b>로 표기되며, 최종 판단·서명은 담당 회계사·세무사가 합니다.
        </div>
      )}

      {answer !== null && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1A2B52' }}>회신 초안</span>
            {model && <span className="bdg" style={{ fontSize: 10, color: '#6b7280' }} title={model}>{modelLabel(model)}</span>}
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
              <button type="button" className="btn-sm" onClick={copyAnswer}>
                {copyOk ? '복사됨 ✓' : '📋 복사'}
              </button>
              <button type="button" className="btn-sm" onClick={reset}>새 상담</button>
              <button type="button" className="btn-p btn-sm" onClick={save} disabled={saving || saved}>
                {saved ? '저장됨 ✓' : saving ? '저장 중…' : '💾 상담기록 저장'}
              </button>
            </span>
          </div>

          <textarea
            value={answer}
            onChange={(e) => { setAnswer(e.target.value); setSaved(false); }}
            rows={22}
            style={{
              width: '100%', resize: 'vertical', lineHeight: 1.65, fontSize: 13.5,
              fontFamily: 'inherit', whiteSpace: 'pre-wrap',
            }}
          />

          <div style={{ marginTop: 10 }}>
            <label className="fl" style={{ display: 'block', marginBottom: 4 }}>
              키워드 해시태그 <span style={{ fontWeight: 400, color: '#9aa0ad' }}>(자동 추출 · 저장 전 편집 가능)</span>
            </label>
            <TagEditor value={tags} onChange={(t) => { setTags(t); setSaved(false); }} />
          </div>

          {saved && (
            <div className="alert-i" style={{ marginTop: 8 }}>
              상담기록에 저장됐습니다. <b>상담기록</b> 메뉴에서 조회·수정할 수 있습니다.
            </div>
          )}

          {citations.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1A2B52', marginBottom: 8 }}>
                근거 ({citations.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {citations.map((c, i) => (
                  <div key={i} style={citeStyle}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                      <span className="bdg" style={{ fontSize: 10, color: c.type === '세법' ? '#1A2B52' : '#8a5a00' }}>
                        {c.type}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#1A2B52' }}>{c.ref}</span>
                    </div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.6, color: '#4b5563', whiteSpace: 'pre-wrap' }}>
                      {c.text}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#9aa0ad', marginTop: 8, lineHeight: 1.6 }}>
                회계기준 요지는 정리본입니다. 인용·적용 전 원문 대조를 권고하며, 최종 판단·서명은 담당 회계사·세무사가 합니다.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 회신 초안에서 제목 추출: 첫 줄의 "제목:" 또는 "# ..." 헤더, 없으면 질문 앞부분. */
function deriveTitle(answerMd: string, question: string): string {
  const firstLine = answerMd.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  const m = firstLine.match(/^제목\s*[:：]\s*(.+)$/);
  if (m) return m[1].trim().slice(0, 120);
  if (firstLine.startsWith('#')) return firstLine.replace(/^#+\s*/, '').slice(0, 120);
  if (firstLine.startsWith('[')) return firstLine.slice(0, 120);
  return question.replace(/\s+/g, ' ').trim().slice(0, 60);
}

const citeStyle: React.CSSProperties = {
  border: '1px solid #e4e0d8', borderRadius: 8, padding: '10px 12px', background: '#fffdf6',
};
