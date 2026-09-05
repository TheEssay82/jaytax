// 앱 메뉴 구조와 '누가 어느 메뉴를 보는가'.
//
// AppShell 에서 떼어 냈다 — 사용자/계정관리의 **권한 현황** 화면이 같은 정의를 읽어야
// 화면과 설명이 어긋나지 않기 때문이다. 메뉴를 고치면 그 화면도 저절로 따라온다.
import type { Capability } from './roles';
import { can, PER_HEAD_ALLOWED_GROUPS, PER_HEAD_HIDDEN_TABS, EXTERNAL_ALLOWED_TABS, type Role } from './roles';

// ── 메뉴 구조 (대분류 → 하부메뉴) ───────────────────────────────
// children: 중분류가 하위 소분류를 가지면 클릭·호버 시 플라이아웃 서브메뉴로 펼친다(컨테이너 자체는 페이지 없음).
export type MenuItem = {
  id: string; label: string; cap?: Capability; children?: MenuItem[];
  /** 이 사람들에게는 내놓지 않는다(권한이 아니라 '볼 일이 없다'는 뜻의 가림). */
  hideFor?: readonly string[];
  /** 이 사람에게만 내놓는다. */
  onlyFor?: readonly string[];
};
export type MenuGroup = { id: string; label: string; items: MenuItem[] };

export const MENU_GROUPS: MenuGroup[] = [
  {
    id: 'clients-hub',
    label: '거래처관리',
    items: [
      { id: 'biz-register', label: '🏢 거래처등록' },
      { id: 'biz-contract', label: '📄 매출계약등록' },
      { id: 'biz-contacts', label: '👤 거래처담당자등록' },
      // 전사 매출·계약 금액을 통째로 보는 자리다. 매출통계와 같은 성격이라
      // 실무 담당자에게는 내놓지 않는다(사용자 확정 2026-09-03).
      // 매출통계(통계)보다 한 사람 더 막는다 — 이쪽은 예산까지 함께 보이기 때문이다.
      { id: 'biz-status', label: '📈 현황및예산조회', hideFor: ['김민섭', '김동주', '정남지'] },
    ],
  },
  {
    id: 'billing-req',
    label: '기장등청구관리',
    items: [
      { id: 'invoice-request', label: '🧾 발행요청 · taxteam' },
      { id: 'audit-invoice', label: '🧾 발행요청 · 감사팀' },
      { id: 'erp-reconcile', label: '📥 ERP 발행내역 대사' },
      { id: 'receivable', label: '💰 수금·미수금' },
      // 매출통계는 회계사·관리자가 보는 자리다. 실무 담당자에게는 굳이 내놓지 않는다.
      // 💵 예산은 이 안의 서브탭이다. 자료가 같고(같은 매출 사실), 감사팀=담당회계사 ·
      // taxteam=회계사×직원 규칙도 여기 이미 있다. 대메뉴에 따로 두면 거래처관리의
      // '현황및예산조회'와 이름이 겹쳐 어디로 가야 할지 헷갈린다.
      // 급여 자료라 김민섭·김동주·정남지에게는 **서브탭 자체가 보이지 않는다**.
      { id: 'staff-revenue', label: '📊 매출통계', hideFor: ['김민섭', '김동주'] },
      // 기초미수금은 2026-07-01 시점에 한 번 넣은 값이다. 다음 사업연도 이월 때만 다시 쓴다.
      { id: 'receivable-opening', label: '⚙️ 기초 미수금 입력', onlyFor: ['정우철'] },
    ],
  },
  {
    id: 'billing',
    label: '세무조정수수료관리',
    items: [
      { id: 'targets', label: '🎯 세무조정 대상선정', cap: 'viewClients' },
      { id: 'wizard', label: '📝 청구서 작성' },
      { id: 'history', label: '📋 청구기록' },
      // 매출통계와 같은 성격이다 — 회계사·관리자가 보는 자리라 실무 담당자에게는 내놓지 않는다.
      { id: 'stats', label: '📊 통계', hideFor: ['김민섭', '김동주'] },
      { id: 'settings', label: '⚙️ 설정', cap: 'changeSettings' },
    ],
  },
  {
    id: 'advisory',
    label: '회계및세무상담관리',
    items: [
      { id: 'std-kifrs', label: '📚 회계기준 검색' },
      { id: 'std-tax', label: '⚖️ 세법 검색' },
      { id: 'consult', label: '🧑‍💼 상담진행' },
      { id: 'consult-log', label: '🗂️ 상담기록' },
      // 📁 자료실은 메뉴에서 뺐다(2026-09-05) — 올린 자료가 0건이었고,
      // 일반업무관리의 「자료실」(옛 증빙 자료실)과 이름이 겹쳐 어디로 가야 할지 헷갈렸다.
      // 화면과 표(library_documents)는 그대로 두었으므로 되살리려면 이 줄만 되돌리면 된다.
      { id: 'ai-usage', label: '📊 AI 사용량', cap: 'viewAiUsage' },
    ],
  },
  {
    id: 'general',
    label: '일반업무관리',
    items: [
      {
        id: 'doc-send',
        label: '📄 문서발송관리',
        children: [
          // 요청과 처리는 **같은 건이 지나가는 두 단계**라 한 화면에서 탭으로 오간다.
          // 메뉴를 둘로 두면 「내가 올린 게 처리됐나」를 보려고 메뉴를 왔다 갔다 해야 했다.
          // 처리 탭은 등급으로 갈리므로(viewDispatch) 화면 안에서 감춘다 — 메뉴에는 cap 을
          // 걸지 않는다. 걸면 요청만 쓰는 인당회계사에게 메뉴 자체가 사라진다.
          { id: 'doc-send-work', label: '✉️ 발송요청 및 처리' },
          { id: 'doc-status', label: '📊 발송업무 현황' },
        ],
      },
      { id: 'evidence', label: '📁 자료실' },
      {
        id: 'inquiry-send',
        label: '📮 조회서 발송관리',
        children: [
          { id: 'conf-register', label: '📝 조회서등록' },
          { id: 'conf-dispatch', label: '📮 조회서 발송및진행' },
          { id: 'conf-collect', label: '📬 조회서 회수관리' },
          { id: 'conf-status', label: '📊 조회현황' },
        ],
      },
      { id: 'vacation', label: '🌴 휴가관리' },
      { id: 'estimate', label: '🧮 견적산출 시스템' },
    ],
  },
];

