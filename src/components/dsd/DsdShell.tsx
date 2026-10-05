// 주석·DSD 관리의 **공용 틀** — 단계 탭 · 작업 설정 · 감사보고서 올리기 · 단계 머리.
//
// 왜 필요한가: ②③④ 가 저마다 「작년 감사보고서」를 받고 있었다. 같은 파일을 세 번 고르는
// 일이다(사용자 지적 2026-09-13). 파일은 서버에 올리지 않는 설계라 DB 에 담아 둘 수 없으므로,
// **한 번 고르고 탭들이 함께 쓴다.** 브라우저를 닫으면 지워진다 — 아무 데도 남지 않는 편을 골랐다(사용자 결정).
//
// 2026-10-05 화면 재편(사용자 「가독성이 떨어진다 · 감사 흐름을 감안해 순서 검토」):
//   ① 작년 보고서(파일 올리기 + 주석 목록) → ② 중간감사·주석 엑셀 준비 → ③ 기말감사·검증 → ④ 보고서·DSD 완성(+ 표준주석엑셀)
//   긴 설명은 「자세히」로 접고, ②③④ 공통 설정(주석 목록·이월·여분 행)은 한 줄로 모았다.
import { useState } from 'react';
import { readDsd, readContents } from '../../lib/dsdFile';
import { parseNoteBlocks, type NoteBlocks } from '../../lib/dsdBlocks';
import { companyName, bareName } from '../../lib/dsdParse';
import { parseStatements, type FsLine } from '../../lib/fsParse';
import { LAYOUT_LABEL, type SheetLayout } from '../../lib/notePick';

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

/** 「자세히 ▸」 — 긴 설명은 접어 둔다. */
export function More({ children, label = '자세히' }: { children: React.ReactNode; label?: string }) {
  return (
    <details style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', lineHeight: 1.7 }}>
      <summary style={{ cursor: 'pointer', color: 'var(--info)', userSelect: 'none', width: 'fit-content' }}>{label}</summary>
      <div style={{ marginTop: 4, padding: '7px 10px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)' }}>{children}</div>
    </details>
  );
}

/** 단계 머리 — 번호 · 이름 · 감사 시점 · 할 일 한 줄 · 접는 설명. */
export function StepHead(
  { no, title, when, line, more, right }:
  { no: string; title: string; when: string; line: React.ReactNode; more?: React.ReactNode; right?: React.ReactNode },
) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{
          width: 28, height: 28, borderRadius: '50%', background: 'var(--navy)', color: '#fff', flex: 'none',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 'var(--fs-2)',
        }}>{no}</span>
        <span style={{ fontSize: 'var(--fs-4)', fontWeight: 700, color: 'var(--navy)' }}>{title}</span>
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', border: '1px solid var(--rule)', borderRadius: 999, padding: '1px 9px' }}>{when}</span>
        {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
      </div>
      <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', margin: '7px 0 3px 38px', lineHeight: 1.6 }}>{line}</div>
      {more && <div style={{ marginLeft: 38 }}><More>{more}</More></div>}
    </div>
  );
}

/** 선택 칸 한 줄 — 이름 · 내용. 도움말은 ⓘ 에 마우스를 올리면 보인다. */
export function Opt({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '130px minmax(0, 1fr)', gap: 12, alignItems: 'start', padding: '9px 0', borderTop: '1px solid var(--rule-2)' }}>
      <span style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', fontWeight: 600, paddingTop: 2 }}>
        {label}{hint && <span title={hint} style={{ marginLeft: 4, color: 'var(--ink-4)', cursor: 'help', fontWeight: 400 }}>ⓘ</span>}
      </span>
      <div style={{ fontSize: 'var(--fs-2)', minWidth: 0 }}>{children}</div>
    </div>
  );
}

/** 결과 상자 — 잘 됨(초록) · 문제(빨강). */
export function Note({ tone, children }: { tone: 'good' | 'bad'; children: React.ReactNode }) {
  return (
    <div style={{
      marginTop: 10, padding: '9px 12px', borderRadius: 'var(--r-sm)', lineHeight: 1.7, fontSize: 'var(--fs-2)',
      background: tone === 'good' ? 'var(--good-bg)' : 'var(--bad-bg)', color: tone === 'good' ? 'var(--good)' : 'var(--bad)',
    }}>{children}</div>
  );
}

