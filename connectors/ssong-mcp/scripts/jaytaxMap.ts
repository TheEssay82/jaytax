// 쏭비서용 「JAYTAX 지도」를 앱 소스에서 만든다 — 메뉴(menu.ts) · 개발노트(changelog.ts) · 백로그(backlog.ts).
//
// JAYTAX 는 계속 기능이 늘어난다(대표님 2026-11-21 「쏭비서가 바뀌는 부분을 계속 catch 해야 한다」).
// 그래서 지도를 손으로 쓰지 않고 앱이 화면에 쓰는 **같은 정의**에서 뽑는다.
//   · 만들기:  connectors/ssong-mcp 에서  npm run gen:map  → lib/jaytaxMap.ts
//   · 지키기:  루트 npm test 의 src/lib/ssongMap.test.ts 가 「소스와 지도가 어긋났다」면 실패한다.
//              메뉴·개발노트·백로그를 고치고 지도를 안 만들면 테스트가 막는다.
import { MENU_GROUPS, ICON_ITEMS, type MenuItem } from '../../../src/lib/menu.ts';
import { CHANGELOG } from '../../../src/lib/changelog.ts';
import { BACKLOG } from '../../../src/lib/backlog.ts';

const plain = (s: string) => s.replace(/<\/?b>/g, '').replace(/\s+/g, ' ').trim();

interface MapMenu { id: string; label: string; section?: string; onlyFor?: string[]; children?: MapMenu[] }
const menuOf = (it: MenuItem): MapMenu => ({
  id: it.id, label: it.label,
  ...(it.section ? { section: it.section } : {}),
  ...(it.onlyFor ? { onlyFor: [...it.onlyFor] } : {}),
  ...(it.children?.length ? { children: it.children.map(menuOf) } : {}),
});

/** 쏭비서 도구가 JAYTAX 어디를 보는지 — 도구를 늘리면 여기도 고친다(손으로 쓰는 유일한 부분). */
const SSONG_TOOLS = [
  { tool: 'about_jaytax', covers: '이 지도 — 메뉴 · 최근 변경 · 계획 · 도구 범위 · 규칙' },
  { tool: 'search_clients · search_contacts', covers: '거래처등록 · 거래처담당자등록(이름·직함·담당회계사만)' },
  { tool: 'list_sales_contracts', covers: '매출계약등록 — 거래처 하나의 계약' },
  { tool: 'submit_sales_contract', covers: '매출계약 등록 결재 올리기(대표님 승인 뒤 등록)' },
  { tool: 'submit_doc_send · get_doc_send_status', covers: '문서발송관리 — 의뢰 결재 올리기 · 상태·등기번호' },
  { tool: 'daily_digest', covers: '기간 동안 생긴 일 — 새 계약·발송·세금계산서 발행·수금·조회서 회수·감사이슈·결재 결과' },
  { tool: 'revenue_summary', covers: '매출 — 정산연도·팀별 계약금액 · 발행 공급가액 · 확정 실적, 거래처별' },
  { tool: 'billing_watch', covers: '청구·수금 — 그 달 발행요청 상태 · 미수금(ERP 대장 기준)·오래된 미수, 거래처별' },
  { tool: 'audit_watch', covers: '감사업무 — 기말감사일정 · 조회서 미발송/미회수 · 미결 감사이슈' },
  { tool: 'send_morning_briefing', covers: '아침 브리핑을 대표님 텔레그램으로 — 네이버웍스 요약 + JAYTAX 브리핑, 하루 한 번' },
  { tool: 'list_my_requests', covers: '쏭비서 결재함 — 내가 올린 결재의 결과' },
];

const RULES = [
  '정산(귀속)연도는 7월 1일 ~ 다음 해 6월 30일이고, 시작하는 해로 부른다(2026-07 ~ 2027-06 = 2026).',
  '팀은 감사team(감사팀)과 taxteam(기장팀) 둘. 화면에는 「감사팀·기장팀」으로 쓴다.',
  '감사팀은 담당회계사별로, 기장팀은 회계사×담당직원으로 나눠 본다.',
  '매출계약의 cpa 칸이 담당 회계사다. 비어 있으면 거래처(사업장)의 담당회계사를 이어받는다.',
  '쏭비서는 읽기와 「결재 올리기」만 한다. 등록·발송은 대표님이 JAYTAX ⚙ 관리 › 쏭비서 결재함에서 승인해야 일어난다.',
  '지도에 없는 화면·자료는 쏭비서가 볼 수 없다. 모르면 「JAYTAX 화면에서 확인해 주세요」라고 답한다.',
];

export function buildJaytaxMap() {
  const latest = CHANGELOG[0];
  return {
    version: latest?.version ?? '',
    asOf: latest?.date ?? '',
    rules: RULES,
    ssongTools: SSONG_TOOLS,
    menus: [
      ...MENU_GROUPS.map((g) => ({ group: g.label, items: g.items.map(menuOf) })),
      { group: '⚙ 관리·아이콘', items: ICON_ITEMS.map(menuOf) },
    ],
    recentChanges: CHANGELOG.slice(0, 20).map((c) => ({
      version: c.version, date: c.date, title: plain(c.title), highlights: c.highlights.map(plain),
    })),
    planned: BACKLOG.map((s) => ({
      group: plain(s.title), items: s.items.map((i) => ({ title: plain(i.title), desc: plain(i.desc) })),
    })),
  };
}

export function renderJaytaxMapFile(): string {
  return `// 자동 생성 — scripts/jaytaxMap.ts (npm run gen:map). 손으로 고치지 말 것.\n` +
    `export const JAYTAX_MAP = ${JSON.stringify(buildJaytaxMap(), null, 2)};\n`;
}