// 우측 아이콘 메뉴 (대분류 밖)
export const ICON_ITEMS: (MenuItem & { icon: string })[] = [
  { id: 'requests', label: '업데이트요청', icon: '💬' },
  { id: 'users', label: '사용자 관리', icon: '👤', cap: 'manageUsers' },
  // 접속기록은 개인정보 보호책임자가 월 1회 이상 점검하는 자리다(고시 제8조제2항).
  // 남의 접속기록도 그 자체가 개인정보라 최고관리자에게만 내놓는다.
  { id: 'access-log', label: '접속기록 점검', icon: '🔎', cap: 'manageUsers' },
  // 보존기한이 지난 개인정보는 지체 없이 파기해야 한다(법 제21조). 파기는 되돌릴 수 없어
  // 개인정보 보호책임자만 볼 수 있게 둔다.
  { id: 'retention', label: '보존기한 · 파기', icon: '🗑️', cap: 'manageUsers' },
  // 개발노트(끝난 일)의 짝 — 남은 일. 착수금 금액·내부 우선순위가 담겨 최고관리자에게만 내놓는다.
  { id: 'backlog', label: '개발 백로그', icon: '📌', cap: 'manageUsers' },
  // 외부 서비스 요금제 한도. 넘기면 어느 날 갑자기 막히므로 미리 본다.
  { id: 'service-limits', label: '서비스 한도', icon: '⚙️', cap: 'manageUsers' },
];

/**
 * 이 사람에게 이 메뉴를 내놓는가 — AppShell 의 필터와 **같은 규칙**이다.
 * 규칙이 두 곳에 흩어지면 권한 현황 화면이 거짓말을 하게 되므로 여기 한 곳에 둔다.
 */
export function menuAllowed(role: Role, profileName: string, it: MenuItem): boolean {
  if (role === 'external') return EXTERNAL_ALLOWED_TABS.has(it.id);
  if (role === 'per_head_accountant' && PER_HEAD_HIDDEN_TABS.has(it.id)) return false;
  if (it.hideFor?.includes(profileName)) return false;
  if (it.onlyFor && !it.onlyFor.includes(profileName) && role !== 'superuser') return false;
  return !it.cap || can(role, it.cap);
}

/** 그 등급이 이 대분류를 보는가(인당회계사는 허용 그룹만). */
export function groupAllowed(role: Role, g: MenuGroup): boolean {
  return role !== 'per_head_accountant' || PER_HEAD_ALLOWED_GROUPS.has(g.id);
}
