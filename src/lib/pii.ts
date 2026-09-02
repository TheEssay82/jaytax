// 개인정보 마스킹 — Anthropic API 로 나가기 전에 반드시 통과하는 관문.
//
// 개인정보보호법 제28조의8(국외이전). 의뢰인의 성명·주민등록번호·사업자등록번호·
// 연락처·주소는 **API 로 보내지 않는다**. 여기서 플레이스홀더로 바꾸고, 답변을 받은
// 뒤에 원래 값으로 되돌린다. 원문은 브라우저 밖으로 나가지 않는다.
//
// 설계에서 지킨 것
//  - **되돌릴 수 있어야 한다.** 회신 초안에 "{인명1} 대표"처럼 남으면 사람이 못 읽는다.
//    치환표를 들고 있다가 답변에서 되돌린다.
//  - **같은 값은 같은 자리표.** 한 질문 안에서 같은 사람이 여러 번 나오면 같은 번호를
//    받아야 문맥이 유지된다.
//  - **긴 것부터 지운다.** 주민번호(6-7)와 법인등록번호가 모양이 같고, 사업자번호가
//    전화번호 안에 들어 있는 일이 있어 순서를 잘못 잡으면 반쪽만 지워진다.
//  - **못 지운 것은 알린다.** 자동으로 잡히지 않는 성명은 거래처 명부로 잡고,
//    그래도 남은 주민번호 모양이 있으면 전송을 막는다.

export type PiiKind = '주민번호' | '법인등록번호' | '사업자번호' | '연락처' | '이메일' | '계좌번호' | '주소' | '인명';

export interface PiiHit {
  kind: PiiKind;
  /** 원문 값. 화면에 무엇이 가려졌는지 보여 줄 때만 쓰고, 절대 전송하지 않는다. */
  value: string;
  /** 치환된 자리표 (예: '{주민번호1}'). */
  token: string;
}

export interface MaskResult {
  /** API 로 보내도 되는 본문. */
  masked: string;
  /** 자리표 → 원문. 답변을 되돌릴 때 쓴다. */
  map: Record<string, string>;
  /** 무엇을 몇 개 가렸는지 — 화면에 그대로 보여 준다. */
  hits: PiiHit[];
}

/** 자리표 모양. 한글 대괄호 대신 중괄호를 쓴다 — 모델이 그대로 살려 두는 편이다. */
const token = (kind: PiiKind, n: number) => `{${kind}${n}}`;

/**
 * 패턴 정의. **순서가 규칙의 일부다** — 위에서부터 지운다.
 * 주민등록번호와 법인등록번호는 둘 다 6-7 자리라 모양만으로는 갈리지 않는다.
 * 앞 6자리가 날짜로 읽히면(월 01~12, 일 01~31) 주민번호로 본다.
 */
const PATTERNS: { kind: PiiKind; re: RegExp; keep?: (m: string) => boolean }[] = [
  // 주민등록번호·외국인등록번호 — 000000-0000000
  {
    kind: '주민번호',
    re: /\b(\d{6})[-–—]?(\d{7})\b/g,
    keep: (m) => {
      const mm = Number(m.slice(2, 4)), dd = Number(m.slice(4, 6));
      return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
    },
  },
  // 법인등록번호 — 위 날짜 판정에서 떨어진 6-7 자리
  { kind: '법인등록번호', re: /\b\d{6}[-–—]?\d{7}\b/g },
  // 사업자등록번호 — 000-00-00000
  { kind: '사업자번호', re: /\b\d{3}[-–—]?\d{2}[-–—]?\d{5}\b/g },
  // 계좌번호 — 은행명이 앞에 붙은 것만 (숫자 나열을 함부로 지우면 금액이 사라진다)
  { kind: '계좌번호', re: /(?:국민|신한|우리|하나|농협|기업|카카오|토스|새마을|수협|우체국|산업|씨티|SC)\s*(?:은행)?\s*\d{2,6}[-–—]\d{2,8}[-–—]?\d{0,8}/g },
  // 휴대전화·유선전화
  { kind: '연락처', re: /\b0(?:1[016-9]|2|[3-6]\d)[-–—)\s]?\d{3,4}[-–—\s]?\d{4}\b/g },
  { kind: '이메일', re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  // 주소 — 시/도부터 번지·건물까지 한 덩어리
  {
    kind: '주소',
    re: /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(?:특별시|광역시|특별자치시|특별자치도|도)?\s?\S*(?:시|군|구)\s\S*(?:읍|면|동|가|로|길)[^\n,]{0,40}/g,
  },
];

