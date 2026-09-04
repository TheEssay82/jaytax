// 습작 관리 (/essay/admin) — 메뉴에 노출하지 않는 숨김 URL. 로그인 + 최고관리자만 동작한다(RLS).
// 업로드는 '제목 + Word 파일'만 받고, 변환된 본문을 미리보기로 보여준 뒤 확정해야 등록된다.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  bgUrl,
  createPiece,
  deletePiece,
  docxToParagraphs,
  listPieces,
  listRankings,
  listReaders,
  looksLikeTitle,
  resetEvaluations,
  updatePiece,
  uploadBg,
  type EssayPiece,
  type RankRow,
  type ReaderRow,
} from '../../lib/essayApi';
import EssayPaper from './EssayPaper';
import RankingStats from './RankingStats';
import { ALL_THEMES, FONTS, THEMES } from './essayTheme';

type Mode = { kind: 'list' } | { kind: 'preview' } | { kind: 'edit'; piece: EssayPiece };

const PUBLIC_PATH = '/essay';

export default function EssayAdmin() {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [pieces, setPieces] = useState<EssayPiece[]>([]);
  const [rankings, setRankings] = useState<RankRow[]>([]);
  const [readers, setReaders] = useState<ReaderRow[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // 작성 중인 초안(업로드 → 미리보기 → 확정)
  const [title, setTitle] = useState('');
  const [paras, setParas] = useState<string[]>([]);
  /** Word 문서 첫 줄이 제목이면 본문에서 뺀다(제목이 두 번 보이는 것 방지) */
  const [dropFirst, setDropFirst] = useState(false);
  const [fileName, setFileName] = useState('');
  const [bgKey, setBgKey] = useState(THEMES[0].key);
  const [fontKey, setFontKey] = useState(FONTS[0].key);
  const [bgPath, setBgPath] = useState<string | null>(null);
  /** 확정 시 바로 공개할지. 기본은 비공개 — 원고를 미리 올려두고 공개일에 한꺼번에 열기 위함 */
  const [publishNow, setPublishNow] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bgRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      const [ps, rk, rd] = await Promise.all([listPieces(), listRankings(), listReaders()]);
      setPieces(ps);
      setRankings(rk);
      setReaders(rd);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const publishedCount = pieces.filter((p) => p.status === 'published').length;
  const submittedCount = readers.filter((r) => r.submittedAt).length;
  /** 화면·저장에 쓰는 최종 본문 */
  const body = (dropFirst ? paras.slice(1) : paras).join('\n\n');

  function resetDraft() {
    setTitle('');
    setParas([]);
    setDropFirst(false);
    setFileName('');
    setBgPath(null);
    setBgKey(THEMES[0].key);
    setFontKey(FONTS[0].key);
    if (fileRef.current) fileRef.current.value = '';
    if (bgRef.current) bgRef.current.value = '';
  }

  async function pickDocx(f: File | null) {
    if (!f) return;
    setErr('');
    setBusy(true);
    try {
      const lines = await docxToParagraphs(f);
      if (lines.length === 0) throw new Error('본문을 읽지 못했습니다 — 내용이 있는 .docx 파일인지 확인해 주세요.');
      setParas(lines);
      setFileName(f.name);
      // 문서 첫 줄이 제목처럼 보이면 그것을 제목으로 올리고 본문에서 뺀다(미리보기에서 되돌릴 수 있음)
      const headline = looksLikeTitle(lines[0]) && lines.length > 1;
      setDropFirst(headline);
      if (!title.trim()) setTitle(headline ? lines[0] : f.name.replace(/\.docx?$/i, ''));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function pickBg(f: File | null) {
    if (!f) return;
    setErr('');
    setBusy(true);
    try {
      setBgPath(await uploadBg(f));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function toPreview() {
    if (!title.trim()) return setErr('제목을 입력해 주세요.');
    if (!body.trim()) return setErr('Word 파일을 첨부해 주세요.');
    setErr('');
    setMode({ kind: 'preview' });
  }

  async function confirmRegister() {
    setBusy(true);
    setErr('');
    try {
      await createPiece({ title: title.trim(), body, bgKey, bgPath, fontKey, status: publishNow ? 'published' : 'draft' });
      resetDraft();
      setMode({ kind: 'list' });
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(piece: EssayPiece) {
    setBusy(true);
    setErr('');
    try {
      await updatePiece(piece.id, { title: title.trim(), bgKey, fontKey, bgPath });
      setMode({ kind: 'list' });
      resetDraft();
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function togglePublish(p: EssayPiece) {
    setBusy(true);
    try {
      await updatePiece(p.id, { status: p.status === 'published' ? 'draft' : 'published' });
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** 공개일(오픈)·마감에 한 번에 여닫기 */
  async function setAllStatus(status: 'published' | 'draft') {
    const targets = pieces.filter((p) => p.status !== status);
    if (targets.length === 0) return;
    const what = status === 'published' ? '공개' : '비공개';
    if (!window.confirm(`${targets.length}편을 모두 ${what}로 바꿀까요?`)) return;
    setBusy(true);
    setErr('');
    try {
      for (const p of targets) await updatePiece(p.id, { status });
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** 시험 삼아 돌려본 평가 기록을 공개 전에 비운다(작품은 유지) */
  async function resetAll() {
    if (readers.length === 0) return;
    if (!window.confirm(`평가 기록을 모두 지웁니다.
등록 ${readers.length}명 · 순위 제출 ${submittedCount}명 분이 사라지고 되돌릴 수 없습니다.
작품은 그대로 남습니다. 계속할까요?`)) return;
    if (!window.confirm('정말 지울까요? 이 작업은 되돌릴 수 없습니다.')) return;
    setBusy(true);
    setErr('');
    try {
      await resetEvaluations();
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: EssayPiece) {
    if (!window.confirm(`"${p.title}" 을(를) 삭제할까요? 이 글에 매겨진 순위도 함께 지워집니다.`)) return;
    setBusy(true);
    try {
      await deletePiece(p);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function openEdit(p: EssayPiece) {
    setTitle(p.title);
    setParas(p.body.split(/\n{2,}/).filter((s) => s.trim() !== ''));
    setDropFirst(false);
    setBgKey(p.bgKey);
    setFontKey(p.fontKey);
    setBgPath(p.bgPath);
    setErr('');
    setMode({ kind: 'edit', piece: p });
  }

  const publicUrl = `${window.location.origin}${PUBLIC_PATH}`;

  // ── 미리보기 / 수정 화면 ─────────────────────────────────────────────
  if (mode.kind === 'preview' || mode.kind === 'edit') {
    const editing = mode.kind === 'edit' ? mode.piece : null;
    return (
      <Shell publicUrl={publicUrl}>
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <b style={{ fontSize: 16, color: 'var(--navy)' }}>{editing ? '작품 수정' : '미리보기'}</b>
            <span style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-3)' }}>
              {editing ? '표시 설정을 바꾼 뒤 저장합니다(본문은 재업로드로만 교체).' : '이대로 등록할지 확인해 주세요.'}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '14px 0 16px' }}>
            <label style={fieldWrap}>
              <span style={fieldLabel}>제목</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...input, width: 280 }} />
            </label>
            <label style={fieldWrap}>
              <span style={fieldLabel}>배경</span>
              <select value={bgKey} onChange={(e) => setBgKey(e.target.value)} style={{ ...input, width: 150 }}>
                {ALL_THEMES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={fieldWrap}>
              <span style={fieldLabel}>서체</span>
              <select value={fontKey} onChange={(e) => setFontKey(e.target.value)} style={{ ...input, width: 180 }}>
                {FONTS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={fieldWrap}>
              <span style={fieldLabel}>배경 이미지(선택)</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input ref={bgRef} type="file" accept="image/*" onChange={(e) => pickBg(e.target.files?.[0] ?? null)} style={{ fontSize: 'var(--fs-2)' }} />
                {bgPath && (
                  <button type="button" onClick={() => setBgPath(null)} style={ghostBtn}>
                    프리셋으로
                  </button>
                )}
              </div>
            </label>
          </div>

          {!editing && paras.length > 1 && (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 'var(--fs-3)',
                color: '#3d4756',
                background: '#faf8f3',
                border: '1px solid var(--rule-2)',
                borderRadius: 8,
                padding: '9px 12px',
                marginBottom: 14,
              }}
            >
              <input type="checkbox" checked={dropFirst} onChange={(e) => setDropFirst(e.target.checked)} />
              문서 첫 줄(<b>{paras[0]}</b>)을 제목으로 쓰고 본문에서 빼기
            </label>
          )}

          <div style={{ marginBottom: 14 }}>
            <div style={{ ...fieldLabel, marginBottom: 6 }}>배경 고르기 {bgPath && '(업로드 이미지가 우선합니다)'}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ALL_THEMES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setBgKey(t.key)}
                  title={t.label}
                  style={{
                    width: 74,
                    height: 44,
                    borderRadius: 7,
                    background: t.photo ? `url(${bgUrl(t.photo)}) center/cover` : t.swatch,
                    border: bgKey === t.key ? '2px solid var(--navy)' : '1px solid #d9d4c8',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'center',
                    opacity: bgPath ? 0.45 : 1,
                  }}
                >
                  <span
                    style={{
                      fontSize: 'var(--fs-0)',
                      fontWeight: 700,
                      color: '#fff',
                      width: '100%',
                      background: 'rgba(0,0,0,0.42)',
                      borderRadius: '0 0 5px 5px',
                      padding: '1px 0 2px',
                    }}
                  >
                    {t.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <EssayPaper
            embedded
            title={title || '(제목 없음)'}
            body={body}
            bgKey={bgKey}
            bgImageUrl={bgPath ? bgUrl(bgPath) : null}
            fontKey={fontKey}
          />

          {err && <div style={errBox}>{err}</div>}

          {!editing && (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 'var(--fs-3)',
                color: '#3d4756',
                background: '#faf8f3',
                border: '1px solid var(--rule-2)',
                borderRadius: 8,
                padding: '9px 12px',
                marginTop: 14,
              }}
            >
              <input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} />
              등록과 동시에 <b>공개</b>하기 — 체크하지 않으면 <b>비공개</b>로 보관되고, 목록에서 한꺼번에 공개할 수 있습니다.
            </label>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            {editing ? (
              <>
                <button type="button" disabled={busy} onClick={() => saveEdit(editing)} style={primaryBtn}>
                  저장
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetDraft();
                    setMode({ kind: 'list' });
                  }}
                  style={ghostBtn}
                >
                  취소
                </button>
              </>
            ) : (
              <>
                <button type="button" disabled={busy} onClick={confirmRegister} style={primaryBtn}>
                  {busy ? '등록 중…' : '확정하여 등록'}
                </button>
                <button type="button" onClick={() => setMode({ kind: 'list' })} style={ghostBtn}>
                  수정하기
                </button>
              </>
            )}
          </div>
        </div>
      </Shell>
    );
  }

  // ── 목록 화면 ────────────────────────────────────────────────────────
  return (
    <Shell publicUrl={publicUrl}>
      <div style={card}>
        <b style={{ fontSize: 16, color: 'var(--navy)' }}>새 작품 올리기</b>
        <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-3)', margin: '4px 0 16px' }}>제목과 Word(.docx) 파일만 있으면 됩니다.</div>

        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={fieldWrap}>
            <span style={fieldLabel}>제목</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="작품 제목"
              style={{ ...input, width: 320 }}
            />
          </label>
          <label style={fieldWrap}>
            <span style={fieldLabel}>Word 파일</span>
            <input
              ref={fileRef}
              type="file"
              accept=".docx"
              onChange={(e) => pickDocx(e.target.files?.[0] ?? null)}
              style={{ fontSize: 'var(--fs-3)' }}
            />
          </label>
          <button type="button" onClick={toPreview} disabled={busy} style={primaryBtn}>
            {busy ? '읽는 중…' : '미리보기'}
          </button>
          {(title || body) && (
            <button type="button" onClick={resetDraft} style={ghostBtn}>
              지우기
            </button>
          )}
        </div>

        {fileName && (
          <div style={{ marginTop: 10, fontSize: 'var(--fs-2)', color: '#5b6472' }}>
            {fileName} · 본문 {body.split(/\n{2,}/).filter(Boolean).length}문단 · {body.replace(/\s/g, '').length}자
          </div>
        )}
        {err && <div style={errBox}>{err}</div>}
      </div>

      <RankingStats pieces={pieces} rankings={rankings} readers={readers} />

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 16, color: 'var(--navy)' }}>등록된 작품</b>
          <span style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-3)' }}>
            {pieces.length}편 · 공개 {publishedCount}편 · 비공개 {pieces.length - publishedCount}편
          </span>
          <span style={{ flex: 1 }} />
          {readers.length > 0 && (
            <>
              <span style={{ fontSize: 'var(--fs-2)', color: '#5b6472' }}>
                등록 {readers.length}명 · 순위 제출 {submittedCount}명
              </span>
              <button type="button" disabled={busy} onClick={resetAll} style={dangerBtn}>
                평가 초기화
              </button>
            </>
          )}
          <button
            type="button"
            disabled={busy || publishedCount === pieces.length || pieces.length === 0}
            onClick={() => setAllStatus('published')}
            style={primaryBtn}
          >
            모두 공개
          </button>
          <button
            type="button"
            disabled={busy || publishedCount === 0}
            onClick={() => setAllStatus('draft')}
            style={ghostBtn}
          >
            모두 비공개
          </button>
        </div>

        {pieces.length === 0 ? (
          <div style={{ fontSize: 13.5, color: 'var(--ink-3)', padding: '10px 0' }}>아직 등록된 작품이 없습니다.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--ink-3)', fontSize: 'var(--fs-2)' }}>
                <th style={th}>제목</th>
                <th style={{ ...th, width: 80 }}>상태</th>
                <th style={{ ...th, width: 110, textAlign: 'right' }}>평균 순위</th>
                <th style={{ ...th, width: 210 }} />
              </tr>
            </thead>
            <tbody>
              {pieces.map((p) => {
                const rs = rankings.filter((r) => r.pieceId === p.id).map((r) => r.rank);
                const avg = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0;
                return (
                  <tr key={p.id} style={{ borderTop: '1px solid var(--rule-2)' }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: 'var(--navy)' }}>{p.title}</div>
                      <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
                        {ALL_THEMES.find((t) => t.key === p.bgKey)?.label ?? p.bgKey}
                        {p.bgPath ? ' · 이미지' : ''} · {FONTS.find((f) => f.key === p.fontKey)?.label ?? p.fontKey}
                      </div>
                      {rs.length > 0 && (
                        <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginTop: 4 }}>
                          {rs.length}명 평가 · 1위표 {rs.filter((r) => r === 1).length}
                        </div>
                      )}
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          fontSize: 'var(--fs-1)',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 4,
                          color: p.status === 'published' ? '#1A6E3C' : '#8a5a00',
                          background: p.status === 'published' ? '#e6f4ec' : '#fdf3e0',
                          border: `1px solid ${p.status === 'published' ? '#bfe3cc' : '#f0dcb4'}`,
                        }}
                      >
                        {p.status === 'published' ? '공개' : '비공개'}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {rs.length ? avg.toFixed(2) : '—'}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button type="button" onClick={() => openEdit(p)} style={ghostBtn}>
                        보기·수정
                      </button>{' '}
                      <button type="button" onClick={() => togglePublish(p)} disabled={busy} style={ghostBtn}>
                        {p.status === 'published' ? '비공개' : '공개'}
                      </button>{' '}
                      <button type="button" onClick={() => remove(p)} disabled={busy} style={dangerBtn}>
                        삭제
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children, publicUrl }: { children: React.ReactNode; publicUrl: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ minHeight: '100vh', background: '#f5f2ec', padding: '24px 16px' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, letterSpacing: 1, color: 'var(--navy)' }}>JAY</span>
          <span style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-3)' }}>습작 관리 · 비공개</span>
          <span style={{ flex: 1 }} />
          <code style={{ fontSize: 'var(--fs-2)', color: '#5b6472', background: '#fff', border: '1px solid #e3ddd0', borderRadius: 6, padding: '4px 8px' }}>
            {publicUrl}
          </code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(publicUrl).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            style={ghostBtn}
          >
            {copied ? '복사됨' : '링크 복사'}
          </button>
          <a href={publicUrl} target="_blank" rel="noreferrer" style={{ ...ghostBtn, textDecoration: 'none', display: 'inline-block' }}>
            열어보기
          </a>
        </div>
        {children}
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid var(--rule)',
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};
const fieldWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5 };
const fieldLabel: React.CSSProperties = { fontSize: 'var(--fs-2)', color: 'var(--ink-3)', fontWeight: 600 };
const input: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 14,
  border: '1px solid #ddd6c7',
  borderRadius: 8,
  outline: 'none',
  background: '#fff',
  color: 'var(--ink-2)',
};
const primaryBtn: React.CSSProperties = {
  padding: '9px 18px',
  fontSize: 14,
  fontWeight: 700,
  color: '#fff',
  background: 'var(--navy)',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  padding: '7px 12px',
  fontSize: 'var(--fs-2)',
  color: '#3d4756',
  background: '#fff',
  border: '1px solid #d9d4c8',
  borderRadius: 7,
  cursor: 'pointer',
};
const dangerBtn: React.CSSProperties = { ...ghostBtn, color: '#b04a3a', borderColor: '#e6c7c1' };
const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '10px 8px', verticalAlign: 'top' };
const errBox: React.CSSProperties = {
  marginTop: 12,
  fontSize: 'var(--fs-3)',
  color: '#b04a3a',
  background: '#fdf1ef',
  border: '1px solid #f0d6d0',
  borderRadius: 8,
  padding: '8px 10px',
};
