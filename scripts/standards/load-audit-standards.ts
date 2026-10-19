// 회계감사기준 전문(한 권짜리 PDF) → 감사기준서별로 나눠 원문 청크 + 임베딩 → standard_fulltext 적재.
// 상담(consult)의 원문 근거 검색에 감사기준이 잡히게 한다 — standard_set '회계감사기준', standard_no '200'·'315'….
//
// 나누는 법: 감사기준서마다 첫 쪽이 '목차' 쪽이다(머리 「감사기준서 NNN」 + '목차'). 그 쪽부터 다음 기준서 목차 앞까지.
//   쪽 머리(「감사기준서 NNN ‘제목’」)는 틀린 곳이 있어(600 보론 쪽에 610 머리) 쓰지 않는다.
// 청크: 문단번호(1. · A1.)에서 끊어 문단 하나 안팎(350~1200자). 청크 앞에 [감사기준서 315 · 적용 및 기타 설명자료 · 소제목] 을 붙여
//   발췌만 받아도 어느 기준서·어느 부분인지 안다(답변이 문단번호와 함께 인용할 수 있게).
//
// 사용: npm run std:load:audit -- "<회계감사기준 전문.pdf>" [--dry] [--no 315]
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { adminClient, embedBatch, hashContent, estimateTokens } from './lib.ts';
import { CATALOG } from '../../src/lib/standardsCatalog.ts';

const SET = '회계감사기준';
const cat = CATALOG.find((c) => c.set === SET);
if (!cat) throw new Error(`카탈로그에 ${SET} 가 없습니다.`);
const TITLES = new Map(cat.groups.flatMap((g) => g.items).filter((i) => /^\d+$/.test(i.no)).map((i) => [i.no, i.title]));

const PARA = /^(\d{1,3}|A\d{1,3})\.\s/;                         // 본문 문단 1. / 적용지침 A1.
const SUB = /^(\([a-z]{1,5}\)|\(\d{1,2}\)|[○•]|①|②|③|④|⑤)/;   // (a) (i) (1) 글머리
const PART = /^(서론|목적|용어의 정의|요구사항|적용 및 기타 설명자료|보론\s*\d*)/;

interface Line { text: string; size: number; fonts: string[]; lead: boolean; trail: boolean; bold?: boolean }

/** 쪽 하나 → 본문 줄들. 쪽 머리·쪽번호(8pt)·각주(8pt)·각주 번호(5~6.5pt)는 글자 크기로 뺀다 — 그 쪽 본문 크기의 0.9배 미만.
 *  목차 점선 줄도 뺀다. 본문 글꼴이 한 글자도 없는 줄 = 굵은 제목(서론·요구사항… 과 그 아래 소제목). */
