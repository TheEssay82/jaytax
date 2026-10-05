// 주석·DSD 관리 › ③ 검증
//
// 채워 넣은 엑셀을 받아 어긋난 곳을 찾는다. **작년 DSD 를 함께 받는 까닭**은, ② 가 만든
// 배치를 그대로 다시 지어 「어디에 무엇이 있어야 하는가」를 알고 대 보기 때문이다.
// 엑셀만 보고 표를 다시 알아내려 들면 배치 규칙을 두 벌 쓰게 되고 둘이 어긋난다.
//
// 길이 **둘**이다.
//   엑셀  — ② 가 만든 서식을 채워 넣은 것. 우리가 주석을 짓는 보통의 경우다.
//   DSD   — 이미 다 적힌 보고서 그대로. 작년 보고서가 없어 **손으로 짠** 초도감사(태양빛)나,
//           주석을 **남이 지어 준** 경우다. 이월을 끄고 배치를 지으면 칸마다 그 파일의 숫자가
//           앉으므로, 같은 검증기를 그대로 태운다(noteVerify.sheetsOfPlans).
//
// ⚠️ **파일은 서버로 올라가지 않는다.** 브라우저 안에서 읽고 결과만 화면에 낸다.
import { useState } from 'react';
import { pickAll, pickNotes, planNotes, isNoteSheet, type SheetLayout } from '../../lib/notePick';
import { layoutReport } from '../../lib/noteVerify';
import {
  verifyAll, tieOut, checkLinks, sheetsOfPlans,
  type VerifyResult, type Level, type TieRow,
} from '../../lib/noteVerify';
import { findLinks } from '../../lib/noteLink';
import { readWorkbook } from '../../lib/xlsxRead';
import { injectSheets } from '../../lib/xlsxInject';
import type { NoteRow } from '../../lib/dsdApi';
import { StepHead, Opt, More, type LoadedDsd, type NoteFrom } from './DsdShell';
import { download } from './dsdUi';

const TONE: Record<Level, { bg: string; ink: string }> = {
  틀림: { bg: 'var(--bad-bg)', ink: 'var(--bad)' },
  '살펴볼 것': { bg: 'var(--warn-bg)', ink: 'var(--warn)' },
  '안 채움': { bg: 'var(--surface-2)', ink: 'var(--ink-3)' },
};

export interface Filled { name: string; bytes: Uint8Array }

