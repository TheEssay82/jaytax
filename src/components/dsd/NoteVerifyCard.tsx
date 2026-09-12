// 주석·DSD 관리 › ③ 검증
//
// 채워 넣은 엑셀을 받아 어긋난 곳을 찾는다. **작년 DSD 를 함께 받는 까닭**은, ② 가 만든
// 배치를 그대로 다시 지어 「어디에 무엇이 있어야 하는가」를 알고 대 보기 때문이다.
// 엑셀만 보고 표를 다시 알아내려 들면 배치 규칙을 두 벌 쓰게 되고 둘이 어긋난다.
//
// ⚠️ **파일은 서버로 올라가지 않는다.** 브라우저 안에서 읽고 결과만 화면에 낸다.
import { useState } from 'react';
import { readContents } from '../../lib/dsdFile';
import { parseNoteBlocks, type NoteBlocks } from '../../lib/dsdBlocks';
import { pickNotes, planNotes } from '../../lib/notePick';
import { layoutReport } from '../../lib/noteVerify';
import { verifyAll, type VerifyResult, type Level } from '../../lib/noteVerify';
import { readWorkbook } from '../../lib/xlsxRead';
import { injectSheets } from '../../lib/xlsxInject';
import type { NoteRow } from '../../lib/dsdApi';

const TONE: Record<Level, { bg: string; ink: string }> = {
  틀림: { bg: 'var(--bad-bg)', ink: 'var(--bad)' },
  '살펴볼 것': { bg: 'var(--warn-bg)', ink: 'var(--warn)' },
  '안 채움': { bg: 'var(--surface-2)', ink: 'var(--ink-3)' },
};

