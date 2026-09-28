// 질문·기재형 조서 입력(소규모 2520·2530) — 질문마다 「파악한 내용」·「별도 조서번호」·수행자. 초안에서 채운 칸은 표시한다.
// 회사마다 다른 사실(회계처리를 누가 하나)은 맨 위에서 한 번 고르면 초안 칸이 모두 바뀐다. ○○ 는 채워야 [확인]된다.
import { BLANK, KEEPERS, redraft, type DraftCtx, type DraftItem, type FsFact, type Keeper, type PaperQA, type QaItem } from '../../lib/gwpPaperQA';

export default function FormQA({ value, onChange, readOnly, draft, fs, author }: {
  value: PaperQA;
  onChange: (v: PaperQA) => void;
  readOnly: boolean;
  /** 초안 만들기 — 「회계처리를 누가」·「초안으로 되돌리기」 */ draft: ((c: DraftCtx) => DraftItem[]) | null;
  /** 2120A 재무제표 — 초안의 거래유형·회계추정 */ fs: FsFact[] | null;
  author: string | null;
}) {
  if (!value.items.length) {
    return <div style={{ color: 'var(--warn)' }}>이 시트에서 「-상기 파악한 내용의 기재 …」 줄을 찾지 못했습니다 — ① 올해 파일의 「소규모 짝 정리」를 먼저 하세요.</div>;
  }
  const set = (i: number, p: Partial<QaItem>) => onChange({ ...value, items: value.items.map((x, j) => (j === i ? { ...x, ...p, draft: false } : x)) });
  const keeper = value.keeper ?? null;
  const pickKeeper = (k: Keeper) => onChange(draft ? { ...redraft(value, draft({ fs, keeper: k })), keeper: k } : { ...value, keeper: k });
  const drafts = value.items.filter((x) => x.draft).length;
  const blanks = value.items.filter((x) => x.text.includes(BLANK)).length;
  return (
    <div style={{ fontSize: 'var(--fs-2)' }}>
      {draft && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, padding: '6px 8px', background: 'var(--surface-2)', borderRadius: 6 }}>
          <b>회계처리는 누가?</b>
          {KEEPERS.map((k) => (
            <button key={k.key} className={`btn-sm${keeper === k.key ? ' btn-sm-navy' : ''}`} disabled={readOnly} onClick={() => pickKeeper(k.key)}>{k.label}</button>
          ))}
          <span style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)' }}>고르면 초안 칸의 문장이 그에 맞게 바뀝니다(직접 고친 칸은 그대로).</span>
        </div>
      )}
      <div style={{ color: 'var(--ink-2)', lineHeight: 1.7, marginBottom: 8 }}>
        {drafts > 0 && <><b style={{ background: '#FFFF00', color: '#000', padding: '0 4px' }}>초안</b> 표시 칸 {drafts}개는 {fs ? '2120A 재무제표 계정으로 만든' : '일반적인'} 초안입니다 — <b>회사 사실과 맞는지 확인하고 고치세요.</b> </>}
        {blanks > 0 && <span style={{ color: 'var(--warn)' }}><b>{BLANK}</b> 자리 {blanks}곳을 채워야 [확인]됩니다{!fs ? ' (2120A 를 먼저 저장하면 거래유형·회계추정이 채워집니다)' : ''}. </span>}
        짧게 적어도 됩니다. 다른 조서에서 검토했으면 조서번호만 적어도 됩니다.
      </div>
      {!readOnly && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          {author && <button className="btn-sm" onClick={() => onChange({ ...value, items: value.items.map((x) => ({ ...x, performer: author })) })}>수행자를 모두 {author}로</button>}
          {draft && <button className="btn-sm" onClick={() => { const d = draft({ fs, keeper }); onChange({ ...value, items: value.items.map((x, i) => (d[i] ? { ...x, ...d[i], draft: true } : x)) }); }}>모두 초안으로 되돌리기</button>}
        </div>
      )}
      {value.items.map((x, i) => (
        <div key={i} style={{ borderTop: '1px solid var(--line)', padding: '8px 0' }}>
          {x.group && (i === 0 || value.items[i - 1].group !== x.group) && <div style={{ fontWeight: 700, marginBottom: 4 }}>{x.group}</div>}
          <div style={{ color: 'var(--ink-2)', lineHeight: 1.5 }}>{x.q}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 100px', gap: 6, marginTop: 4, alignItems: 'start' }}>
            <textarea className="btn-sm" rows={2} value={x.text} disabled={readOnly} placeholder="파악한 내용"
              style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5, background: x.text.includes(BLANK) ? '#FFE4E1' : x.draft ? '#FFFFE0' : undefined }}
              onChange={(e) => set(i, { text: e.target.value })} />
            <input className="btn-sm" value={x.ref} disabled={readOnly} placeholder="조서번호" onChange={(e) => set(i, { ref: e.target.value })} />
            <input className="btn-sm" value={x.performer} disabled={readOnly} placeholder="수행자" onChange={(e) => set(i, { performer: e.target.value })} />
          </div>
        </div>
      ))}
    </div>
  );
}
