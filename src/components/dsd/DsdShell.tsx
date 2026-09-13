// 주석·DSD 관리의 **공용 바와 탭 틀**.
//
// 왜 필요한가: ②③④ 가 저마다 「작년 감사보고서」를 받고 있었다. 같은 파일을 세 번 고르는
// 일이다(사용자 지적 2026-09-13). 파일은 서버에 올리지 않는 설계라 DB 에 담아 둘 수 없으므로,
// **화면 위에서 한 번 고르고 탭들이 함께 쓴다.** 브라우저를 닫으면 지워진다 — 아무 데도 남지
// 않는 편을 골랐다(사용자 결정).
import { useState } from 'react';
import { readDsd, readContents } from '../../lib/dsdFile';
import { parseNoteBlocks, type NoteBlocks } from '../../lib/dsdBlocks';
import { companyName, bareName } from '../../lib/dsdParse';
import { parseStatements, type FsLine } from '../../lib/fsParse';

/**
 * 한 번 읽어 두고 탭들이 나눠 쓰는 감사보고서.
 *
 * 보통은 **작년** 것이다 — ② 가 서식을 뜨고 ④ 가 틀로 쓴다. 다만 ③ 은 **당기 완성본**도
 * 받는다: 작년 보고서가 아예 없어 손으로 짠 초도감사(태양빛)처럼, 검증할 것이 이미 다 적힌
 * 그 파일 하나뿐인 자리가 있다.
 */
export interface LoadedDsd {
  name: string;
  bytes: Uint8Array;
  blocks: NoteBlocks[];
  fs: FsLine[];
  docName: string;
  /** 문서에 적힌 회사 이름 — 작업 건과 어긋나면 알려 주려고 읽는다. */ company: string;
}

export function useDsdFile() {
  const [dsd, setDsd] = useState<LoadedDsd | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function take(f: File | undefined) {
    if (!f) return;
    setErr(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const info = await readDsd(f);
      const xml = await readContents(f);
      const blocks = parseNoteBlocks(xml);
      setDsd({
        name: f.name, bytes, blocks, fs: parseStatements(xml),
        docName: info.docName, company: companyName(xml),
      });
      if (!blocks.length) setErr('이 파일에서 주석을 찾지 못했습니다.');
    } catch (e) {
      setDsd(null);
      setErr(e instanceof Error ? e.message : 'DSD 를 읽지 못했습니다.');
    }
  }
  return { dsd, err, take, clear: () => { setDsd(null); setErr(null); } };
}

