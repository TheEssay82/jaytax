// 질문·기재형 조서 입력(소규모 2520·2530) — 질문마다 「파악한 내용」·「별도 조서번호」·수행자. 초안에서 채운 칸은 표시한다.
import type { PaperQA, QaItem } from '../../lib/gwpPaperQA';

export default function FormQA({ value, onChange, readOnly, draft, author }: {
  value: PaperQA;
  onChange: (v: PaperQA) => void;
  readOnly: boolean;
  /** 초안 — 「초안으로」 버튼 */ draft: Pick<QaItem, 'text' | 'ref'>[] | null;
  author: string | null;
}) {
  if (!value.items.length) {
    return <div style={{ color: 'var(--warn)' }}>이 시트에서 「-상기 파악한 내용의 기재 …」 줄을 찾지 못했습니다 — ① 올해 파일의 「소규모 짝 정리」를 먼저 하세요.</div>;
  }
  const set = (i: number, p: Partial<QaItem>) => onChange({ items: value.items.map((x, j) => (j === i ? { ...x, ...p, draft: false } : x)) });
  const drafts = value.items.filter((x) => x.draft).length;
  return (
    <div style={{ fontSize: 'var(--fs-2)' }}>
      <div style={{ color: 'var(--ink-2)', lineHeight: 1.7, marginBottom: 8 }}>
        {drafts > 0 && <><b style={{ background: '#FFFF00', color: '#000', padding: '0 4px' }}>초안</b> 표시 칸 {drafts}개는 작년 조서·전기 재무제표에서 가져온 초안입니다 — <b>회사 사실과 맞는지 확인하고 고치세요.</b> </>}
        짧게 적어도 됩니다. 다른 조서에서 검토했으면 조서번호만 적어도 됩니다.
      </div>
      {!readOnly && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          {author && <button className="btn-sm" onClick={() => onChange({ items: value.items.map((x) => ({ ...x, performer: author })) })}>수행자를 모두 {author}로</button>}
          {draft && <button className="btn-sm" onClick={() => onChange({ items: value.items.map((x, i) => (draft[i] ? { ...x, ...draft[i], draft: true } : x)) })}>모두 초안으로 되돌리기</button>}
        </div>
      )}
      {value.items.map((x, i) => (
        <div key={i} style={{ borderTop: '1px solid var(--line)', padding: '8px 0' }}>
          {x.group && (i === 0 || value.items[i - 1].group !== x.group) && <div style={{ fontWeight: 700, marginBottom: 4 }}>{x.group}</div>}
          <div style={{ color: 'var(--ink-2)', lineHeight: 1.5 }}>{x.q}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 100px', gap: 6, marginTop: 4, alignItems: 'start' }}>
            <textarea className="btn-sm" rows={2} value={x.text} disabled={readOnly} placeholder="파악한 내용"
              style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5, background: x.draft ? '#FFFFE0' : undefined }}
              onChange={(e) => set(i, { text: e.target.value })} />
            <input className="btn-sm" value={x.ref} disabled={readOnly} placeholder="조서번호" onChange={(e) => set(i, { ref: e.target.value })} />
            <input className="btn-sm" value={x.performer} disabled={readOnly} placeholder="수행자" onChange={(e) => set(i, { performer: e.target.value })} />
          </div>
        </div>
      ))}
    </div>
  );
}
