// 질의회신요약 인덱스 생성 — KASB 공개 열람서비스의 백엔드 API에서 목록을 받아
// '경량 인덱스'(제목·문서번호·날짜·관련기준 + 원문 링크)만 추출해 public/qnas-index.json 으로 저장한다.
//
// 저작권: 질의회신 본문은 한국회계기준원(KASB) 저작물이다. 본문(content/answer 등)은 저장하지 않고,
// 탐색·연결용 메타와 원문 링크만 보관한다(도서관 카탈로그 = 포인터). 본문은 link 로 KASB 원문을 연다.
// 주의: /api/qnas 는 KASB의 비공식(내부) 엔드포인트다. 변경될 수 있으므로 이 스크립트로 재생성한다.
// 사용: npm run std:fetch:qnas
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './lib.ts';

const API = 'https://db.kasb.or.kr/api/qnas';
const LINK = (id: number | string) => `https://db.kasb.or.kr/qnas/${id}`;

interface RawQna {
  id: number;
  docNumber?: string;
  date?: string;
  title?: string;
  relStds?: string;
  deprecatedYn?: number;
  delYn?: number;
}

interface QnaIndexItem {
  id: number;
  docNumber: string | null;
  date: string | null;
  title: string;
  relStds: string | null;
  deprecated: boolean;
  link: string;
}

const res = await fetch(API, { headers: { Accept: 'application/json' } });
if (!res.ok) throw new Error(`KASB API 실패 ${res.status}: ${await res.text()}`);
const json = (await res.json()) as { status?: number; count?: number; qnas?: RawQna[] };
const raw = json.qnas ?? [];
console.log(`KASB 질의회신 ${raw.length}건 수신 (count=${json.count ?? '?'})`);

const index: QnaIndexItem[] = raw
  .filter((q) => q.delYn !== 1)
  .map((q) => ({
    id: q.id,
    docNumber: q.docNumber || null,
    date: q.date || null,
    title: (q.title || '').trim(),
    relStds: q.relStds ? q.relStds.trim() : null,
    deprecated: q.deprecatedYn === 1,
    link: LINK(q.id),
  }))
  .filter((q) => q.title);

const outPath = resolve(ROOT, 'public/qnas-index.json');
const payload = {
  source: 'KASB 회계기준열람서비스 (db.kasb.or.kr) — 제목·메타 인덱스(본문 미포함, 원문 링크)',
  fetchedAt: new Date().toISOString().slice(0, 10),
  count: index.length,
  items: index,
};
writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
console.log(`인덱스 저장: ${outPath} (${index.length}건, ${(JSON.stringify(payload).length / 1024).toFixed(0)} KB)`);