/** 화면 맨 위의 공용 바 — 감사보고서 하나. */
export function DsdBar(
  { dsd, err, take, clear, expect }: ReturnType<typeof useDsdFile> & { expect?: string },
) {
  // 이름이 달라 보이면 알려만 준다 — 표기가 제각각이라 막지는 않는다.
  const odd = dsd && expect && dsd.company
    && !bareName(dsd.company).includes(bareName(expect))
    && !bareName(expect).includes(bareName(dsd.company));
  return (
    <div className="card" style={{ padding: '10px 12px' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
          감사보고서(.dsd)
        </span>
        <input type="file" accept=".dsd" style={{ fontSize: 'var(--fs-1)' }}
          onChange={(e) => void take(e.target.files?.[0])} />
        {dsd ? (
          <>
            <span style={{ fontSize: 'var(--fs-1)', color: 'var(--good)' }}>
              <b>{dsd.name}</b> · 주석 {dsd.blocks.length}개 · 재무제표 {dsd.fs.length}줄
              {dsd.docName ? ` · ${dsd.docName}` : ''}
            </span>
            <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={clear}>비우기</button>
          </>
        ) : (
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-4)' }}>
            보통 <b>작년</b> 것입니다 — ② ③ ④ 가 함께 씁니다. 창을 닫으면 지워집니다.
          </span>
        )}
      </div>
      {err && (
        <div style={{ marginTop: 7, fontSize: 'var(--fs-2)', color: 'var(--bad)' }}>{err}</div>
      )}
      {odd && (
        <div style={{ marginTop: 7, fontSize: 'var(--fs-2)', color: 'var(--bad)', lineHeight: 1.6 }}>
          <b>회사가 다릅니다.</b> 고른 작업 건은 <b>{expect}</b> 인데 이 파일은 <b>{dsd!.company}</b> 의
          것입니다 — 작업 건을 잘못 골랐거나 파일을 잘못 고른 것입니다.
        </div>
      )}
    </div>
  );
}

/**
 * 주석을 **어디서 고르는가** — ② ③ ④ 가 반드시 같아야 한다.
 *
 *   list — ① 이 정한 목록. 해마다 켜고 끈 것이 그대로 살아 있다.
 *   file — 올린 파일에 든 것 전부. ① 목록과 파일이 남일 때 쓴다.
 *
 * 왜 한곳에 두는가: ② 가 뜬 시트 이름을 ③ 이 다시 지어내 대 보고, ④ 가 또 지어내 도로
 * 넣는다. 셋이 다르게 고르면 **시트 이름이 어긋나 온통 못 찾았다고 나온다.**
 */
export type NoteFrom = 'list' | 'file';

/** 주석을 어디서 고를지 — ② ③ ④ 위에 한 줄로 둔다. */
export function NoteFromBar(
  { from, set, listCount, fileCount }:
  { from: NoteFrom; set: (v: NoteFrom) => void; listCount: number; fileCount: number },
) {
  return (
    <div className="card" style={{ padding: '8px 12px', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>주석 목록</span>
      <label style={{ fontSize: 'var(--fs-2)' }}>
        <input type="radio" checked={from === 'list'} onChange={() => set('list')} disabled={listCount === 0} />{' '}
        ① 에서 켜 둔 것 <span style={{ color: 'var(--ink-3)' }}>{listCount}개</span>
      </label>
      <label style={{ fontSize: 'var(--fs-2)' }}>
        <input type="radio" checked={from === 'file'} onChange={() => set('file')} />{' '}
        올린 파일에 든 것 전부 <span style={{ color: 'var(--ink-3)' }}>{fileCount}개</span>
      </label>
      <span style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)', marginLeft: 'auto' }}>
        ② ③ ④ 가 함께 씁니다 — 도중에 바꾸면 시트 이름이 어긋납니다.
      </span>
    </div>
  );
}

export interface TabDef {
  key: string;
  label: string;
  hint: string;
  /** 이 탭을 쓰려면 작년 감사보고서가 있어야 하는가 */ needsDsd?: boolean;
}

export function DsdTabs(
  { tabs, at, go, hasDsd }: { tabs: TabDef[]; at: string; go: (k: string) => void; hasDsd: boolean },
) {
  return (
    <div style={{
      display: 'flex', gap: 2, borderBottom: '1px solid var(--rule)', margin: '2px 0 10px', flexWrap: 'wrap',
    }}>
      {tabs.map((t) => {
        const on = t.key === at;
        const locked = t.needsDsd && !hasDsd;
        return (
          <button
            key={t.key}
            onClick={() => go(t.key)}
            title={locked ? '감사보고서(.dsd)를 먼저 고르세요' : t.hint}
            style={{
              border: 0, borderBottom: `2px solid ${on ? 'var(--navy)' : 'transparent'}`,
              background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
              padding: '8px 14px 7px', fontSize: 'var(--fs-2)',
              fontWeight: on ? 700 : 400,
              color: on ? 'var(--navy)' : locked ? 'var(--ink-4)' : 'var(--ink-2)',
            }}
          >
            {t.label}
            <span style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)', marginLeft: 6, fontWeight: 400 }}>
              {t.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 작년 감사보고서가 없을 때 탭 자리에 띄우는 안내. */
export function NeedDsd() {
  return (
    <div className="card" style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-2)', lineHeight: 1.7 }}>
      위에서 <b>감사보고서(.dsd)</b>를 먼저 골라 주세요. ② 와 ④ 는 <b>작년</b> 것을 틀로 씁니다.
      ③ 은 <b>당기 완성본</b>을 넣어 그 파일을 그대로 훑을 수도 있습니다 — 주석을 회사 쪽에서
      지어 주거나 손으로 짠 경우입니다.
    </div>
  );
}