function bodyLines(lines: Line[]): Line[] {
  const freq = new Map<number, number>();
  for (const l of lines) if (l.text.trim()) freq.set(l.size, (freq.get(l.size) ?? 0) + l.text.length);
  const body = [...freq.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 10;
  const ff = new Map<string, number>();
  for (const l of lines) if (l.size === body) for (const f of l.fonts) ff.set(f, (ff.get(f) ?? 0) + l.text.length);
  const bodyFont = [...ff.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '';
  return lines
    .filter((l) => l.text.trim() && l.size >= body * 0.9 && !/\.{5,}/.test(l.text))
    .map((l) => ({ ...l, bold: !l.fonts.includes(bodyFont), text: l.text.replace(/[\uE000-\uF8FF]/g, '•').trim() }));   // 글머리표(사용자 정의 글자) → •
}

interface Block { text: string; head: string }

/** 줄들 → 덩어리(문단·글머리·소제목). 줄바꿈은 원문에 빈칸이 있었을 때만 빈칸으로 잇는다(한글 낱말 중간 줄바꿈). */
function toBlocks(lines: Line[]): Block[] {
  const blocks: Block[] = [];
  let part = '';
  let sub = '';
  let cur: Line | null = null;
  const flush = () => {
    if (!cur) return;
    const t = cur.text.trim();
    const bold = cur.bold && !PARA.test(t) && !SUB.test(t);
    cur = null;
    if (!t) return;
    // 소제목: 굵은 글꼴이거나, 짧고 문장이 아닌(마침표 없음) 줄 — 적용지침의 「…(문단 7(a) 참조)」 같은 것.
    if (bold || (!PARA.test(t) && !SUB.test(t) && t.length < 60 && !/[.다]$/.test(t) && !/\.\s/.test(t))) {
      if (PART.test(t)) { part = t; sub = ''; } else sub = t;
      return;
    }
    blocks.push({ text: t, head: [part, sub].filter(Boolean).join(' · ') });
  };
  for (const ln of lines) {
    const ended = cur && /([.:]|참조\)|다\.)$/.test(cur.text.trim());
    if (!cur || PARA.test(ln.text) || SUB.test(ln.text) || ended || ln.bold || cur.bold) {   // 굵은 제목은 한 줄씩
      flush();
      cur = { ...ln };
    } else {
      cur.text += (cur.trail || ln.lead ? ' ' : '') + ln.text;
      cur.trail = ln.trail;
    }
  }
  flush();
  return blocks;
}

/** 덩어리 → 청크. 문단번호에서 끊되 350자 이상 모였을 때(대개 문단 하나 = 청크 하나), 1200자를 넘기면 아무 덩어리 경계에서.
 *  처음엔 600~1500자로 묶었더니 짧은 질문에 유사도가 흐려져(0.45) K-IFRS 잡음(0.55)에 밀렸다. */
function toChunks(no: string, blocks: Block[]): string[] {
  const chunks: string[] = [];
  let cur: string[] = [];
  let len = 0;
  let head = '';
  const push = () => {
    if (len >= 60) chunks.push(`[감사기준서 ${no}${head ? ` · ${head}` : ''}]\n${cur.join('\n')}`);
    cur = []; len = 0;
  };
  for (const b of blocks) {
    const pieces = b.text.length > 1800 ? b.text.match(/[^]{1,1200}(?:다\.\s?|$)/g) ?? [b.text] : [b.text];
    for (const p of pieces) {
      const newPart = cur.length && b.head.split(' · ')[0] !== head.split(' · ')[0];   // 요구사항 → 적용지침 등 큰 제목이 바뀌면 끊는다
      if (cur.length && (newPart || (PARA.test(p) && len >= 350) || len + p.length > 1200)) push();
      if (!cur.length) head = b.head;
      cur.push(p.trim());
      len += p.length;
    }
  }
  push();
  return chunks;
}

// ── 실행 ──────────────────────────────────────────────
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const onlyNo = args.includes('--no') ? args[args.indexOf('--no') + 1] : null;
const file = args.find((a) => !a.startsWith('--') && a !== onlyNo);
if (!file) {
  console.error('사용: npm run std:load:audit -- "<회계감사기준 전문.pdf>" [--dry] [--no <번호>]');
  process.exit(1);
}

const pages: Line[][] = [];
type Item = { str: string; transform: number[]; fontName: string };
await pdf(readFileSync(resolve(file)), {
  pagerender: async (p: { getTextContent: () => Promise<{ items: Item[] }> }) => {
    const tc = await p.getTextContent();
    const lines: Line[] = [];
    let last: number | null = null;
    let s = '';
    let size = 0;
    let fonts = new Set<string>();
    const end = () => { lines.push({ text: s, size, fonts: [...fonts], lead: /^\s/.test(s), trail: /\s$/.test(s) }); s = ''; size = 0; fonts = new Set(); };
    for (const it of tc.items) {
      const y = it.transform[5];
      if (last !== null && Math.abs(y - last) > 2) end();
      s += it.str;
      if (it.str.trim()) { size = Math.max(size, Math.round(Math.abs(it.transform[3]) * 10) / 10); fonts.add(it.fontName); }
      last = y;
    }
    end();
    pages.push(lines);
    return '';
  },
});

// 기준서별 시작 쪽(목차 쪽) — 쪽번호 줄 다음에 「감사기준서 NNN」, 앞 몇 줄 안에 '목차'.
const starts: { no: string; page: number }[] = [];
pages.forEach((p, i) => {
  const ls = p.map((l) => l.text.trim()).filter(Boolean).slice(0, 5);
  const m = ls[1]?.match(/^감사기준서 (\d+)$/);
  if (/^\d+ \/ \d+$/.test(ls[0] ?? '') && m && ls.includes('목차')) starts.push({ no: m[1], page: i });
});
const missing = [...TITLES.keys()].filter((n) => !starts.some((s) => s.no === n));
if (missing.length) throw new Error(`목차 쪽을 못 찾은 기준서: ${missing.join(', ')}`);
console.log(`쪽 ${pages.length} · 기준서 ${starts.length}개`);

const sb = dry ? null : adminClient();
let total = 0;
for (let k = 0; k < starts.length; k++) {
  const { no, page } = starts[k];
  if (onlyNo && no !== onlyNo) continue;
  const end = k + 1 < starts.length ? starts[k + 1].page : pages.length;
  const title = TITLES.get(no) ?? '';
  const lines = pages.slice(page + 1, end).flatMap(bodyLines);   // 첫 쪽은 목차
  const chunks = toChunks(no, toBlocks(lines));
  total += chunks.length;
  console.log(`· 감사기준서 ${no} ${title} — 쪽 ${page + 1}~${end} · 청크 ${chunks.length}`);
  if (dry) {
    if (onlyNo) chunks.slice(0, 6).forEach((c, i) => console.log(`\n--- #${i} (${c.length}자)\n${c}`));
    continue;
  }
  const embs = await embedBatch(chunks.map((c) => `${SET} 감사기준서 ${no} ${title}\n${c}`));
  const { error: delErr } = await sb!.from('standard_fulltext').delete().eq('standard_set', SET).eq('standard_no', no);
  if (delErr) throw new Error(`삭제 실패 ${no}: ${delErr.message}`);
  const rows = chunks.map((c, i) => ({
    standard_set: SET, standard_no: no, standard_title: title, chunk_index: i,
    content: c, token_count: estimateTokens(c), content_hash: hashContent(c), embedding: embs[i],
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb!.from('standard_fulltext').insert(rows.slice(i, i + 200));
    if (error) throw new Error(`적재 실패 ${no}: ${error.message}`);
  }
}
console.log(`\n${dry ? '[dry] ' : ''}청크 합계 ${total}`);