export default function NoteVerifyCard({ notes }: { notes: NoteRow[] }) {
  const [blocks, setBlocks] = useState<NoteBlocks[] | null>(null);
  const [dsdName, setDsdName] = useState('');
  const [xl, setXl] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [roll, setRoll] = useState(true);
  const [res, setRes] = useState<VerifyResult | null>(null);
  const [say, setSay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [only, setOnly] = useState(true);

  async function takeDsd(f: File | undefined) {
    if (!f) return;
    setSay(null); setRes(null);
    try {
      const bs = parseNoteBlocks(await readContents(f));
      setBlocks(bs);
      setDsdName(`${f.name} · 주석 ${bs.length}개`);
      if (!bs.length) setSay('이 파일에서 주석을 찾지 못했습니다.');
    } catch (e) {
      setBlocks(null);
      setSay(e instanceof Error ? e.message : 'DSD 를 읽지 못했습니다.');
    }
  }

  async function takeXl(f: File | undefined) {
    if (!f) return;
    setSay(null); setRes(null);
    setXl({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  }

  function plans() {
    const picked = pickNotes(blocks!, notes);
    if (!picked.length) throw new Error('켜 둔 주석이 없습니다. ① 에서 골라 주세요.');
    return planNotes(picked, roll);
  }

  function run() {
    if (!blocks) return setSay('작년 감사보고서(.dsd)를 먼저 고르세요.');
    if (!xl) return setSay('채워 넣은 엑셀(.xlsx)을 고르세요.');
    setBusy(true); setSay(null);
    try {
      const p = plans();
      const sheets = readWorkbook(xl.bytes, (n) => /^N\d\d /.test(n));
      if (!sheets.length) {
        throw new Error('이 엑셀에 주석 시트(N01 … 꼴)가 없습니다. ② 에서 만든 파일인지 보십시오.');
      }
      setRes(verifyAll(p, sheets));
    } catch (e) {
      setSay(e instanceof Error ? e.message : '검증하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!res || !xl) return;
    try {
      const out = injectSheets(xl.bytes, [layoutReport(res)]);
      const blob = new Blob([out as unknown as BlobPart], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${xl.name.replace(/\.xlsx$/i, '')}_검증.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setSay(e instanceof Error ? e.message : '보고서를 만들지 못했습니다.');
    }
  }

  const shown = res
    ? (only ? res.findings.filter((f) => f.level !== '안 채움') : res.findings).slice(0, 300)
    : [];
  const count = (lv: Level) => res?.findings.filter((f) => f.level === lv).length ?? 0;

  return (
    <div className="card">
      <div className="chdr">
        ③ 검증
        <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>
          채워 넣은 엑셀을 훑습니다
        </span>
      </div>

      <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7, marginBottom: 12 }}>
        <b>합계가 맞는지</b>, <b>전기 숫자가 바뀌지 않았는지</b>, <b>채워 넣을 칸이 남았는지</b>를 봅니다.
        <span style={{ color: 'var(--ink-3)' }}> 파일은 브라우저 안에서만 열립니다.</span>
      </div>

      <div className="frow"><span className="fl">작년 감사보고서</span>
        <div>
          <input type="file" accept=".dsd" style={{ fontSize: 'var(--fs-1)' }}
            onChange={(e) => void takeDsd(e.target.files?.[0])} />
          {dsdName && <div style={{ fontSize: 'var(--fs-1)', color: 'var(--good)', marginTop: 3 }}>{dsdName}</div>}
        </div>
      </div>

      <div className="frow"><span className="fl">채워 넣은 엑셀</span>
        <div>
          <input type="file" accept=".xlsx" style={{ fontSize: 'var(--fs-1)' }}
            onChange={(e) => void takeXl(e.target.files?.[0])} />
          {xl && (
            <div style={{ fontSize: 'var(--fs-1)', color: 'var(--good)', marginTop: 3 }}>
              {xl.name} · {Math.round(xl.bytes.length / 1024)}KB
            </div>
          )}
        </div>
      </div>

      <div className="frow"><span className="fl">이월해서 만든 것</span>
        <label style={{ fontSize: 'var(--fs-2)' }}>
          <input type="checkbox" checked={roll} onChange={(e) => setRoll(e.target.checked)} />{' '}
          ② 에서 <b>「다음 해로 이월」을 켜고</b> 만든 파일입니다
          <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)', marginTop: 2 }}>
            ② 와 다르게 두면 자리가 어긋나 온통 틀렸다고 나옵니다.
          </div>
        </label>
      </div>

      {say && (
        <div style={{
          marginTop: 10, padding: '8px 11px', borderRadius: 'var(--r-sm)',
          background: 'var(--bad-bg)', color: 'var(--bad)', fontSize: 'var(--fs-2)',
        }}>{say}</div>
      )}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
        {res && <button className="btn-sm" onClick={download}>검증보고서 얹은 엑셀 내려받기</button>}
        <button className="btn-p" disabled={busy} onClick={run}>{busy ? '훑는 중…' : '검증하기'}</button>
      </div>

      {res && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            {(['틀림', '살펴볼 것', '안 채움'] as Level[]).map((lv) => (
              <span key={lv} style={{
                padding: '3px 9px', borderRadius: 999, fontSize: 'var(--fs-1)',
                background: TONE[lv].bg, color: TONE[lv].ink, fontWeight: 600,
              }}>{lv} {count(lv)}</span>
            ))}
            <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
              주석 시트 {res.scanned.sheets}장 · 표 {res.scanned.tables}장 · 채운 칸 {res.filled.done}/{res.filled.total}
            </span>
            <label style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginLeft: 'auto' }}>
              <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />{' '}
              안 채운 칸은 감추기
            </label>
          </div>

          {shown.length === 0 ? (
            <div style={{
              padding: '10px 12px', borderRadius: 'var(--r-sm)',
              background: 'var(--good-bg)', color: 'var(--good)', fontSize: 'var(--fs-2)',
            }}>어긋난 곳을 찾지 못했습니다.</div>
          ) : (
            <div style={{ maxHeight: 460, overflow: 'auto', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)' }}>
              <table style={{ width: '100%', fontSize: 'var(--fs-1)', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['판단', '갈래', '주석', '자리', '내용'].map((h) => (
                      <th key={h} style={{
                        position: 'sticky', top: 0, background: 'var(--surface-2)', textAlign: 'left',
                        padding: '6px 8px', borderBottom: '1px solid var(--rule)', whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((f, i) => (
                    <tr key={`${f.sheet}${f.where}${i}`} style={{ borderTop: '1px solid var(--rule)' }}>
                      <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                        <span style={{
                          padding: '1px 7px', borderRadius: 999, fontSize: 'var(--fs-0)',
                          background: TONE[f.level].bg, color: TONE[f.level].ink, fontWeight: 600,
                        }}>{f.level}</span>
                      </td>
                      <td style={{ padding: '5px 8px', whiteSpace: 'nowrap', color: 'var(--ink-3)' }}>{f.kind}</td>
                      <td style={{ padding: '5px 8px' }}>{f.note}</td>
                      <td style={{ padding: '5px 8px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{f.where}</td>
                      <td style={{ padding: '5px 8px' }}>{f.says}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {res.findings.length > shown.length && (
            <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)', marginTop: 6 }}>
              {res.findings.length - shown.length}건은 화면에서 줄였습니다 — 내려받은 보고서에는 다 있습니다.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
