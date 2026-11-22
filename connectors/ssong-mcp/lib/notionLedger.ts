// 쏭비서 「업무 장부」(Notion DB) — 조회와 정해진 칸 고치기만.
// 열쇠: Vercel env NOTION_TOKEN(내부 통합, 「쏭비서」 페이지에 연결). 지우기·새 줄은 없다.
// 「최근 경과」는 코드가 맨 앞에 `날짜 사용자 확인: 한 줄 / ` 을 붙인다 — 원래 글(서식 포함)은 그대로 둔다(CLAUDE.md 업무 규칙).

const API = 'https://api.notion.com/v1';
const VERSION = '2025-09-03';
export const LEDGER_DS = process.env.NOTION_LEDGER_DS?.trim() || '41bec7ea-20d0-818c-8f29-000b3093225b';
export const STATUSES = ['진행', '자료 대기', '회신 대기', '확인 필요', '보류', '완료'] as const;

export class LedgerError extends Error {}
export const ledgerEnabled = () => Boolean((process.env.NOTION_TOKEN ?? '').trim());

async function notion<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const token = (process.env.NOTION_TOKEN ?? '').trim();
  if (!token) throw new LedgerError('서버 설정이 빠졌습니다: NOTION_TOKEN');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': VERSION, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { const j = JSON.parse(text) as { message?: string }; if (j.message) msg = j.message; } catch { /* 그대로 */ }
    throw new LedgerError(`Notion ${res.status}: ${msg}`);
  }
  return JSON.parse(text) as T;
}

type RichText = { type: string; plain_text: string; text?: { content: string; link: { url: string } | null }; annotations?: unknown; href?: string | null };
type Prop =
  | { type: 'title'; title: RichText[] } | { type: 'rich_text'; rich_text: RichText[] }
  | { type: 'select'; select: { name: string } | null } | { type: 'date'; date: { start: string; end: string | null } | null }
  | { type: 'url'; url: string | null } | { type: string; [k: string]: unknown };
interface Page { id: string; url: string; properties: Record<string, Prop>; last_edited_time?: string }

const plain = (rt: RichText[] | undefined) => (rt ?? []).map((r) => r.plain_text).join('');

export function textOf(p: Prop | undefined): string {
  if (!p) return '';
  if (p.type === 'title') return plain((p as { title: RichText[] }).title);
  if (p.type === 'rich_text') return plain((p as { rich_text: RichText[] }).rich_text);
  if (p.type === 'select') return (p as { select: { name: string } | null }).select?.name ?? '';
  if (p.type === 'url') return (p as { url: string | null }).url ?? '';
  if (p.type === 'date') {
    const d = (p as { date: { start: string; end: string | null } | null }).date;
    return d ? (d.end ? `${d.start}~${d.end}` : d.start) : '';
  }
  return '';
}

export interface LedgerRow {
  pageId: string; 건: string; 거래처: string; 업무: string; 상태: string; 현재단계: string;
  다음할일: string; 다음마감: string; 담당: string; 함께하는사람: string; 최근경과: string; 자료위치: string;
}

export function rowOf(p: Page, progressChars = 300): LedgerRow {
  const g = (k: string) => textOf(p.properties[k]);
  const prog = g('최근 경과');
  return {
    pageId: p.id, 건: g('건'), 거래처: g('거래처'), 업무: g('업무'), 상태: g('상태'), 현재단계: g('현재 단계'),
    다음할일: g('다음 할 일'), 다음마감: g('다음 마감'), 담당: g('담당'), 함께하는사람: g('함께 하는 사람'),
    최근경과: prog.length > progressChars ? `${prog.slice(0, progressChars)}…` : prog, 자료위치: g('자료 위치'),
  };
}

/** 완료가 아닌 줄(includeDone 이면 전부). q 는 건·거래처·다음 할 일·현재 단계에서 찾는다. */
export async function listLedger(opts: { q?: string; includeDone?: boolean } = {}): Promise<LedgerRow[]> {
  const rows: LedgerRow[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const r = await notion<{ results: Page[]; has_more: boolean; next_cursor: string | null }>('POST', `/data_sources/${LEDGER_DS}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
      ...(opts.includeDone ? {} : { filter: { property: '상태', select: { does_not_equal: '완료' } } }),
      sorts: [{ property: '다음 마감', direction: 'ascending' }],
    });
    rows.push(...r.results.map((p) => rowOf(p)));
    if (!r.has_more || !r.next_cursor) break;
    cursor = r.next_cursor;
  }
  const q = opts.q?.trim();
  if (!q) return rows;
  return rows.filter((x) => [x.건, x.거래처, x.다음할일, x.현재단계, x.담당].some((v) => v.includes(q)));
}

/** 응답의 rich_text 를 다시 쓸 수 있는 모양으로(글 조각은 서식 유지, 나머지는 글자로). */
export function toWritable(rt: RichText[]): unknown[] {
  return rt.map((r) => r.type === 'text' && r.text
    ? { type: 'text', text: { content: r.text.content, link: r.text.link }, ...(r.annotations ? { annotations: r.annotations } : {}) }
    : { type: 'text', text: { content: r.plain_text } });
}

/** 2000자 넘는 글은 조각으로(Notion 한 조각 한도). */
export function chunks(s: string, n = 2000): { type: 'text'; text: { content: string } }[] {
  const out: { type: 'text'; text: { content: string } }[] = [];
  for (let i = 0; i < s.length; i += n) out.push({ type: 'text', text: { content: s.slice(i, i + n) } });
  return out;
}

export const progressPrefix = (date: string, line: string) => `${date} 사용자 확인: ${line.replace(/\s+/g, ' ').trim()} / `;

export interface LedgerUpdate {
  page_id: string; today: string; progress?: string; next_action?: string; next_deadline?: string | null;
  stage?: string; status?: (typeof STATUSES)[number];
}

/** 고칠 값만 Notion 속성으로. 최근 경과는 원래 조각 앞에 새 조각을 붙인다. */
export function buildProperties(u: LedgerUpdate, currentProgress: RichText[]): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  if (u.progress?.trim()) {
    const rest = toWritable(currentProgress);
    const head = chunks(progressPrefix(u.today, u.progress));
    props['최근 경과'] = { rich_text: [...head, ...rest].slice(0, 100) };
  }
  if (u.next_action !== undefined) props['다음 할 일'] = { rich_text: chunks(u.next_action) };
  if (u.stage !== undefined) props['현재 단계'] = { rich_text: chunks(u.stage) };
  if (u.next_deadline !== undefined) props['다음 마감'] = { date: u.next_deadline ? { start: u.next_deadline } : null };
  if (u.status !== undefined) props['상태'] = { select: { name: u.status } };
  return props;
}

export async function updateLedger(u: LedgerUpdate): Promise<{ before: LedgerRow; after: LedgerRow }> {
  const page = await notion<Page & { parent?: { data_source_id?: string; database_id?: string } }>('GET', `/pages/${u.page_id}`);
  const parentDs = page.parent?.data_source_id?.replace(/-/g, '');
  if (parentDs && parentDs !== LEDGER_DS.replace(/-/g, '')) throw new LedgerError('업무 장부의 줄이 아닙니다');
  const cur = page.properties['최근 경과'];
  const curRt = cur && cur.type === 'rich_text' ? (cur as { rich_text: RichText[] }).rich_text : [];
  const props = buildProperties(u, curRt);
  if (!Object.keys(props).length) throw new LedgerError('고칠 값이 없습니다');
  const after = await notion<Page>('PATCH', `/pages/${u.page_id}`, { properties: props });
  return { before: rowOf(page), after: rowOf(after) };
}