export default function NoteVerifyCard(
  { notes, dsd, xl, setXl, from, spare, layout, roll }:
  {
    notes: NoteRow[]; dsd: LoadedDsd;
    xl: Filled | null; setXl: (v: Filled | null) => void; from: NoteFrom; spare: number;
    layout: SheetLayout;
    /** 다음 해로 이월 — ②③④ 공통(DsdShell.WorkSettings) */ roll: boolean;
  },
) {
  const [src, setSrc] = useState<'xlsx' | 'dsd'>('xlsx');
  const [ties, setTies] = useState<TieRow[]>([]);
  const [linkCount, setLinkCount] = useState(0);
  const [res, setRes] = useState<VerifyResult | null>(null);
  const [say, setSay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [only, setOnly] = useState(true);

  async function takeXl(f: File | undefined) {
    if (!f) return;
    setSay(null); setRes(null);
    setXl({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  }

  function plans(mode: 'xlsx' | 'dsd') {
    // DSD 를 그대로 검증할 때는 **파일에 든 주석 전부**를 본다 — 검증 대상이 그 파일이다.
    // 엑셀을 볼 때는 ② 가 뜬 것과 **같은 규칙으로** 골라야 시트 이름이 맞는다.
    const picked = mode === 'dsd' || from === 'file'
      ? pickAll(dsd.blocks)
      : pickNotes(dsd.blocks, notes);
    if (!picked.length) {
      throw new Error(mode === 'dsd'
        ? '이 파일에서 주석을 찾지 못했습니다.'
        : '켜 둔 주석이 없습니다. ① 에서 골라 주세요.');
    }
    // 다 적힌 DSD 를 그대로 볼 때는 여분 행이 뜻이 없다 — 채울 자리가 아니라 읽을 파일이다.
    const made = planNotes(picked, mode === 'dsd' ? false : roll, mode === 'dsd' ? 0 : spare, layout);
    // 맞아야 하는 숫자 짝은 **작년 값이 든 배치**에서 배운다 — 자리는 이월한 것과 같다.
    // DSD 를 그대로 볼 때는 짝을 배울 작년이 없다. 같은 파일에서 배워 같은 파일에 대 보면
    // 언제나 맞으므로 아무것도 말해 주지 않는다 — 그래서 하지 않는다.
    const links = mode === 'dsd' ? [] : findLinks(roll ? planNotes(picked, false, spare, layout) : made, dsd.fs);
    return { refs: made.map((plan, i) => ({ plan, dsdNo: picked[i].note?.no ?? null })), links };
  }

  function run() {
    if (src === 'xlsx' && !xl) return setSay('채워 넣은 엑셀(.xlsx)을 고르세요.');
    setBusy(true); setSay(null);
    try {
      const { refs, links } = plans(src);
      let sheets;
      if (src === 'dsd') {
        sheets = sheetsOfPlans(refs.map((r) => r.plan));
      } else {
        sheets = readWorkbook(xl!.bytes, (n) => isNoteSheet(n, layout));
        if (!sheets.length) {
          throw new Error(layout === 'long'
            ? '이 엑셀에 「주석(생성)」 시트가 없습니다. 이 건은 한 시트 종단형입니다 — ② 에서 만든 파일인지 보십시오.'
            : '이 엑셀에 주석 시트(N01 … 꼴)가 없습니다. ② 에서 만든 파일인지 보십시오.');
        }
      }
      const out = verifyAll(refs.map((r) => r.plan), sheets);
      const tie = tieOut(dsd.fs, refs, sheets, src === 'dsd' ? false : roll);
      out.findings.push(...tie.findings, ...checkLinks(links, sheets));
      setLinkCount(links.length);
      const rank: Record<Level, number> = { 틀림: 0, '살펴볼 것': 1, '안 채움': 2 };
      out.findings.sort((a, b) => rank[a.level] - rank[b.level]);
      setTies(tie.rows);
      setRes(out);
    } catch (e) {
      setSay(e instanceof Error ? e.message : '검증하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  function saveReport() {
    if (!res || !xl) return;   // 얹을 엑셀이 있을 때만 — DSD 갈래는 화면으로 본다
    try {
      download(injectSheets(xl.bytes, [layoutReport(res, new Date(), ties)]),
        `${xl.name.replace(/\.xlsx$/i, '')}_검증.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
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
      <StepHead no="③" title="검증" when="기말감사"
        line={<>다 채운 주석 엑셀을 훑어 <b>합계 · 주석끼리 맞아야 할 숫자 · 전기 숫자 · 재무제표↔주석</b>이 맞는지 봅니다.</>}
        more={<>
          파일은 브라우저 안에서만 열립니다. 여기서 고른 엑셀은 ④ 도 그대로 씁니다.
        </>}
      />

      {src === 'dsd' && (
        <div style={{ margin: '4px 0 6px', padding: '7px 10px', borderRadius: 'var(--r-sm)', background: 'var(--warn-bg)', color: 'var(--warn)', fontSize: 'var(--fs-2)' }}>
          <b>다른 경우</b> — ① 에 올린 완성 DSD 를 그대로 훑습니다(④ 로 이어지지 않습니다). <button className="btn-sm" onClick={() => { setSrc('xlsx'); setRes(null); }}>보통으로 돌아가기</button>
        </div>
      )}
      {src === 'xlsx' ? (
        <Opt label="채워 넣은 엑셀">
          <label className="btn-sm btn-sm-navy" style={{ cursor: 'pointer' }}>
            {xl ? '다른 파일' : '파일 고르기'}
            <input type="file" accept=".xlsx" style={{ display: 'none' }} onChange={(e) => { void takeXl(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {xl
            ? <span style={{ marginLeft: 8, color: 'var(--good)' }}>✓ <b>{xl.name}</b> · {Math.round(xl.bytes.length / 1024)}KB</span>
            : <span style={{ marginLeft: 8, color: 'var(--ink-3)', fontSize: 'var(--fs-1)' }}>② 가 만든 「…_주석시트.xlsx」를 채운 것</span>}
          {!roll && <div style={{ color: 'var(--warn)', fontSize: 'var(--fs-1)', marginTop: 4 }}>「다음 해로 이월」이 꺼져 있습니다 — ② 와 같게 두어야 자리가 맞습니다(위 작업 설정).</div>}
        </Opt>
      ) : (
        <Opt label="훑을 파일">
          <b>{dsd.name}</b> 안의 숫자 — 주석 {dsd.blocks.length}개
        </Opt>
      )}

      {say && (
        <div style={{
          marginTop: 10, padding: '8px 11px', borderRadius: 'var(--r-sm)',
          background: 'var(--bad-bg)', color: 'var(--bad)', fontSize: 'var(--fs-2)',
        }}>{say}</div>
      )}

      {src === 'xlsx' && (
        <div style={{ marginTop: 8 }}>
          <More label="다른 경우 — 완성된 DSD 를 그대로 검사하기">
            작년 보고서가 없어 <b>회사가 주석을 지어 준 DSD</b> 나 <b>초도감사라 손으로 짠 DSD</b> 를 받았을 때, ① 에 그 <b>당기 완성 DSD</b> 를 올리고 여기서 그대로 훑습니다.
            합계와 재무제표↔주석 대사만 봅니다(전기 값은 대 볼 작년이 없음). 이 갈래는 ④ 로 이어지지 않습니다 — 고칠 곳은 DART 편집기에서 고칩니다.
            <div style={{ marginTop: 6 }}><button className="btn-sm" onClick={() => { setSrc('dsd'); setRes(null); }}>완성 DSD 그대로 검사하기</button></div>
          </More>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
        {res && <button className="btn-sm" onClick={saveReport}>검증보고서 얹은 엑셀 내려받기</button>}
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
              {linkCount > 0 && ` · 맞춰 본 숫자 짝 ${linkCount}개`}
            </span>
            <label style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginLeft: 'auto' }}>
              <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />{' '}
              안 채운 칸은 감추기
            </label>
          </div>

          {shown.length === 0 ? (
            <div style={{
              padding: '10px 12px', borderRadius: 'var(--r-sm)', lineHeight: 1.7,
              background: 'var(--good-bg)', color: 'var(--good)', fontSize: 'var(--fs-2)',
            }}>
              어긋난 곳을 찾지 못했습니다.
              {src === 'dsd'
                ? ' 이 보고서의 합계와 대사는 맞습니다.'
                : count('안 채움') === 0
                  ? ' 채워 넣을 칸도 다 찼습니다 — 아래 ④ 에서 DSD 를 만드십시오.'
                  : ` 다만 채워 넣을 칸이 ${count('안 채움')}개 남았습니다.`}
            </div>
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
          {ties.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', fontSize: 'var(--fs-2)' }}>
                <b>재무제표 ↔ 주석 대사</b>{' '}
                <span style={{ color: 'var(--ink-3)' }}>
                  {ties.filter((t) => t.foundIn).length}/{ties.length} 찾음 — 재무제표가 가리킨 주석에서 그 금액을 찾았는지
                </span>
              </summary>
              <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)', margin: '6px 0 8px', lineHeight: 1.6 }}>
                못 찾은 것이 잘못은 아닙니다 — 주석 표시는 「관련된 주석」이라, 특수관계자분만 싣는 경우처럼
                액수가 다를 수 있습니다. 한 번 보고 넘기시면 됩니다.
              </div>
              <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)' }}>
                <table style={{ width: '100%', fontSize: 'var(--fs-1)', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['재무제표', '과목', '금액', '가리킨 주석', '찾은 곳'].map((h) => (
                        <th key={h} style={{
                          position: 'sticky', top: 0, background: 'var(--surface-2)', textAlign: 'left',
                          padding: '5px 8px', borderBottom: '1px solid var(--rule)', whiteSpace: 'nowrap',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ties.map((t, i) => (
                      <tr key={`${t.label}${i}`} style={{ borderTop: '1px solid var(--rule)' }}>
                        <td style={{ padding: '4px 8px', whiteSpace: 'nowrap', color: 'var(--ink-3)' }}>{t.statement}</td>
                        <td style={{ padding: '4px 8px' }}>{t.label}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {t.amount.toLocaleString('ko-KR')}
                        </td>
                        <td style={{ padding: '4px 8px', whiteSpace: 'nowrap', color: 'var(--ink-3)' }}>
                          {t.notes.map((n) => `주석 ${n}`).join(', ')}
                        </td>
                        <td style={{ padding: '4px 8px' }}>
                          <span style={{
                            padding: '1px 7px', borderRadius: 999, fontSize: 'var(--fs-0)', fontWeight: 600,
                            background: t.missing.length ? 'var(--bad-bg)' : t.foundIn ? 'var(--good-bg)' : 'var(--surface-2)',
                            color: t.missing.length ? 'var(--bad)' : t.foundIn ? 'var(--good)' : 'var(--ink-3)',
                          }}>
                            {t.missing.length ? `주석 ${t.missing.join(',')} 없음` : t.foundIn ?? '짝 없음'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
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
