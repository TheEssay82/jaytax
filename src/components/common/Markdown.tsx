// 경량 마크다운 렌더러 — 상담 회신이 쓰는 형식(제목 #/##/###, **굵게**, 번호·불릿 목록, ---, 문단)만
// 의존성 없이 깔끔한 타이포그래피로 렌더한다. 편집용이 아닌 '읽기 표시'에만 사용.
//  - boxed: ## 챕터(제목+본문)를 연한 박스로 묶는다.
//  - hideFirstH1: 맨 앞 # 제목을 생략(별도로 제목을 이미 보여줄 때 중복 방지).
import type { ReactNode, CSSProperties } from 'react';

// **굵게** 인라인 처리
function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>,
  );
}

type Block = { type: 'h1' | 'h2' | 'h3' | 'hr'; node: ReactNode } | { type: 'flow'; node: ReactNode };

export default function Markdown({ text, style, boxed = false, hideFirstH1 = false }: {
  text: string; style?: CSSProperties; boxed?: boolean; hideFirstH1?: boolean;
}) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let k = 0;

  const flushPara = () => {
    if (para.length) { blocks.push({ type: 'flow', node: <p key={k++} style={pStyle}>{para.flatMap((l, i) => (i ? [<br key={`b${i}`} />, ...inline(l)] : inline(l)))}</p> }); para = []; }
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((it, i) => <li key={i} style={liStyle}>{inline(it)}</li>);
      blocks.push({ type: 'flow', node: list.ordered ? <ol key={k++} style={olStyle}>{items}</ol> : <ul key={k++} style={ulStyle}>{items}</ul> });
      list = null;
    }
  };
  const flushAll = () => { flushPara(); flushList(); };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (!t) { flushAll(); continue; }

    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushAll();
      const lvl = h[1].length;
      const type = lvl === 1 ? 'h1' : lvl === 2 ? 'h2' : 'h3';
      blocks.push({ type, node: <div key={k++} style={headingStyle(lvl, boxed)}>{inline(h[2])}</div> });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { flushAll(); blocks.push({ type: 'hr', node: <hr key={k++} style={hrStyle} /> }); continue; }

    const ol = t.match(/^(\d+)[.)]\s+(.*)$/);
    if (ol) { flushPara(); if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] }; } list.items.push(ol[2]); continue; }
    const ul = t.match(/^[-*•]\s+(.*)$/);
    if (ul) { flushPara(); if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] }; } list.items.push(ul[1]); continue; }

    flushList();
    para.push(t);
  }
  flushAll();

  // 맨 앞 # 제목 생략(중복 방지)
  let start = 0;
  if (hideFirstH1 && blocks[0]?.type === 'h1') start = 1;
  const shown = blocks.slice(start);

  if (!boxed) {
    return <div style={{ ...rootStyle, ...style }}>{shown.map((b) => b.node)}</div>;
  }

  // boxed: h2를 만나면 새 박스 시작. h1/hr/첫 h2 앞 내용은 박스 밖(상단)에 렌더.
  const nodes: ReactNode[] = [];
  let box: ReactNode[] | null = null;
  let bi = 0;
  const closeBox = () => { if (box) { nodes.push(<section key={`box${bi++}`} style={boxStyle}>{box}</section>); box = null; } };
  for (const b of shown) {
    if (b.type === 'h2') { closeBox(); box = [b.node]; continue; }
    if (b.type === 'h1' || b.type === 'hr') { closeBox(); nodes.push(b.node); continue; }
    if (box) box.push(b.node); else nodes.push(b.node);
  }
  closeBox();

  return <div style={{ ...rootStyle, ...style }}>{nodes}</div>;
}

const rootStyle: CSSProperties = { color: '#1f2937', fontSize: 14, lineHeight: 1.75 };
const pStyle: CSSProperties = { margin: '0 0 12px', lineHeight: 1.75 };
const ulStyle: CSSProperties = { margin: '0 0 12px', paddingLeft: 20 };
const olStyle: CSSProperties = { margin: '0 0 12px', paddingLeft: 22 };
const liStyle: CSSProperties = { margin: '0 0 6px', lineHeight: 1.7 };
const hrStyle: CSSProperties = { border: 'none', borderTop: '1px solid #ece8e0', margin: '18px 0' };
const boxStyle: CSSProperties = {
  background: '#faf9f4', border: '1px solid #ece7dd', borderRadius: 12, padding: '14px 18px 4px', marginBottom: 12,
};

function headingStyle(lvl: number, boxed: boolean): CSSProperties {
  if (lvl === 1) return { fontSize: 18, fontWeight: 800, color: '#1A2B52', margin: '4px 0 14px', lineHeight: 1.4, letterSpacing: '-0.01em' };
  if (lvl === 2) return boxed
    ? { fontSize: 14.5, fontWeight: 700, color: '#1A2B52', margin: '0 0 10px' }
    : { fontSize: 14.5, fontWeight: 700, color: '#1A2B52', margin: '20px 0 8px', paddingBottom: 5, borderBottom: '1.5px solid #ece7dd' };
  return { fontSize: 13.5, fontWeight: 700, color: '#3a4a6b', margin: '14px 0 6px' };
}
