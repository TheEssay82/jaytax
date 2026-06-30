// 상담진행 — 질문 → consult Edge(회계기준 RAG 근거 + Claude 회신 초안) → 검토·편집 → 상담기록 저장.
//  회신 초안은 요지 정리본 근거 기반이며, 최종 판단·서명은 담당 회계사·세무사가 한다(근거 밖은 [확인 불가]).
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

export default function ConsultTab() {
  const [question, setQuestion] = useState('');
  const [title, setTitle] = useState('');
  const [standardNo, setStandardNo] = useState('1115');
  const [matchCount, setMatchCount] = useState(6);
  const [selModel, setSelModel] = useState<string>(DEFAULT_CONSULT_MODEL);
  const [lawRefs, setLawRefs] = useState<LawRef[]>([]);
  const [showLaw, setShowLaw] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 생성 결과 (편집 가능)
  const [answer, setAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [model, setModel] = useState('');

  // 저장 상태
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copyOk, setCopyOk] = useState(false);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await runConsult(q, { standardNo: standardNo || undefined, matchCount, lawRefs, model: selModel });
      setAnswer(res.answer_md);
      setCitations(res.citations);
      setTags(res.tags);
      setModel(res.model);
      if (!title.trim()) setTitle(deriveTitle(res.answer_md, q));
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
        question: question.trim(),
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
    setError(null);
    setSaved(false);
    setLawRefs([]);
    setShowLaw(false);
  }

  return (
    <div className="card">
      <div className="chdr">🧑‍💼 상담진행</div>

      <form onSubmit={generate}>
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

        <div className="frow" style={{ gridTemplateColumns: '1.7fr 1.1fr 0.8fr 1.4fr auto', alignItems: 'end', gap: 10 }}>
          <div>
            <label className="fl">제목 (선택 — 비우면 자동)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="쟁점 한 줄"
            />
          </div>
          <div>
            <label className="fl">근거 기준서</label>
            <select value={standardNo} onChange={(e) => setStandardNo(e.target.value)}>
              <option value="1115">K-IFRS 제1115호 (수익)</option>
              <option value="">전체 (적재된 기준서)</option>
            </select>
          </div>
          <div>
            <label className="fl">근거 수</label>
            <select value={matchCount} onChange={(e) => setMatchCount(Number(e.target.value))}>
              {[4, 6, 8, 10].map((n) => (
                <option key={n} value={n}>{n}개</option>
              ))}
            </select>
          </div>
          <div>
            <label className="fl">작성 모델</label>
            <select value={selModel} onChange={(e) => setSelModel(e.target.value)}>
              {CONSULT_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
          <button className="btn-p" type="submit" disabled={busy || !question.trim()}>
            {busy ? '작성 중…' : '✍️ 회신 초안 작성'}
          </button>
        </div>
      </form>

      {/* 세법 조문 근거 첨부 (선택) — 세무 쟁점일 때 원문 조문을 근거로 추가 */}
      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn-sm"
          onClick={() => setShowLaw((v) => !v)}
          aria-expanded={showLaw}
        >
          {showLaw ? '▾' : '▸'} ⚖️ 세법 조문 근거 첨부 (선택){lawRefs.length > 0 && ` · ${lawRefs.length}건`}
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
          질문을 입력하면 회계기준(요지 정리본) 근거를 검색해 이메일 회신 초안을 작성합니다.
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
              <button
                type="button"
                className="btn-p btn-sm"
                onClick={save}
                disabled={saving || saved}
              >
                {saved ? '저장됨 ✓' : saving ? '저장 중…' : '💾 상담기록 저장'}
              </button>
            </span>
          </div>

          <textarea
            value={answer}
            onChange={(e) => { setAnswer(e.target.value); setSaved(false); }}
            rows={18}
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
                회계기준 근거는 요지 정리본입니다. 인용·적용 전 원문 대조를 권고하며, 최종 판단·서명은 담당 회계사·세무사가 합니다.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 회신 초안에서 제목 추출: 첫 줄의 "제목:" 또는 "[...]" 헤더, 없으면 질문 앞부분. */
function deriveTitle(answerMd: string, question: string): string {
  const firstLine = answerMd.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  const m = firstLine.match(/^제목\s*[:：]\s*(.+)$/);
  if (m) return m[1].trim().slice(0, 120);
  if (firstLine.startsWith('[')) return firstLine.slice(0, 120);
  return question.replace(/\s+/g, ' ').trim().slice(0, 60);
}

const citeStyle: React.CSSProperties = {
  border: '1px solid #e4e0d8', borderRadius: 8, padding: '10px 12px', background: '#fffdf6',
};