/** ① 의 감사보고서 올리기 — 보통 **작년** 것. ②③④ 가 함께 쓴다. */
export function DsdBar(
  { dsd, err, take, clear, expect }: ReturnType<typeof useDsdFile> & { expect?: string },
) {
  // 이름이 달라 보이면 알려만 준다 — 표기가 제각각이라 막지는 않는다.
  const odd = dsd && expect && dsd.company
    && !bareName(dsd.company).includes(bareName(expect))
    && !bareName(expect).includes(bareName(dsd.company));
  return (
    <div style={{
      padding: '11px 14px', borderRadius: 'var(--r-sm)',
      border: `1.5px ${dsd ? 'solid var(--good)' : 'dashed var(--navy)'}`, background: dsd ? 'var(--good-bg)' : 'var(--surface-2)',
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 'var(--fs-2)', color: 'var(--navy)' }}>작년 감사보고서(.dsd)</b>
        <label className="btn-sm btn-sm-navy" style={{ cursor: 'pointer' }}>
          {dsd ? '다른 파일' : '파일 고르기'}
          <input type="file" accept=".dsd" style={{ display: 'none' }} onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {dsd ? (
          <>
            <span style={{ fontSize: 'var(--fs-2)', color: 'var(--good)' }}>
              ✓ <b>{dsd.name}</b> · 주석 {dsd.blocks.length}개 · 재무제표 {dsd.fs.length}줄
            </span>
            <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={clear}>비우기</button>
          </>
        ) : (
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
            ②③④ 가 모두 이 파일을 틀로 씁니다. 서버에 올리지 않고, 창을 닫으면 지워집니다.
          </span>
        )}
      </div>
      {err && <div style={{ marginTop: 7, fontSize: 'var(--fs-2)', color: 'var(--bad)' }}>{err}</div>}
      {odd && (
        <div style={{ marginTop: 7, fontSize: 'var(--fs-2)', color: 'var(--bad)', lineHeight: 1.6 }}>
          <b>회사가 다릅니다.</b> 고른 회사는 <b>{expect}</b> 인데 이 파일은 <b>{dsd!.company}</b> 의 것입니다.
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
 * 「다음 해로 이월」도 같은 까닭으로 여기 하나만 둔다 — 전에는 ②③④ 가 저마다 체크칸을 두어 어긋날 수 있었다(2026-10-05).
 */
export type NoteFrom = 'list' | 'file';

/** ②③④ 공통 작업 설정 — 평소엔 한 줄, 「설정 바꾸기」로 펼친다. */
export function WorkSettings(
  { dsd, from, set, listCount, fileCount, spare, setSpare, layout, roll, setRoll, goFirst }:
  {
    dsd: LoadedDsd; from: NoteFrom; set: (v: NoteFrom) => void; listCount: number; fileCount: number;
    spare: number; setSpare: (v: number) => void;
    /** 작업 건에 적힌 시트 구성 — 여기서는 보여만 준다. ① 에서 바꾼다. */ layout: SheetLayout;
    roll: boolean; setRoll: (v: boolean) => void; goFirst: () => void;
  },
) {
  const [open, setOpen] = useState(false);
  const n = from === 'list' ? listCount : fileCount;
  const dot = <span style={{ color: 'var(--ink-4)' }}>·</span>;
  return (
    <div className="card" style={{ padding: '8px 12px', background: 'var(--surface-2)' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 'var(--fs-1)', color: 'var(--ink-2)' }}>
        <span style={{ color: 'var(--ink-3)' }}>작업 설정</span>
        <span>틀 <b>{dsd.name}</b></span>{dot}
        <span>주석 <b>{n}개</b>{from === 'file' ? '(파일 전부)' : ''}</span>{dot}
        <span>{LAYOUT_LABEL[layout]}</span>{dot}
        <span>여분 행 {spare}</span>{dot}
        <span style={{ color: roll ? 'var(--good)' : 'var(--warn)', fontWeight: 600 }}>{roll ? '✓ 작년 값을 전기로 이월' : '이월 안 함(작년 그대로)'}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button className="btn-sm" onClick={goFirst}>틀 바꾸기</button>
          <button className="btn-sm" onClick={() => setOpen(!open)}>{open ? '접기 ▲' : '설정 바꾸기 ▼'}</button>
        </span>
      </div>
      {open && (
        <div style={{ marginTop: 8, background: '#fff', borderRadius: 'var(--r-sm)', padding: '0 12px 8px' }}>
          <Opt label="주석 목록" hint="② ③ ④ 가 같은 목록을 써야 시트 자리가 맞습니다.">
            <label style={{ marginRight: 16 }}>
              <input type="radio" checked={from === 'list'} onChange={() => set('list')} disabled={listCount === 0} /> ① 에서 켜 둔 것 {listCount}개
            </label>
            <label><input type="radio" checked={from === 'file'} onChange={() => set('file')} /> 올린 파일에 든 것 전부 {fileCount}개</label>
          </Opt>
          <Opt label="다음 해로 이월" hint="② 에서 이월해 만든 엑셀은 ③④ 도 이월로 읽어야 자리가 맞습니다 — 그래서 한곳에 둡니다.">
            <label><input type="checkbox" checked={roll} onChange={(e) => setRoll(e.target.checked)} /> 작년 당기 값을 전기 칸으로 밀고, 당기 칸은 비워 노랗게</label>
            <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>끄면 작년 보고서를 그대로 옮깁니다 — 작년 것을 확인할 때만 씁니다.</div>
          </Opt>
          <Opt label="여분 행" hint="표마다 합계 바로 위에 빈 줄을 깔아 둡니다. 첫 열에 적으면 ④ 가 줄을 짓고, 있던 줄의 첫 열을 지우면 그 줄을 없앱니다.">
            <input type="number" min={0} max={10} value={spare}
              onChange={(e) => setSpare(Math.max(0, Math.min(10, Math.floor(Number(e.target.value) || 0))))}
              className="btn-sm" style={{ width: 56, textAlign: 'right' }} /> 줄 <span style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)' }}>— 거래처가 늘 표에 미리 깔 빈 줄</span>
          </Opt>
          <div style={{ fontSize: 'var(--fs-1)', color: 'var(--bad)', paddingTop: 6 }}>② 로 엑셀을 만든 뒤에는 바꾸지 마십시오 — ③④ 가 같은 설정으로 자리를 찾습니다.</div>
        </div>
      )}
    </div>
  );
}

export interface TabDef {
  key: string;
  no: string;
  label: string;
  /** 감사 시점 — 일반조서와 같은 말(중간감사·기말감사) */ when: string;
  /** 이 탭을 쓰려면 작년 감사보고서가 있어야 하는가 */ needsDsd?: boolean;
}

/** 단계 탭 — 감사 흐름 차례로 크게. */
export function DsdTabs(
  { tabs, at, go, hasDsd }: { tabs: TabDef[]; at: string; go: (k: string) => void; hasDsd: boolean },
) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`, gap: 8, margin: '2px 0 10px' }}>
      {tabs.map((t) => {
        const on = t.key === at;
        const locked = t.needsDsd && !hasDsd;
        return (
          <button key={t.key} onClick={() => go(t.key)} title={locked ? '① 에서 작년 감사보고서(.dsd)를 먼저 올리세요' : undefined}
            style={{
              textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', padding: '8px 12px',
              borderRadius: 'var(--r-sm)', border: `1.5px solid ${on ? 'var(--navy)' : 'var(--rule)'}`,
              background: on ? 'var(--navy)' : '#fff', opacity: locked && !on ? 0.5 : 1,
            }}>
            <div style={{ fontSize: 'var(--fs-1)', color: on ? 'rgba(255,255,255,.75)' : 'var(--ink-3)' }}>{t.when}</div>
            <div style={{ fontSize: 'var(--fs-3)', fontWeight: 700, color: on ? '#fff' : 'var(--navy)', marginTop: 1 }}>
              {t.no} {t.label}{locked ? ' 🔒' : ''}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** 작년 감사보고서가 없을 때 탭 자리에 띄우는 안내. */
export function NeedDsd({ goFirst }: { goFirst: () => void }) {
  return (
    <div className="card" style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-2)', lineHeight: 1.7, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span><b>① 작년 보고서</b>에서 감사보고서(.dsd)를 먼저 올려 주세요 — ②③④ 가 모두 그 파일을 틀로 씁니다.</span>
      <button className="btn-sm btn-sm-navy" onClick={goFirst}>① 로 가기</button>
    </div>
  );
}