/** 이름 사전에서 뽑아 쓸 때 오탐이 잦은 말들 — 회사명 조각이나 흔한 낱말은 뺀다. */
const NAME_STOP = new Set(['본점', '지점', '대표', '법인', '개인', '주식회사', '유한회사', '사업장', '회계', '세무']);

/**
 * 개인정보를 자리표로 바꾼다.
 *
 * @param text 직원이 붙여넣은 원문
 * @param names 거래처 명부에서 온 이름들(거래처명·대표자명·담당자명). 성명은 모양이 없어
 *   정규식으로 못 잡는다 — 우리가 아는 이름으로 잡는 것이 유일하게 정확한 방법이다.
 */
export function maskPii(text: string, names: string[] = []): MaskResult {
  const m = createMasker(names);
  const masked = m.mask(text);
  return { masked, map: m.map, hits: m.hits };
}

export interface Masker {
  /** 여러 번 부를 수 있다. 같은 원문값은 늘 같은 자리표를 받는다. */
  mask(text: string): string;
  /** 지금까지 만든 자리표를 되돌린다. */
  unmask(text: string): string;
  readonly map: Record<string, string>;
  readonly hits: PiiHit[];
}

/**
 * 치환표를 들고 여러 필드를 이어서 가리는 마스커.
 *
 * 질문·기존초안·보완요청을 **따로** 가리면 안 된다 — 각각 {인명1} 부터 다시 세어
 * 같은 자리표가 서로 다른 사람을 가리키게 되고, 되돌릴 때 뒤섞인다.
 */
export function createMasker(names: string[] = []): Masker {
  const map: Record<string, string> = {};
  const hits: PiiHit[] = [];
  const seen = new Map<string, string>();      // 원문값 → 자리표 (같은 값은 같은 번호)
  const counter = new Map<PiiKind, number>();

  const put = (kind: PiiKind, value: string): string => {
    const known = seen.get(value);
    if (known) return known;
    const n = (counter.get(kind) ?? 0) + 1;
    counter.set(kind, n);
    const t = token(kind, n);
    seen.set(value, t);
    map[t] = value;
    hits.push({ kind, value, token: t });
    return t;
  };

  // 이름은 긴 것부터 — '김민섭'과 '김민'이 함께 있으면 긴 쪽이 먼저 걸려야 한다.
  const dict = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2 && !NAME_STOP.has(n)))]
    .sort((a, b) => b.length - a.length);

  return {
    map, hits,
    mask(text: string): string {
      if (!text) return '';
      let out = text;
      for (const p of PATTERNS) {
        out = out.replace(new RegExp(p.re.source, p.re.flags), (m) =>
          p.keep && !p.keep(m) ? m : put(p.kind, m));
      }
      for (const name of dict) {
        if (!out.includes(name)) continue;
        out = out.split(name).join(put('인명', name));
      }
      return out;
    },
    unmask: (text: string) => unmaskPii(text, map),
  };
}

/** 답변에 남은 자리표를 원래 값으로 되돌린다. */
export function unmaskPii(text: string, map: Record<string, string>): string {
  if (!text) return text;
  let out = text;
  // 긴 자리표부터 — {인명10} 이 {인명1} 로 먼저 잘리면 안 된다.
  for (const t of Object.keys(map).sort((a, b) => b.length - a.length)) {
    out = out.split(t).join(map[t]);
  }
  return out;
}

/**
 * 마스킹을 통과했는데도 주민등록번호 모양이 남아 있는가.
 * 남았다면 보내지 않는다 — 고유식별정보는 한 건도 나가면 안 된다.
 */
export function findResidentNos(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(\d{6})[-–—]?(\d{7})\b/g)) {
    const mm = Number(m[1].slice(2, 4)), dd = Number(m[1].slice(4, 6));
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) out.push(m[0]);
  }
  return out;
}

/** 화면에 보여 줄 한 줄 요약 — "주민번호 1 · 연락처 2 를 가렸습니다". */
export function summarizeHits(hits: PiiHit[]): string {
  if (!hits.length) return '';
  const byKind = new Map<PiiKind, number>();
  for (const h of hits) byKind.set(h.kind, (byKind.get(h.kind) ?? 0) + 1);
  return [...byKind].map(([k, n]) => `${k} ${n}`).join(' · ');
}
